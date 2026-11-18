// The repo's MCP server for Codex: a live status line under the prompt and the feedback tool. JSON-RPC over stdio, one message per line.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

import { codexHome, readCodex } from '../server/codex.mjs'
import { envMs } from '../server/kiro.mjs'
import { gapChecks } from './gate.mjs'

export const STATUSLINE_URI = 'ui://agentmon-live/statusline'
export const PANE_URI = 'ui://agentmon-live/pane'
const ISSUES = 'https://github.com/codenotary/agentmon-live/issues/new'
const KINDS = ['problem', 'idea', 'thanks', 'other']
const MAX_TEXT = 2000
// Same cap as `hooks/feedback.tsx`: GitHub refuses a longer prefilled body.
const MAX_ISSUE_BODY = 5000
// The server's window for a quiet Codex chat, and its override.
const IDLE_MS = envMs('AGENTMON_KIRO_IDLE_MS', 30 * 60_000)
// shortcut: the server moves to the next port when another program holds this one, and these links then lead nowhere; have the server record its port if that happens.
const WEB = 'http://127.0.0.1:47311/'
const RELEASES = 'https://api.github.com/repos/codenotary/agentmon-live/releases/latest'
const RELEASE_MS = 3_600_000
const VERSION = JSON.parse(readFileSync(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8')).version

const TOOLS = [
  {
    name: 'statusline',
    title: 'AgentMon Live',
    description: "One line on the current Codex chat: open done-gate items, latest checks, context and limits. Codex's status line reads it; nothing to call by hand.",
    inputSchema: { type: 'object', properties: {} },
    _meta: { 'openai/ui': { entrypoints: [{ type: 'statusline', resourceUri: STATUSLINE_URI }] } },
  },
  {
    name: 'pane',
    title: 'AgentMon',
    description: "The AgentMon Live pane for the current Codex chat, as a panel of coloured text, charts and keys: open done-gate items, the running call, subagents, changes and checks, insights, recent calls, context and limits, and a session log. Codex's sidebar reads it; nothing to call by hand.",
    inputSchema: { type: 'object', properties: {} },
    _meta: { 'openai/ui': { entrypoints: [{ type: 'sidebar', resourceUri: PANE_URI }] } },
  },
  {
    name: 'dismiss',
    description: "Puts an open item away in the AgentMon panel. The panel's x key calls it; call it only when the person asks to put an item away.",
    inputSchema: { type: 'object', properties: { chat: { type: 'string', description: 'The Codex chat id.' }, item: { type: 'string', description: 'The item text as the panel gives it.' } }, required: ['chat', 'item'] },
  },
  {
    name: 'feedback',
    description: 'Makes a prefilled GitHub issue link for feedback to the makers of AgentMon Live. Sends nothing: the person opens the link and submits it. Use only when the person asks for feedback to AgentMon Live.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: KINDS },
        text: { type: 'string', description: `The feedback, at most ${MAX_TEXT} characters. No code, file paths, prompt text, names or secrets.` },
      },
      required: ['type', 'text'],
    },
  },
]

// Codex names the chat on screen in the read's `_meta`; without it, the chat whose turn started last.
export const threadOf = meta => meta?.['com.openai/codex-statusline-state']?.thread?.id ?? meta?.['com.openai/codex-sidebar-state']?.thread?.id

export function pickChat(chats, threadId) {
  const hit = chats.find(([id]) => id === threadId)
  if (hit) return hit[1]
  const all = chats.map(([, s]) => s)
  const mains = all.filter(s => !s.session?.parent)
  // A subagent still writing after its parent went quiet is the chat at work.
  return (mains.length > 0 ? mains : all).sort((a, b) => (a.turns.at(-1)?.startedAt ?? 0) - (b.turns.at(-1)?.startedAt ?? 0)).at(-1)
}

// An item put away with the panel's x key, per chat. The Stop hook runs apart from this server and still asks once.
const openGaps = (snapshot, dismissed) => gapChecks(snapshot).filter(g => !dismissed.has(`${snapshot.session.id}\n${g.text}`))

