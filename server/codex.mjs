// Codex writes each chat to `sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`, so reading it needs nothing installed in Codex.
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cut, foldCrewLog, LIVE_PATIENCE, pollLogs, recordEdit } from './kiro.mjs'

export const codexHome = () => process.env.CODEX_HOME ?? join(homedir(), '.codex')
const READS = new Set(['read', 'search', 'list_files'])
// The kinds the page draws a quota gauge for.
const WINDOW = { 300: 'five_hour', 10080: 'seven_day' }
const DAY_MS = 86_400_000
// What Codex answers when it hands a script back with its command still running.
const RUNNING = 'Script running'
const textOf = content => (Array.isArray(content) ? content.map(c => c?.text ?? '').join('') : String(content ?? ''))

// The model's call is a script around `tools.<name>(…)`: the command or the patched files are what the page shows.
// shortcut: the first `tools.<name>` in the script names the call, even in a comment; parse the script when chats show wrong labels.
function callOf(input, name) {
  const script = String(input ?? '')
  const tool = script.match(/tools\.(\w+)/)?.[1] ?? String(name || 'tool')
  if (tool === 'apply_patch') return { tool, kind: 'edit', what: [...script.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\\\n"]+)/g)].map(m => m[1]).join(' ') }
  const command = script.match(/\bcmd"?\s*:\s*("(?:[^"\\]|\\.)*")/)?.[1]
  try {
    if (command) return { tool: 'shell', kind: 'execute', what: JSON.parse(command) }
  } catch {}
  return { tool, what: script }
}

// The rollout as crew-log entries, so one fold serves both; entry types this does not know are skipped, since the format is Codex's own and changes.
// shortcut: no approvals and no subagent cards, the rollout names neither; a subagent's chat is its own rollout and lists as its own session.
export function foldRollout(entries, now) {
  const meta = entries.find(e => e.type === 'session_meta')?.payload ?? {}
  const out = [{ type: 'session', id: meta.id, cwd: meta.cwd }]
  const emit = (type, time, data = {}) => out.push({ type, time, data })
  const text = new Map()
  const open = new Map()
  const edits = []
  let effort = ''
  let rate = []
  let context
  let total = {}
  let before = {}
  let isTurn = false
  let hasPrompt = false
  let prompt
  // One prompt a turn: the rollout can hold the same message twice, and a second one would land on the next turn.
  const say = (at, message) => {
    if (!isTurn) prompt = message
    else if (!hasPrompt) {
      emit('message/received', at, { text: message })
      hasPrompt = true
    }
  }

  const finish = (id, call, at, body = '') => {
    // What the script ran says more than the script: the command as the shell got it, and whether it only read.
    const hasRun = call.commands.length > 0
    if (hasRun) text.set(id, { tool: 'shell', what: cut(call.commands.join('\n')), ...(call.isRead && call.path ? { path: call.path } : {}) })
    // Codex hands a long script back while its command still runs: no kind, so no check counts as passed before its exit status is in.
    const kind = hasRun ? (call.isRead ? 'read' : 'execute') : body.startsWith(RUNNING) ? undefined : call.kind
    // Both at once: the call's kind is known only now.
    emit('tool/called', call.at, { call_id: id, kind })
    emit('tool/completed', at, { call_id: id, is_error: Boolean(call.isFailed) || body.startsWith('Script failed'), result_bytes: body.length })
  }

  for (const e of entries) {
    const p = e.payload ?? {}
    const at = Date.parse(e.timestamp) || now
    if (e.type === 'turn_context') {
      if (p.model) emit('request/configured', at, { model: p.model })
      effort = String(p.effort ?? effort)
    } else if (e.type === 'response_item' && (p.type === 'custom_tool_call' || p.type === 'function_call')) {
      const call = { at, commands: [], isRead: true, ...callOf(p.input ?? p.arguments, p.name) }
      text.set(String(p.call_id), { tool: call.tool, what: cut(call.what) })
      open.set(String(p.call_id), call)
    } else if (e.type === 'response_item' && (p.type === 'custom_tool_call_output' || p.type === 'function_call_output')) {
      const id = String(p.call_id)
      const call = open.get(id)
      if (!call) continue
      open.delete(id)
      finish(id, call, at, textOf(p.output))
    } else if (e.type !== 'event_msg') continue
    else if (p.type === 'task_started') {
      emit('turn/started', at)
      isTurn = true
      hasPrompt = false
      if (prompt !== undefined) say(at, prompt)
      prompt = undefined
    } else if (p.type === 'user_message') say(at, String(p.message ?? ''))
    else if (p.type === 'item_completed') {
      const item = p.item ?? {}
      // What a script ran is reported before its output; it belongs to the newest call still open.
      const call = [...open.values()].at(-1)
      if (item.type === 'UserMessage') say(at, textOf(item.content))
      else if (item.type === 'CommandExecution') {
        // With no call open, the command ended after its script was handed back: a call of its own, with the exit status.
        const ran = call ?? { at: Number(p.started_at_ms) || at, commands: [], isRead: true }
        const parsed = Array.isArray(item.parsed_cmd) ? item.parsed_cmd : []
        const path = parsed.find(c => c.path)?.path
        const base = String(item.cwd ?? meta.cwd ?? '')
        ran.commands.push(String(Array.isArray(item.command) ? item.command.at(-1) : ''))
        ran.isRead &&= parsed.length > 0 && parsed.every(c => READS.has(c.type))
        // Absolute, as the edited files are: the page compares the two lists.
        if (path && base) ran.path ??= resolve(base.startsWith('file://') ? fileURLToPath(base) : base, path)
        if (item.status === 'failed' || Number(item.exit_code) > 0) ran.isFailed = true
        if (!call) finish(String(item.id), ran, at)
      } else if (item.type === 'FileChange') {
        if (item.status === 'completed') for (const path of Object.keys(item.changes ?? {})) edits.push({ path, at })
        else if (call) call.isFailed = true
      } else if (item.type === 'Extension' && call && String(item.kind).startsWith('web')) call.kind = 'fetch'
    } else if (p.type === 'token_count') {
      const limits = p.rate_limits
      // Not every count carries the limits: the last ones known stay.
      if (limits?.primary || limits?.secondary) rate = [limits.primary, limits.secondary].flatMap(r => (r && WINDOW[r.window_minutes] ? [{ kind: WINDOW[r.window_minutes], pct: Number(r.used_percent) || 0, ...(r.resets_at ? { resetsAt: r.resets_at * 1000 } : {}) }] : []))
      if (!p.info) continue
      total = p.info.total_token_usage ?? total
      context = { used: Number(p.info.last_token_usage?.total_tokens) || 0, window: Number(p.info.model_context_window) || 0 }
    } else if (p.type === 'task_complete' || p.type === 'turn_aborted') {
      // Codex counts cached tokens inside the input; the fold adds them back.
      const grown = k => Math.max(0, (Number(total[k]) || 0) - (Number(before[k]) || 0))
      if (p.last_agent_message) emit('message/sent', at, { text: p.last_agent_message })
      emit('turn/completed', at, { duration_ms: p.duration_ms, tokens: { input: grown('input_tokens') - grown('cached_input_tokens'), cache_read: grown('cached_input_tokens'), output: grown('output_tokens') } })
      before = total
      isTurn = false
      // A call the turn's end cut off never gets its output: it ends here, with no result to count as a check.
      for (const [id, call] of open) finish(id, call, at, RUNNING)
      open.clear()
    }
  }
  // A call with no output yet is running.
  for (const [id, call] of open) emit('tool/called', call.at, { call_id: id, kind: call.kind })

  const folded = foldCrewLog(out, now, text)
  const { snapshot } = folded
  snapshot.build = `Codex${meta.cli_version ? ` · ${meta.cli_version}` : ''}`
  snapshot.main.effort = effort
  snapshot.usage.rate = rate
  // The fold takes the context at a turn's end; the rollout has it after every model call.
  if (context?.window > 0) Object.assign(snapshot.usage, { ctxTokens: context.used, ctxWindow: context.window, ctxPct: Math.round((context.used / context.window) * 100) })
  for (const { path, at } of edits) recordEdit(snapshot, path, at)
  snapshot.files.edited = Object.keys(snapshot.files.editedTimes)
  return folded
}

// Every Codex chat written to lately, as `[id, snapshot]`. A rollout has no closing entry: a chat leaves `idleMs` after its last write.
// shortcut: only the day folders a listed chat can sit in are looked at, so a chat first written to again in an older day's file is not seen, and a growing rollout is read whole; read the tail when a chat's file passes tens of MB.
export function readCodex(home, now, idleMs, cache = new Map()) {
  // A chat listed already stays in, however old its folder: one that runs for days is still written to.
  const files = new Set([...cache].flatMap(([file, hit]) => (hit.isDone ? [] : [file])))
  // A folder's day is local time: one day of slack either side.
  for (let day = now - idleMs * LIVE_PATIENCE - DAY_MS; day < now + DAY_MS; day += DAY_MS) {
    const dir = join(home, 'sessions', ...new Date(day).toISOString().slice(0, 10).split('-'))
    try {
      for (const name of readdirSync(dir)) if (/^rollout-.*\.jsonl$/.test(name)) files.add(join(dir, name))
    } catch {}
  }
  return pollLogs(files, now, idleMs, cache, hit => foldRollout(hit.entries, now))
}
