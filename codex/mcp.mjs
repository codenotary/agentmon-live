// The repo's MCP server for Codex: a live status line under the prompt and the feedback tool. JSON-RPC over stdio, one message per line.
import { createInterface } from 'node:readline'

import { codexHome, readCodex } from '../server/codex.mjs'
import { codexGaps } from './gate.mjs'

export const STATUSLINE_URI = 'ui://agentmon-live/statusline'
export const PANE_URI = 'ui://agentmon-live/pane'
const ISSUES = 'https://github.com/codenotary/agentmon-live/issues/new'
const KINDS = ['problem', 'idea', 'thanks', 'other']
const MAX_TEXT = 2000
// Same cap as `hooks/feedback.tsx`: GitHub refuses a longer prefilled body.
const MAX_ISSUE_BODY = 5000
const IDLE_MS = 30 * 60_000
const WEB = 'http://127.0.0.1:47311/'

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
    description: "The AgentMon Live pane for the current Codex chat, as a panel of coloured text, charts and keys: open done-gate items, the running call, checks, recent calls, edited files, context and limits. Codex's sidebar reads it; nothing to call by hand.",
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
  return chats.map(([, s]) => s).sort((a, b) => (a.turns.at(-1)?.startedAt ?? 0) - (b.turns.at(-1)?.startedAt ?? 0)).at(-1)
}