export function statusText(snapshot, dismissed = new Set()) {
  if (!snapshot) return `AgentMon · no live Codex chat · ${WEB}`
  const gaps = openGaps(snapshot, dismissed)
  const checks = snapshot.checks.filter(c => c.result !== 'running').map(c => `${c.kind} ${c.result === 'ok' ? 'ok' : c.result}`)
  const five = snapshot.usage.rate?.find(r => r.kind === 'five_hour')
  return [
    'AgentMon',
    gaps.length > 0 ? `${gaps.length} open` : '',
    ...checks,
    snapshot.usage.ctxPct === undefined ? '' : `ctx ${snapshot.usage.ctxPct}%`,
    five ? `5h ${five.pct}%` : '',
    WEB,
  ].filter(Boolean).join(' · ')
}

const secs = ms => `${Math.round(ms / 1000)}s`
const RECENT = 8
const MINUTES = 30
const LOG = 10
// Codex opens the address itself: it starts this server without the desktop's environment, so a browser started here never shows.
const WEB_ACTION = { type: 'action', key: 'w', label: 'open the web view', url: WEB }
// Text is Codex's UI tree, the status line's format; panel, box, gauge, bars, sparkline, chart and action are the patched sidebar's widgets.
const paint = (color, text, bold) => ({ type: 'text', props: { ...(color ? { color } : {}), ...(bold ? { weight: 'bold' } : {}) }, children: [text] })
const line = (...children) => ({ type: 'text', children: [...children, '\n'] })
const box = (title, children, color = 'cyan') => ({ type: 'box', title, color, children })
const one = (text, n = 80) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const level = pct => (pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green')
const gauge = (label, pct) => ({ type: 'gauge', label, ratio: pct / 100, color: level(pct) })
const KIND_COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red']

// Rounded to whole seconds first, so no time reads `1m60s`.
export const dur = ms => {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}
const pie = buckets => {
  const total = Object.values(buckets).reduce((n, ms) => n + ms, 0)
  // A slice under 1% is not drawn: it would read as 0%.
  const slices = Object.entries(buckets).filter(([, ms]) => ms >= total / 100).sort((a, b) => b[1] - a[1]).slice(0, KIND_COLORS.length)
  return { type: 'pie', height: 5, slices: slices.map(([k, ms], i) => ({ label: k, value: Math.round(ms), text: `${Math.round((ms / total) * 100)}% · ${dur(ms)}`, color: KIND_COLORS[i] })) }
}

// The pane holds no seconds clock: Codex redraws the sidebar whenever this panel changes, and the activity line moves once a minute.
// `chats` lists every live chat, so a chat's subagents show; `release` is a newer AgentMon release, if any.
export function paneTree(snapshot, dismissed = new Set(), { chats = [], release } = {}) {
  const web = { type: 'link', props: { href: WEB }, children: ['web view'] }
  const keys = line(paint('blue', 'ctrl-x s focus or hide · alt-p tabs · '), web)
  const update = release ? [line(paint('green', `↑ AgentMon Live ${release.version} is out · `, true), { type: 'link', props: { href: release.url }, children: ['what changed'] })] : []
  if (!snapshot) return { type: 'panel', children: [line(paint(undefined, 'AgentMon Live', true)), keys, ...update, line(`No Codex chat written to in the last ${Math.round(IDLE_MS / 60_000)} minutes.`), WEB_ACTION] }
  const out = [line(paint(undefined, 'AgentMon Live', true), paint('blue', ` · ${[snapshot.build, snapshot.main.model, snapshot.main.effort].filter(Boolean).join(' · ')}`)), keys, ...update, WEB_ACTION]
  const gaps = openGaps(snapshot, dismissed)
  out.push(box('Needs attention', gaps.length === 0 ? [line(paint('green', '✓ nothing open'))] : gaps.slice(0, 5).map(g => line(g.isFailed ? paint('red', ' FAILED ', true) : paint('yellow', ' STALE ', true), ` ${one(g.text)}`)), gaps.length > 0 ? 'red' : 'green'))
  if (gaps.length > 0) {
    out.push({ type: 'action', key: 'i', label: 'investigate the first item', prompt: `Before you report done, look into this AgentMon item and fix it, or say plainly why not: "${one(gaps[0].text, 200)}"` })
    out.push({ type: 'action', key: 'x', label: 'put the first item away', tool: 'dismiss', arguments: { chat: snapshot.session.id, item: gaps[0].text } })
  }
  out.push(box('Now', snapshot.active.length === 0 ? [line(paint('blue', 'idle'))] : snapshot.active.slice(0, 3).map(a => line(paint('yellow', '◉ ', true), paint(undefined, `${a.tool} `, true), one(a.what)))))
  const agents = chats.map(([, s]) => s).filter(s => s.session.parent === snapshot.session.id)
  if (agents.length > 0) {
    out.push(box(`Agents (${agents.length})`, agents.slice(-RECENT).flatMap(a => {
      const doing = a.active[0]
      const last = doing ?? a.trace.at(-1)
      return [
        line(doing ? paint('yellow', '◉ ', true) : paint('green', '✓ '), paint(undefined, `${a.session.agent} `, true), paint('blue', `${a.turns.length} turns · ${a.trace.length} calls`)),
        line(paint('blue', '  ↳ '), last ? one(`${last.tool} ${last.what}`, 60) : 'no calls yet'),
      ]
    }), 'magenta'))
  }
  const cwd = snapshot.session.cwd ? `${snapshot.session.cwd}/` : undefined
  const rel = f => (cwd && f.startsWith(cwd) ? f.slice(cwd.length) : f)
  const { edited, read = [] } = snapshot.files
  if (edited.length > 0 || snapshot.checks.length > 0) {
    // Stale as the done gate judges it: this turn's code edits only, so the box and the gate never disagree.
    const judged = gapChecks(snapshot)
    const stale = c => judged.some(g => g.check === c && !g.isFailed)
    out.push(box(`Changes · ${edited.length} edited · ${read.length} read`, [
      ...edited.slice(-RECENT).map(f => line(paint('yellow', '✎ '), one(rel(f)))),
      ...snapshot.checks.slice(-6).map(c => line(c.result === 'ok' && !stale(c) ? paint('green', '✓ ') : c.result === 'running' ? paint('yellow', '◉ ') : stale(c) ? paint('yellow', '↻ ') : paint('red', '✗ '), paint(undefined, `${c.kind} `, true), stale(c) ? paint('yellow', 'stale since the last edit · ') : '', one(c.command, 50))),
      ...(snapshot.checks.length === 0 ? [line(paint('yellow', 'no test, lint or build run yet'))] : []),
    ], snapshot.checks.some(c => c.result === 'failed') ? 'red' : 'cyan'))
  }
  const ins = snapshot.insights ?? {}
  const insight = []
  if (ins.session && Object.values(ins.session).some(ms => ms > 0)) insight.push(line(paint('blue', `Where ${dur(ins.sessionWall ?? 0)} over ${snapshot.turns.length} turns went`)), pie(ins.session))
  const slow = [...snapshot.trace].filter(c => c.ms).sort((a, b) => b.ms - a.ms).slice(0, 3)
  if (slow.length > 0) insight.push(line(paint('blue', 'Slowest calls')), ...slow.map(c => line(paint(c.ms >= 60_000 ? 'yellow' : undefined, dur(c.ms).padStart(6)), paint(undefined, ` ${c.tool} `, true), one(c.what, 50))))
  const often = (counts, n) => Object.entries(counts ?? {}).filter(([, k]) => k >= n).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, k]) => `${rel(f)} ${k}×`)
  const rereads = often(ins.reads, 2)
  const churned = often(ins.edits, 3)
  if (rereads.length > 0) insight.push(line(paint('yellow', 'read again '), one(rereads.join(' · '), 120)))
  if (churned.length > 0) insight.push(line(paint('yellow', 'edited often '), one(churned.join(' · '), 120)))
  const tok = ins.tokens
  if (tok?.mainIn > 0) insight.push(line(paint('blue', 'tokens '), `${Math.round(tok.mainIn / 1000)}k in · ${Math.round(tok.mainOut / 1000)}k out · ${Math.round((tok.mainCached / tok.mainIn) * 100)}% cached`))
  if (insight.length > 0) out.push(box('Insights', insight, 'blue'))
  const turn = snapshot.turns.at(-1)
  if (turn) {
    const spent = Object.entries(turn.isLive ? {} : turn.buckets).sort((a, b) => b[1] - a[1]).slice(0, 6)
    const bars = spent.length > 0 ? [{ type: 'bars', bars: spent.map(([k, ms], i) => ({ label: k, value: Math.round(ms), text: dur(ms), color: KIND_COLORS[i % KIND_COLORS.length] })) }] : []
    out.push(box(`Turn ${snapshot.turns.length}${turn.isLive ? ' · running' : ` · ${dur(turn.wallMs)}`}`, [line(paint('magenta', `› ${one(String(turn.prompt ?? '').split('\n')[0], 120)}`)), ...bars]))
  }
  const minute = Math.floor(snapshot.now / 60_000)
  const perMinute = Array.from({ length: MINUTES }, () => 0)
  for (const c of snapshot.trace) {
    const ago = minute - Math.floor(c.at / 60_000)
    if (ago >= 0 && ago < MINUTES) perMinute[MINUTES - 1 - ago] += 1
  }
  if (perMinute.some(n => n > 0)) out.push(box(`Calls per minute, last ${MINUTES}`, [{ type: 'sparkline', data: perMinute, height: 3 }]))
  const recent = snapshot.trace.slice(-RECENT).reverse()
  if (recent.length > 0) out.push(box('Recent calls', recent.map(c => line(paint(c.isFailed ? 'red' : undefined, `${c.tool} `, true), one(c.what, 60)))))
  const { ctxPct, ctxTokens, ctxWindow, rate = [] } = snapshot.usage
  const gauges = [...(ctxPct === undefined ? [] : [gauge(`context ${ctxPct}% ${Math.round(ctxTokens / 1000)}k/${Math.round(ctxWindow / 1000)}k`, ctxPct)]), ...rate.map(r => gauge(`${r.kind === 'five_hour' ? '5h' : '7d'} ${r.pct}%`, r.pct))]
  if (gauges.length > 0) out.push(box('Context and limits', gauges))
  const log = snapshot.turns.slice(-LOG).reverse()
  if (log.length > 0) {
    out.push(box(`Session log · ${snapshot.turns.length} turns`, log.flatMap((t, i) => [
      line(paint('magenta', `#${snapshot.turns.length - i} `, true), paint('blue', t.isLive ? 'running ' : `${dur(t.wallMs)} `), `› ${one(String(t.prompt ?? '').split('\n')[0], 80)}`),
      ...(t.answer ? [line(paint('blue', '   ↳ '), one(t.answer, 80))] : []),
    ])))
  }
  return { type: 'panel', children: out }
}

