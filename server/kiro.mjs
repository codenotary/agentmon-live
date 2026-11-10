// Kiro Crew writes `crew-log/sessions/<sid>-<digest>/log.jsonl` for a chat on any harness, so reading it needs no plugin inside the chat.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const kiroHome = () => process.env.KIROCREW_HOME ?? join(homedir(), '.kiro', 'crew')
// Where the server keeps its own files: the account's secret, and the Kiro Crew app's note.
export const stateDir = () => join(homedir(), '.claude', 'agentmon-live')
const sidePath = (home, slot) => join(home, 'sessions', `dashboard_${slot}.jsonl`)
// The page prints these as they come; a mod's session sends them in its own language.
export const LABELS = {
  main: 'main session',
  status: { running: 'running', waiting: 'waiting', done: 'done', error: 'error', cancelled: 'cancelled' },
  check: { test: 'tests', lint: 'lint', typecheck: 'types', build: 'build' },
  cat: { git: 'git', shell: 'shell', edit: 'edit' },
  buckets: { model: 'model', shell: 'shell', edit: 'edit', read: 'read files', you: 'waiting on you', idle: 'between steps', agents: 'agents' },
  result: { ok: 'ok', failed: 'failed', unknown: 'unknown', running: 'running' },
}

const WHO = 'main session'
const KEEP = 500
const CUT = 300
const ANSWER_CUT = 4000
const BUCKET = { execute: 'shell', read: 'read', search: 'read', edit: 'edit', fetch: 'web' }
// The crew log times tool calls only; the rest of a turn's wall time is the model's.
const modelMs = t => Math.max(0, t.wallMs - Object.entries(t.buckets).reduce((a, [k, ms]) => a + (k === 'model' ? 0 : ms), 0))
const cut = text => String(text ?? '').slice(0, CUT)
const lines = text => text.split('\n').flatMap(line => {
  // The last line may be half written, and the crew log's own rule is to skip a line that does not parse.
  try {
    return line.trim() ? [JSON.parse(line)] : []
  } catch {
    return []
  }
})