// An item put away with the panel's x key, per chat. The Stop hook runs apart from this server and still asks once.
const openGaps = (snapshot, dismissed) => codexGaps(snapshot).filter(g => !dismissed.has(`${snapshot.session.id}\n${g}`))

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
const TURNS = 20
const MINUTES = 30
// Text is Codex's UI tree, the status line's format; panel, box, gauge, bars, sparkline, chart and action are the patched sidebar's widgets.
const paint = (color, text, bold) => ({ type: 'text', props: { ...(color ? { color } : {}), ...(bold ? { weight: 'bold' } : {}) }, children: [text] })
const line = (...children) => ({ type: 'text', children: [...children, '\n'] })
const box = (title, children, color = 'cyan') => ({ type: 'box', title, color, children })
const one = (text, n = 80) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const level = pct => (pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green')
const gauge = (label, pct) => ({ type: 'gauge', label, ratio: pct / 100, color: level(pct) })
const KIND_COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red']

// The pane holds no seconds clock: Codex redraws the sidebar whenever this panel changes, and the activity line moves once a minute.
export function paneTree(snapshot, dismissed = new Set()) {
  const web = line({ type: 'link', props: { href: WEB }, children: ['Open the web view'] })
  if (!snapshot) return { type: 'panel', children: [line(paint(undefined, 'AgentMon Live', true)), line('No Codex chat written to in the last 30 minutes.'), web] }
  const out = [line(paint(undefined, 'AgentMon Live', true), paint('blue', ` · ${[snapshot.build, snapshot.main.model, snapshot.main.effort].filter(Boolean).join(' · ')}`))]
  const gaps = openGaps(snapshot, dismissed)
  out.push(box('Needs attention', gaps.length === 0 ? [line(paint('green', '✓ nothing open'))] : gaps.slice(0, 5).map(g => line(g.includes(' failed: ') ? paint('red', ' FAILED ', true) : paint('yellow', ' STALE ', true), ` ${one(g)}`)), gaps.length > 0 ? 'red' : 'green'))
  if (gaps.length > 0) {
    out.push({ type: 'action', key: 'i', label: 'investigate the first item', prompt: `Before you report done, look into this AgentMon item and fix it, or say plainly why not: "${one(gaps[0], 200)}"` })
    out.push({ type: 'action', key: 'x', label: 'put the first item away', tool: 'dismiss', arguments: { chat: snapshot.session.id, item: gaps[0] } })
  }
  out.push(box('Now', snapshot.active.length === 0 ? [line(paint('blue', 'idle'))] : snapshot.active.slice(0, 3).map(a => line(paint('yellow', '◉ ', true), paint(undefined, `${a.tool} `, true), one(a.what)))))
  const turn = snapshot.turns.at(-1)
  if (turn) {
    const spent = Object.entries(turn.isLive ? {} : turn.buckets).sort((a, b) => b[1] - a[1]).slice(0, 6)
    const bars = spent.length > 0 ? [{ type: 'bars', bars: spent.map(([k, ms], i) => ({ label: k, value: Math.round(ms), text: secs(ms), color: KIND_COLORS[i % KIND_COLORS.length] })) }] : []
    out.push(box(`Turn ${snapshot.turns.length}`, [line(paint('magenta', `› ${one(String(turn.prompt ?? '').split('\n')[0], 120)}`)), ...bars]))
  }
  const done = snapshot.turns.filter(t => !t.isLive).slice(-TURNS)
  if (done.length >= 2) {
    const first = snapshot.turns.length - done.length + 1
    const kinds = [...new Set(done.flatMap(t => Object.keys(t.buckets)))].slice(0, KIND_COLORS.length)
    const series = kinds.map((k, i) => ({ name: k, color: KIND_COLORS[i], points: done.map((t, n) => [first + n, Math.round((t.buckets[k] ?? 0) / 1000)]) }))
    out.push(box(`Seconds per turn, last ${done.length}`, [{ type: 'chart', series, height: 8 }, line(...kinds.flatMap((k, i) => [paint(KIND_COLORS[i], '━ '), `${k}  `]))]))
  }
  const minute = Math.floor(snapshot.now / 60_000)
  const perMinute = Array.from({ length: MINUTES }, () => 0)
  for (const c of snapshot.trace) {
    const ago = minute - Math.floor(c.at / 60_000)
    if (ago >= 0 && ago < MINUTES) perMinute[MINUTES - 1 - ago] += 1
  }
  if (perMinute.some(n => n > 0)) out.push(box(`Calls per minute, last ${MINUTES}`, [{ type: 'sparkline', data: perMinute, height: 3 }]))
  if (snapshot.checks.length > 0) out.push(box('Checks', snapshot.checks.slice(-6).map(c => line(c.result === 'ok' ? paint('green', '✓ ') : c.result === 'running' ? paint('yellow', '◉ ') : paint('red', '✗ '), paint(undefined, `${c.kind} `, true), one(c.command, 60)))))
  const recent = snapshot.trace.slice(-RECENT).reverse()
  if (recent.length > 0) out.push(box('Recent calls', recent.map(c => line(paint(c.isFailed ? 'red' : undefined, `${c.tool} `, true), one(c.what, 60)))))
  const cwd = snapshot.session.cwd ? `${snapshot.session.cwd}/` : undefined
  const edited = snapshot.files.edited.map(f => (cwd && f.startsWith(cwd) ? f.slice(cwd.length) : f))
  if (edited.length > 0) out.push(box(`Files edited (${edited.length})`, edited.slice(-RECENT).map(f => line(one(f)))))
  const { ctxPct, ctxTokens, ctxWindow, rate = [] } = snapshot.usage
  const gauges = [...(ctxPct === undefined ? [] : [gauge(`context ${ctxPct}% ${Math.round(ctxTokens / 1000)}k/${Math.round(ctxWindow / 1000)}k`, ctxPct)]), ...rate.map(r => gauge(`${r.kind === 'five_hour' ? '5h' : '7d'} ${r.pct}%`, r.pct))]
  if (gauges.length > 0) out.push(box('Context and limits', gauges))
  out.push(web)
  return { type: 'panel', children: out }
}

// The panel's words alone, for a model that calls the tool.
export function words(node) {
  if (typeof node === 'string') return node
  if (node.type === 'box') return `${node.title}\n${node.children.map(words).join('')}\n`
  if (node.type === 'gauge') return `${node.label}\n`
  if (node.type === 'bars') return node.bars.map(b => `${b.label} ${b.text ?? b.value}\n`).join('')
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
export function answer(msg, chats, dismissed = new Set()) {
  const { method, params = {} } = msg
  if (method === 'initialize') return { protocolVersion: params.protocolVersion ?? '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'agentmon-live', version: '1' } }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: TOOLS }
  if (method === 'resources/list') return { resources: [{ uri: STATUSLINE_URI, name: 'statusline', mimeType: 'application/json' }, { uri: PANE_URI, name: 'pane', mimeType: 'application/json' }] }
  if (method === 'resources/read') {
    const chat = () => pickChat(chats(), threadOf(params._meta))
    if (params.uri === PANE_URI) return { contents: [{ uri: PANE_URI, mimeType: 'application/json', text: JSON.stringify(paneTree(chat(), dismissed)) }] }
    if (params.uri !== STATUSLINE_URI) throw Object.assign(new Error(`unknown resource ${params.uri}`), { code: -32002 })
    const tree = { type: 'text', children: [statusText(chat(), dismissed)] }
    return { contents: [{ uri: STATUSLINE_URI, mimeType: 'application/json', text: JSON.stringify(tree) }] }
  }
  if (method === 'tools/call') {
    const args = params.arguments ?? {}
    if (params.name === 'feedback') return { content: [{ type: 'text', text: feedbackLink(args) }] }
    if (params.name === 'statusline') return { content: [{ type: 'text', text: statusText(pickChat(chats()), dismissed) }] }
    if (params.name === 'pane') return { content: [{ type: 'text', text: words(paneTree(pickChat(chats()), dismissed)) }] }
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
  createInterface({ input }).on('line', line => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    // A notification has no id and gets no reply.
    if (msg.id === undefined) return
    let reply
    try {
      reply = { jsonrpc: '2.0', id: msg.id, result: answer(msg, chats, dismissed) }
    } catch (e) {
      reply = { jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: String(e.message ?? e) } }
    }
    output.write(`${JSON.stringify(reply)}\n`)
  })
}

if (process.argv[2] === 'serve') serve()