// The panel's words alone, for a model that calls the tool.
export function words(node) {
  if (typeof node === 'string') return node
  if (node.type === 'box') return `${node.title}\n${node.children.map(words).join('')}\n`
  if (node.type === 'gauge') return `${node.label}\n`
  if (node.type === 'bars') return node.bars.map(b => `${b.label} ${b.text ?? b.value}\n`).join('')
  if (node.type === 'pie') return node.slices.map(b => `${b.label} ${b.text ?? b.value}\n`).join('')
  if (node.type === 'action') return ''
  return (node.children ?? []).map(words).join('')
}

export function feedbackLink({ type, text }) {
  const said = String(text ?? '').trim()
  if (!KINDS.includes(String(type))) return `Not taken: type must be one of ${KINDS.join(', ')}.`
  if (!said) return 'Not taken: text is required.'
  if ([...said].length > MAX_TEXT) return `Not taken: text takes at most ${MAX_TEXT} characters.`
  const title = [...said.split('\n')[0]].slice(0, 80).join('')
  let kept = [...said]
  // shortcut: a long text is cut to fit the address, as in `hooks/feedback.tsx`; post through the API if whole texts must go.
  while (new URLSearchParams({ s: kept.join('') }).toString().length > MAX_ISSUE_BODY) kept = kept.slice(0, Math.floor(kept.length * 0.9))
  const link = `${ISSUES}?${new URLSearchParams({ title, body: `${kept.join('')}\n\nAgentMon Live · Codex`, labels: type === 'idea' ? 'enhancement' : 'bug' })}`
  return `Nothing was sent. Give the person this link; they read the issue and submit it themselves:\n${link}`
}