// Entry types this does not know are skipped: the crew log adds types and asks its readers to ignore them.
export function foldCrewLog(entries, now, text = new Map()) {
  const head = entries[0]?.type === 'session' ? entries[0] : {}
  const snap = {
    v: 1,
    session: { id: String(head.id ?? ''), cwd: String(head.cwd ?? '') },
    now,
    lang: 'en',
    labels: LABELS,
    main: { model: '', effort: '' },
    build: `Kiro Crew${head.agent ? ` · ${head.agent}` : ''}`,
    focus: [],
    usage: { rate: [], usd: 0 },
    turns: [],
    turnCount: 0,
    active: [],
    calls: [],
    trace: [],
    agents: [],
    checks: [],
    files: { read: [], edited: [], editedAt: 0, editedTimes: {} },
    log: [],
    tasks: [],
    insights: { slow: [], big: [], tokens: { mainIn: 0, mainOut: 0, mainCached: 0, agentsIn: 0, agentsOut: 0 } },
    learned: { bench: [] },
  }
  const open = new Map()
  const asking = new Map()
  const agents = new Map()
  const reads = new Set()
  let credits = 0
  let turn
  let prompt
  let isClosed = false

  for (const e of entries.slice(1)) {
    const d = e.data ?? {}
    const at = Number(e.time) || now
    if (e.type === 'session/opened') {
      isClosed = false
      if (d.model) snap.main.model = String(d.model)
    } else if (e.type === 'session/closed') isClosed = true
    else if (e.type === 'request/configured' && d.model) snap.main.model = String(d.model)
    else if (e.type === 'message/received') {
      if (turn && !turn.prompt) turn.prompt = cut(d.text)
      else prompt = cut(d.text)
    } else if (e.type === 'message/sent') {
      if (turn && d.text) turn.answer = String(d.text).slice(0, ANSWER_CUT)
    } else if (e.type === 'turn/started') {
      // A turn a subagent's report started has that report as its message, not something the person typed.
      turn = { startedAt: at, wallMs: 0, buckets: {}, isLive: true, prompt: d.actor && d.actor !== 'user' ? undefined : prompt }
      prompt = undefined
      snap.turns.push(turn)
    } else if (e.type === 'turn/completed') {
      const t = turn ?? { startedAt: at - (Number(d.duration_ms) || 0), buckets: {} }
      if (!turn) snap.turns.push(t)
      t.wallMs = Number(d.duration_ms) || at - t.startedAt
      t.buckets.model = modelMs(t)
      delete t.isLive
      turn = undefined
      snap.turnCount += 1
      if (d.model) snap.main.model = String(d.model)
      credits += Number(d.credits) || 0
      const k = d.tokens ?? {}
      snap.insights.tokens.mainIn += (Number(k.input) || 0) + (Number(k.cache_read) || 0) + (Number(k.cache_write) || 0)
      snap.insights.tokens.mainOut += Number(k.output) || 0
      snap.insights.tokens.mainCached += Number(k.cache_read) || 0
      const window = Number(d.context?.window) || 0
      if (window > 0) snap.usage = { ...snap.usage, ctxTokens: Number(d.context.used) || 0, ctxWindow: window, ctxPct: Math.round(((Number(d.context.used) || 0) / window) * 100) }
    } else if (e.type === 'tool/called') {
      const known = text.get(String(d.call_id))
      const tool = String(d.name || known?.tool || d.kind || 'tool')
      const call = { id: String(d.call_id), at, who: WHO, tool, what: known?.what ?? '', kind: d.kind }
      open.set(call.id, call)
      snap.trace.push(call)
    } else if (e.type === 'tool/completed') {
      const call = open.get(String(d.call_id))
      if (!call) continue
      open.delete(call.id)
      call.ms = Number(d.elapsed_ms) || at - call.at
      if (d.is_error || d.status === 'failed') call.isFailed = true
      const path = text.get(call.id)?.path
      if (path && !call.isFailed && call.kind === 'edit') {
        snap.files.editedTimes[path] = at
        snap.files.editedAt = at
      } else if (path && !call.isFailed && call.kind === 'read') reads.add(path)
      const bucket = BUCKET[call.kind] ?? 'other'
      if (turn) turn.buckets[bucket] = (turn.buckets[bucket] ?? 0) + call.ms
    } else if (e.type === 'approval/requested') asking.set(String(d.approval_id), { id: String(d.approval_id), who: WHO, tool: String(d.tool || 'approval'), what: cut(d.reason), startedAt: at, isAsking: true })
    else if (e.type === 'approval/decided') asking.delete(String(d.approval_id))
    else if (e.type === 'subagent/spawned') {
      const card = { id: String(d.agent_id), type: String(d.agent || 'subagent'), model: String(d.model ?? ''), effort: '', task: cut(String(d.task ?? '').split('\n')[0]), status: 'running', files: 0, tools: 0, input: 0, output: 0, startedAt: at, prompt: String(d.task ?? '').slice(0, ANSWER_CUT), callId: [...open.keys()].at(-1) }
      agents.set(card.id, card)
      snap.log.push({ at, who: card.type, what: card.task, result: 'started', agentId: card.id })
    } else if (e.type === 'subagent/completed' || e.type === 'subagent/failed') {
      const card = agents.get(String(d.agent_id))
      if (!card) continue
      card.status = e.type === 'subagent/completed' ? 'done' : d.outcome === 'stopped' ? 'cancelled' : 'error'
      card.endedAt = at
      credits += Number(d.credits) || 0
      snap.log.push({ at, who: card.type, what: card.task, result: card.status === 'done' ? 'done' : 'failed', agentId: card.id })
    } else if (e.type === 'plan/updated' && Array.isArray(d.items)) snap.tasks = d.items.map(i => ({ id: String(i.id), subject: cut(i.text), status: i.state === 'done' ? 'completed' : 'pending', at }))
  }

  for (const call of snap.trace) delete call.kind
  if (turn) {
    turn.wallMs = Math.max(0, now - turn.startedAt)
    turn.buckets.model = modelMs(turn)
    snap.main.turnAt = turn.startedAt
    snap.main.turnLive = true
  }
  snap.active = [...[...open.values()].map(c => ({ id: c.id, who: c.who, tool: c.tool, what: c.what, startedAt: c.at })), ...asking.values()]
  snap.agents = [...agents.values()]
  snap.files.edited = Object.keys(snap.files.editedTimes)
  snap.files.read = [...reads]
  // kiro-cli reports credits in place of tokens and cost; the page then draws them where the cost stands.
  if (credits > 0) snap.usage.credits = credits
  snap.trace = snap.trace.slice(-KEEP)
  snap.log = snap.log.slice(-KEEP)
  return { snapshot: snap, isClosed, isLive: Boolean(turn) }
}

