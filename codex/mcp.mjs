// The repo's MCP server for Codex: a live status line under the prompt and the feedback tool. JSON-RPC over stdio, one message per line.
import { createInterface } from 'node:readline'

import { codexHome, readCodex } from '../server/codex.mjs'
import { codexGaps } from './gate.mjs'

export const STATUSLINE_URI = 'ui://agentmon-live/statusline'
export const PANE_URI = 'ui://agentmon-live/pane'
const ISSUES = 'https://github.com/codenotary/agentmon-live/issues/new'
const KINDS = ['problem', 'idea', 'thanks', 'other']
const MAX_TEXT = 2000
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
    description: "The AgentMon Live pane for the current Codex chat, as a coloured UI tree: open done-gate items, the running call, checks, recent calls, edited files, context and limits. Codex's sidebar reads it; nothing to call by hand.",
    inputSchema: { type: 'object', properties: {} },
    _meta: { 'openai/ui': { entrypoints: [{ type: 'sidebar', resourceUri: PANE_URI }] } },
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

export function statusText(snapshot) {
  if (!snapshot) return `AgentMon · no live Codex chat · ${WEB}`
  const gaps = codexGaps(snapshot)
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
const BAR = 16
// Codex's UI tree, the status line's format: coloured text, at most 256 nodes and 16 KiB of text.
const paint = (color, text, bold) => ({ type: 'text', props: { ...(color ? { color } : {}), ...(bold ? { weight: 'bold' } : {}) }, children: [text] })
const one = (text, n = 80) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const head = (title, color = 'cyan') => paint(color, `\n● ${title.toUpperCase()}\n`, true)
// A bar in eighths of a cell on a shaded track, as the Claude Code pane draws them.
function bar(part, color) {
  const eighths = Math.round(Math.max(0, Math.min(1, part)) * BAR * 8)
  const full = `${'█'.repeat(Math.floor(eighths / 8))}${eighths % 8 ? ' ▏▎▍▌▋▊▉'[eighths % 8] : ''}`
  return [paint(color, full), paint('blue', '░'.repeat(BAR - [...full].length))]
}
const level = pct => (pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green')
const meter = (label, pct, note = '') => [`${label} `, ...bar(pct / 100, level(pct)), ` ${pct}%${note}\n`]

// The pane holds no running clock: Codex redraws the sidebar whenever this tree changes.
export function paneTree(snapshot) {
  const out = [paint(undefined, 'AgentMon Live', true)]
  if (!snapshot) return { type: 'text', children: [...out, '\n\nNo Codex chat written to in the last 30 minutes.\n\n', { type: 'link', props: { href: WEB }, children: ['Open the web view'] }] }
  out.push(paint('blue', ` · ${[snapshot.build, snapshot.main.model, snapshot.main.effort].filter(Boolean).join(' · ')}\n`))
  const gaps = codexGaps(snapshot)
  out.push(head('Needs attention', gaps.length > 0 ? 'red' : 'green'))
  if (gaps.length === 0) out.push(paint('green', '✓ nothing open\n'))
  for (const g of gaps.slice(0, 5)) out.push(g.includes(' failed: ') ? paint('red', ' FAILED ', true) : paint('yellow', ' STALE ', true), ` ${one(g)}\n`)
  out.push(head('Now'))
  if (snapshot.active.length === 0) out.push(paint('blue', 'idle\n'))
  for (const a of snapshot.active.slice(0, 3)) out.push(paint('yellow', '◉ ', true), paint(undefined, `${a.tool} `, true), `${one(a.what)}\n`)
  const turn = snapshot.turns.at(-1)
  if (turn) {
    out.push(head(`Turn ${snapshot.turns.length}`), paint('magenta', `› ${one(String(turn.prompt ?? '').split('\n')[0], 120)}\n`))
    const spent = Object.entries(turn.isLive ? {} : turn.buckets).sort((a, b) => b[1] - a[1]).slice(0, 6)
    const most = Math.max(1, ...spent.map(([, ms]) => ms))
    for (const [k, ms] of spent) out.push(`${k} `, ...bar(ms / most, 'cyan'), ` ${secs(ms)}\n`)
  }
  if (snapshot.checks.length > 0) {
    out.push(head('Checks'))
    for (const c of snapshot.checks.slice(-6)) out.push(c.result === 'ok' ? paint('green', '✓ ') : c.result === 'running' ? paint('yellow', '◉ ') : paint('red', '✗ '), paint(undefined, `${c.kind} `, true), `${one(c.command, 60)}\n`)
  }
  const recent = snapshot.trace.slice(-RECENT).reverse()
  if (recent.length > 0) {
    out.push(head('Recent calls'))
    for (const c of recent) out.push(paint(c.isFailed ? 'red' : undefined, `${c.tool} `, true), `${one(c.what, 60)}\n`)
  }
  const cwd = `${snapshot.session.cwd}/`
  const edited = snapshot.files.edited.map(f => (f.startsWith(cwd) ? f.slice(cwd.length) : f))
  if (edited.length > 0) out.push(head(`Files edited (${edited.length})`), `${edited.slice(-RECENT).map(f => one(f)).join('\n')}\n`)
  const { ctxPct, ctxTokens, ctxWindow, rate = [] } = snapshot.usage
  if (ctxPct !== undefined || rate.length > 0) {
    out.push(head('Context and limits'))
    if (ctxPct !== undefined) out.push(...meter('context', ctxPct, ` ${Math.round(ctxTokens / 1000)}k/${Math.round(ctxWindow / 1000)}k`))
    for (const r of rate) out.push(...meter(r.kind === 'five_hour' ? '5h' : '7d', r.pct))
  }
  out.push('\n', { type: 'link', props: { href: WEB }, children: ['Open the web view'] })
  return { type: 'text', children: out }
}

// The tree's words alone, for a model that calls the tool.
const words = node => (typeof node === 'string' ? node : node.children.map(words).join(''))

export function feedbackLink({ type, text }) {
  const said = String(text ?? '').trim()
  if (!KINDS.includes(String(type))) return `Not taken: type must be one of ${KINDS.join(', ')}.`
  if (!said) return 'Not taken: text is required.'
  if ([...said].length > MAX_TEXT) return `Not taken: text takes at most ${MAX_TEXT} characters.`
  const title = [...said.split('\n')[0]].slice(0, 80).join('')
  const link = `${ISSUES}?${new URLSearchParams({ title, body: `${said}\n\nAgentMon Live · Codex`, labels: type === 'idea' ? 'enhancement' : 'bug' })}`
  return `Nothing was sent. Give the person this link; they read the issue and submit it themselves:\n${link}`
}

export function answer(msg, chats) {
  const { method, params = {} } = msg
  if (method === 'initialize') return { protocolVersion: params.protocolVersion ?? '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'agentmon-live', version: '1' } }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: TOOLS }
  if (method === 'resources/list') return { resources: [{ uri: STATUSLINE_URI, name: 'statusline', mimeType: 'application/json' }, { uri: PANE_URI, name: 'pane', mimeType: 'application/json' }] }
  if (method === 'resources/read') {
    const chat = () => pickChat(chats(), threadOf(params._meta))
    if (params.uri === PANE_URI) return { contents: [{ uri: PANE_URI, mimeType: 'application/json', text: JSON.stringify(paneTree(chat())) }] }
    if (params.uri !== STATUSLINE_URI) throw Object.assign(new Error(`unknown resource ${params.uri}`), { code: -32002 })
    const tree = { type: 'text', children: [statusText(chat())] }
    return { contents: [{ uri: STATUSLINE_URI, mimeType: 'application/json', text: JSON.stringify(tree) }] }
  }
  if (method === 'tools/call') {
    const args = params.arguments ?? {}
    if (params.name === 'feedback') return { content: [{ type: 'text', text: feedbackLink(args) }] }
    if (params.name === 'statusline') return { content: [{ type: 'text', text: statusText(pickChat(chats())) }] }
    if (params.name === 'pane') return { content: [{ type: 'text', text: words(paneTree(pickChat(chats()))) }] }
    throw Object.assign(new Error(`unknown tool ${params.name}`), { code: -32602 })
  }
  throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 })
}

export function serve(input = process.stdin, output = process.stdout) {
  const cache = new Map()
  const chats = () => readCodex(codexHome(), Date.now(), IDLE_MS, cache)
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
      reply = { jsonrpc: '2.0', id: msg.id, result: answer(msg, chats) }
    } catch (e) {
      reply = { jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: String(e.message ?? e) } }
    }
    output.write(`${JSON.stringify(reply)}\n`)
  })
}

if (process.argv[2] === 'serve') serve()