// shortcut: put-away items live as long as this server process; persist them if people restart Codex mid-task.
// The newest release, when it is newer than this plugin; checked at most hourly and silent on any failure.
// `isNewer` and the lookup repeat `hooks/format.ts` and `hooks/release.ts`, which Node cannot load.
export function isNewer(a, b) {
  const parse = v => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : undefined)
  const [x, y] = [parse(a), parse(b)]
  if (!x || !y) return false
  const i = x.findIndex((n, k) => n !== y[k])
  return i >= 0 && x[i] > y[i]
}

function watchRelease(found) {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) return
  const look = () =>
    fetch(RELEASES, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) })
      .then(r => (r.ok ? r.json() : undefined))
      .then(body => {
        const version = String(body?.tag_name ?? '').replace(/^v/, '')
        found.release = isNewer(version, VERSION) ? { version, url: String(body.html_url) } : undefined
      })
      .catch(() => {})
  look()
  setInterval(look, RELEASE_MS).unref()
}

// A subagent's chat leaves the list once idle, while its parent still works: the last snapshot seen of each stays.
// shortcut: kept for the life of this server process and never dropped; prune by age if a server outlives thousands of subagents.
function withSeen(all, found) {
  found.agents ??= new Map()
  for (const [id, s] of all) if (s.session.parent) found.agents.set(id, s)
  const live = new Set(all.map(([id]) => id))
  return [...[...found.agents].filter(([id]) => !live.has(id)), ...all]
}