// shortcut: `sessions/dashboard_<slot>.jsonl` is an internal Kiro Crew format, rewritten every 5 s; drop this once the crew log carries tool text (it holds only a hash).
export function toolText(home, slot) {
  const text = new Map()
  if (!/^[\w-]+$/.test(String(slot))) return text
  try {
    for (const row of lines(readFileSync(sidePath(home, slot), 'utf8'))) {
      if (row.role !== 'tool' || !row.meta?.tool_call_id) continue
      let input = row.meta.input
      // An edit's input is a diff whose first line names the file; other tools send JSON.
      let path = /^--- (\S.*)$/m.exec(String(input ?? '').slice(0, 2000))?.[1]
      try {
        const parsed = JSON.parse(input)
        path = parsed.file_path ?? parsed.path ?? parsed.operations?.[0]?.path
        input = parsed.command ?? path ?? parsed.pattern ?? parsed.url ?? parsed.__tool_use_purpose ?? row.meta.purpose ?? input
      } catch {}
      // A call the crew log gives no name shows one in its title: "Running: @server/tool".
      const tool = /(@[\w-]+\/[\w-]+)/.exec(String(row.content ?? ''))?.[1]
      text.set(String(row.meta.tool_call_id), { what: cut(path && !row.meta.input?.startsWith('{') ? path : input || row.meta.purpose || row.content), path: typeof path === 'string' ? path : undefined, tool })
    }
  } catch {}
  return text
}

// A chat that crashed never writes `session/closed`, so one outside a turn leaves the list after `idleMs` without a write.
export function readKiro(home, now, idleMs, cache = new Map()) {
  const root = join(home, 'crew-log', 'sessions')
  let dirs
  try {
    dirs = readdirSync(root)
  } catch {
    return []
  }
  const out = []
  const seen = new Set()
  for (const dir of dirs) {
    try {
      const file = join(root, dir, 'log.jsonl')
      const stat = statSync(file)
      seen.add(file)
      let hit = cache.get(file)
      let side = ''
      try {
        if (hit?.slot) side = String(statSync(sidePath(home, hit.slot)).mtimeMs)
      } catch {}
      const isSame = hit && hit.size === stat.size && hit.side === side
      // A chat that is closed or idle stays so until its log grows: nothing to fold.
      if (isSame && (hit.isClosed || (!hit.isLive && now - stat.mtimeMs > idleMs))) continue
      if (!isSame) {
        const entries = lines(readFileSync(file, 'utf8'))
        const slot = entries[0]?.slot
        hit = { size: stat.size, side, slot, entries, text: toolText(home, slot) }
        cache.set(file, hit)
      }
      const { snapshot, isClosed, isLive } = foldCrewLog(hit.entries, now, hit.text)
      Object.assign(hit, { isClosed, isLive })
      // A closed chat's entries are not needed again.
      if (isClosed) Object.assign(hit, { entries: [], text: new Map() })
      if (isClosed || !/^[\w-]{1,80}$/.test(snapshot.session.id)) continue
      if (!isLive && now - stat.mtimeMs > idleMs) continue
      out.push([snapshot.session.id, snapshot])
    } catch {}
  }
  for (const file of cache.keys()) if (!seen.has(file)) cache.delete(file)
  return out
}

// Written by the Kiro Crew app's start hook (`kiro/hooks.py`): the gateway's pid and the pages that may frame this one.
export const kiroHostFile = () => process.env.AGENTMON_KIRO_FILE || join(stateDir(), 'kiro.json')

// When the system started a process, in its own ticks: tells a gateway from a later process that got its pid. Linux only.
export function startOf(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]) || undefined
  } catch {
    return undefined
  }
}

// The gateway that asked for this server, while it runs. A gateway that was killed leaves the file behind, so the pid decides.
// shortcut: off Linux there is no start time, so a pid the system gave to another process reads as a live gateway until that one exits.
export function kiroHost(file = kiroHostFile()) {
  try {
    const { pid, start, origins } = JSON.parse(readFileSync(file, 'utf8'))
    if (!Number.isInteger(pid) || pid <= 1) return undefined
    process.kill(pid, 0)
    if (start !== undefined && start !== startOf(pid)) return undefined
    return { pid, origins: (Array.isArray(origins) ? origins : []).filter(o => /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(o)).slice(0, 4) }
  } catch {
    return undefined
  }
}