export function answer(msg, chats, dismissed = new Set(), found = {}) {
  const { method, params = {} } = msg
  if (method === 'initialize') return { protocolVersion: params.protocolVersion ?? '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'agentmon-live', version: '1' } }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: TOOLS }
  if (method === 'resources/list') return { resources: [{ uri: STATUSLINE_URI, name: 'statusline', mimeType: 'application/json' }, { uri: PANE_URI, name: 'pane', mimeType: 'application/json' }] }
  if (method === 'resources/read') {
    const chat = () => pickChat(chats(), threadOf(params._meta))
    if (params.uri === PANE_URI) {
      const all = chats()
      const tree = paneTree(pickChat(all, threadOf(params._meta)), dismissed, { chats: withSeen(all, found), release: found.release })
      return { contents: [{ uri: PANE_URI, mimeType: 'application/json', text: JSON.stringify(tree) }] }
    }
    if (params.uri !== STATUSLINE_URI) throw Object.assign(new Error(`unknown resource ${params.uri}`), { code: -32002 })
    const tree = { type: 'text', children: [statusText(chat(), dismissed)] }
    return { contents: [{ uri: STATUSLINE_URI, mimeType: 'application/json', text: JSON.stringify(tree) }] }
  }
  if (method === 'tools/call') {
    const args = params.arguments ?? {}
    if (params.name === 'feedback') return { content: [{ type: 'text', text: feedbackLink(args) }] }
    if (params.name === 'statusline') return { content: [{ type: 'text', text: statusText(pickChat(chats(), threadOf(params._meta)), dismissed) }] }
    if (params.name === 'pane') {
      const all = chats()
      return { content: [{ type: 'text', text: words(paneTree(pickChat(all, threadOf(params._meta)), dismissed, { chats: withSeen(all, found), release: found.release })) }] }
    }
    if (params.name === 'dismiss') {
      if (typeof args.item !== 'string' || !args.item || typeof args.chat !== 'string' || !args.chat) return { content: [{ type: 'text', text: 'Not taken: chat and item are required.' }], isError: true }
      dismissed.add(`${args.chat}\n${args.item}`)
      return { content: [{ type: 'text', text: 'Put away.' }] }
    }
    throw Object.assign(new Error(`unknown tool ${params.name}`), { code: -32602 })
  }
  throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 })
}

export function serve(input = process.stdin, output = process.stdout) {
  const cache = new Map()
  const chats = () => readCodex(codexHome(), Date.now(), IDLE_MS, cache)
  const dismissed = new Set()
  const found = {}
  watchRelease(found)
  createInterface({ input }).on('line', line => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    // A notification has no id and gets no reply; a line that is not an object is no message.
    if (typeof msg !== 'object' || msg === null || msg.id === undefined) return
    let reply
    try {
      reply = { jsonrpc: '2.0', id: msg.id, result: answer(msg, chats, dismissed, found) }
    } catch (e) {
      reply = { jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: String(e.message ?? e) } }
    }
    output.write(`${JSON.stringify(reply)}\n`)
  })
}

if (process.argv[2] === 'serve') serve()
