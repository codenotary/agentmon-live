// Kiro Crew writes `crew-log/sessions/<sid>-<digest>/log.jsonl` for a chat on any harness, so reading it needs no plugin inside the chat.
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const kiroHome = () => process.env.KIROCREW_HOME ?? join(homedir(), '.kiro', 'crew')
// Where the server keeps its own files: the account's secret, and the Kiro Crew app's note.
export const stateDir = () => join(homedir(), '.claude', 'agentmon-live')
const LIVE_PATIENCE = 4
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
const KEEP_TURNS = 50
const CUT = 300
const ANSWER_CUT = 4000
const BUCKET = { execute: 'shell', read: 'read', search: 'read', edit: 'edit', fetch: 'web' }
// As in hooks/insights.ts; a test holds them equal.
export const LONG_CALL_MS = 60_000
export const BIG_RESULT_TOKENS = 10_000
export const WAIT_MIN_MS = 30_000
export const WAIT_SHARE = 0.3
// As in hooks/format.ts; a test holds the patterns equal.
const RUN = String.raw`(?:npm|pnpm|yarn|bun)\s+(?:(?:--filter|-F|--prefix|-C|--dir|-w|--workspace)(?:=|\s+)\S+\s+|(?:-r|--recursive)\s+|workspace\s+\S+\s+)*(?:run\s+)?`
const CHECKS = [
  ['typecheck', new RegExp(String.raw`^(?:tsc|${RUN}(?:typecheck|type-check)|mypy|pyright|cargo check)\b`)],
  ['lint', new RegExp(String.raw`^(?:${RUN}lint|eslint|ruff|clippy|golangci-lint|flake8|biome (?:check|lint)|(?:claude )?plugin validate)\b`)],
  ['test', new RegExp(String.raw`^(?:${RUN}(?:test\b|t(?![\w:-]))|go test|cargo test|pytest|unittest|jest|vitest|mocha|node --test|deno test|playwright test|gradlew? test|mvn test|dotnet test|(?:claude )?plugin test|make test)\b`)],
  ['build', new RegExp(String.raw`^(?:${RUN}build|cargo build|go build|make(?!\s+(?:clean|distclean|install|help)\b)|webpack|esbuild|vite build)\b`)],
]
const WRAPPERS = /^(?:\w+=\S*\s+)*(?:(?:npx(?:\s+(?:(?:-p|--package)(?:=|\s+)\S+|-y|--yes))*|bunx|sudo|time|timeout\s+\S+|env(?:\s+\w+=\S*)*|uv run|poetry run|python3? -m)\s+)*(?:\S*\/)?/

// The checks a shell command runs, one per kind, in the order their last part comes: the last one takes a failure.
// shortcut: quoted text and heredocs are not blanked as in hooks/format.ts, so `echo 'x; npm test'` reads as a test; upgrade when Kiro chats show such rows.
export function checksOf(command) {
  const found = new Map()
  for (const part of String(command).split(/&&|\|\||;|\||\n/)) {
    const kind = CHECKS.find(([, re]) => re.test(part.trim().replace(WRAPPERS, '')))?.[0]
    if (!kind) continue
    found.delete(kind)
    found.set(kind, part.trim())
  }
  return [...found].map(([kind, part]) => ({ kind, part }))
}

// A pipe or `||` hides every exit status; past `;` or a newline the shell reports only its last line's.
function hidesExit(command, kind) {
  if (/\|\|/.test(command) || (/[^|]\|[^|]/.test(command) && !/pipefail/.test(command))) return true
  return !checksOf(command.split(/[;\n]/).findLast(l => l.trim()) ?? '').some(c => c.kind === kind)
}

// The crew log gives a call's command and whether it failed, not its output: no counts, and a hidden exit status stays unknown.
// `isUnsure`: the call may not have run. A command cut at `CUT` may hide a pipe or a later check past the cut.
function recordChecks(snap, call, isUnsure) {
  const found = checksOf(call.what)
  const isOpen = isUnsure || call.what.length >= CUT
  for (const [i, { kind, part }] of found.entries()) {
    const old = snap.checks.find(c => c.kind === kind)
    const result = isOpen ? 'unknown' : call.isFailed ? (i === found.length - 1 ? 'failed' : 'unknown') : hidesExit(call.what, kind) ? 'unknown' : 'ok'
    const greenAt = old?.result === 'ok' ? old.at : old?.greenAt
    snap.checks = [...snap.checks.filter(c => c !== old), { kind, command: part, who: WHO, at: call.at, result, ...(greenAt === undefined ? {} : { greenAt }) }]
  }
}
const pad = n => String(n).padStart(2, '0')
// As `dur` in hooks/insights.ts, which the pane prints.
const dur = ms => {
  const s = Math.max(0, ms) / 1000
  const m = Math.floor(s / 60)
  return s < 10 ? `${s.toFixed(1)}s` : s < 60 ? `${Math.round(s)}s` : m < 60 ? `${m}m${pad(Math.floor(s % 60))}s` : `${Math.floor(m / 60)}h${pad(m % 60)}m`
}
const bump = (o, k, n = 1) => {
  o[k] = (o[k] ?? 0) + n
}
function recordEdit(snap, path, at) {
  snap.files.editedTimes[path] = Math.max(snap.files.editedTimes[path] ?? 0, at)
  snap.files.editedAt = Math.max(snap.files.editedAt, at)
  bump(snap.insights.edits, path)
}
// An approval's wait is the person's: off every call open while it waited, onto the turn.
function settle(ask, at, turn) {
  const wait = Math.max(0, at - ask.startedAt)
  for (const c of ask.calls) c.waitMs = (c.waitMs ?? 0) + wait
  if (turn) bump(turn.buckets, 'you', wait)
}
// The crew log times tool calls only; the rest of a turn's wall time is the model's.
const modelMs = t => Math.max(0, t.wallMs - Object.entries(t.buckets).reduce((a, [k, ms]) => a + (k === 'model' ? 0 : ms), 0))
// Secret patterns and `mask` as in hooks/format.ts, where each is explained; a test holds them equal.
const SECRET_NAME = /((?<![a-z])(?:(?:api[_-]?key|token|secret|key|password|passwd|pwd|bearer|authorization)[\w-]{0,40}|sig(?:nature)?(?![a-z])))(["']?\s*[=:]\s*|\s+(?=["']|(?:bearer|basic|token)\s|[^\s"']*\d|[^\s"']{16}))(?:(["'])((?:bearer|basic|token)\s+)?[^"'\n]{1,200}\3|((?:bearer|basic|token)\s+)?[^\s"'&]+)/gi
const PREFIXED_SECRET = /\b([a-z_]{0,40}(?:password|passwd|pass(?:phrase)?|secret|token|api_?key|credentials?|private_?key))(?![a-z])(["']?\s*[=:]\s*)(?:(["'])[^"'\n]{1,200}\3|[^\s"',;]+)/gi
const URL_CREDENTIALS = /:\/\/([^\s:@/]+):[^\s@/]+@/g
const URL_TOKEN = /:\/\/[^\s:@/]{16,}@/g
const SECRET_SHAPE = /\b(?:sk-[\w-]{16,}|[sr]k_(?:live|test)_\w{16,}|gh[pousr]_\w{20,}|hf_\w{20,}|whsec_\w{20,}|ya29\.[\w-]{20,}|xapp-[\w-]{10,}|hooks\.slack\.com\/services\/[\w/]+|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|npm_\w{36}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]+)/g
const FLAG_SECRET = /(\s(?:-u\s*|--user[=\s]\s*)[^\s:"']+:)[^\s"']+|(\b(?:mysql|mysqldump|mariadb)\b[^|;&\n]{0,200}?\s-p)[^\s"']+|(\bsshpass\s+-p\s*|\bdocker\s+login\b[^|;&\n]{0,200}?\s-p\s+|\bredis-cli\b[^|;&\n]{0,200}?\s-a\s+|--password[=\s]\s*)[^\s"']+|(\b(?:set-)?cookie\s*:\s*)[^\n"']+/gi
const BARE_BEARER = /\b(Bearer)\s+[\w.~+/-]{8,}=*/gi
const PRIVATE_KEY = /(-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----)[\s\S]*?(?:-----END[^\n]*|$)/g
export function mask(s) {
  return s
    .replace(PRIVATE_KEY, '$1***')
    .replace(URL_CREDENTIALS, '://$1:***@')
    .replace(URL_TOKEN, '://***@')
    .replace(FLAG_SECRET, (_, user, mysql, flag, cookie) => `${user ?? mysql ?? flag ?? cookie}***`)
    .replace(SECRET_NAME, (_, name, sep, quote, quotedScheme, scheme) => (quote ? `${name}${sep}${quote}${quotedScheme ?? ''}***${quote}` : `${name}${sep}${scheme ?? ''}***`))
    .replace(PREFIXED_SECRET, (_, name, sep, quote = '') => `${name}${sep}${quote}***${quote}`)
    .replace(SECRET_SHAPE, '***')
    .replace(BARE_BEARER, '$1 ***')
}
// Log text goes to the page masked; the first cut keeps the scan cheap on a large input.
const cut = text => mask(String(text ?? '').slice(0, 2000)).slice(0, CUT)
const lines = text => text.split('\n').flatMap(line => {
  // The last line may be half written, and the crew log's own rule is to skip a line that does not parse.
  try {
    return line.trim() ? [JSON.parse(line)] : []
  } catch {
    return []
  }
})

// Entry types this does not know are skipped: the crew log adds types and asks its readers to ignore them.
// `editsOf(card)` gives the files a subagent wrote, `[{ path, at }]`: its own chat is not in this log.
export function foldCrewLog(entries, now, text = new Map(), editsOf = () => []) {
  const head = entries[0]?.type === 'session' ? entries[0] : {}
  const snap = {
    v: 1,
    session: { id: String(head.id ?? ''), cwd: String(head.cwd ?? ''), ...(head.slot ? { slot: String(head.slot) } : {}) },
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
    insights: { slow: [], big: [], reads: {}, edits: {}, session: {}, sessionWall: 0, askedAll: {}, tokens: { mainIn: 0, mainOut: 0, mainCached: 0, agentsIn: 0, agentsOut: 0 } },
    learned: { bench: [] },
  }
  const open = new Map()
  const asking = new Map()
  const rejected = new Set()
  const unsure = new Set()
  const agents = new Map()
  const reads = new Set()
  let credits = 0
  let turn
  let last
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
      if (turn && d.text) turn.answer = mask(String(d.text)).slice(0, ANSWER_CUT)
    } else if (e.type === 'turn/started') {
      // A turn that never reported its end is over once the next one starts.
      if (turn) {
        turn.wallMs = Math.max(0, at - turn.startedAt)
        turn.buckets.model = modelMs(turn)
        delete turn.isLive
      }
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
      last = t
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
      // A call whose approval was rejected still ends as `completed` in the log: it never ran.
      const isRejected = rejected.delete(call.id)
      if (call.kind === 'execute' && !isRejected) recordChecks(snap, call, unsure.delete(call.id))
      const path = isRejected ? undefined : text.get(call.id)?.path
      if (path && !call.isFailed && call.kind === 'edit') recordEdit(snap, path, at)
      else if (path && !call.isFailed && call.kind === 'read') {
        reads.add(path)
        bump(snap.insights.reads, path)
      }
      // A call can end with its approval still open, such as one declined by timeout.
      for (const [k, a] of asking) {
        if (a.call !== call) continue
        settle(a, at, turn)
        asking.delete(k)
      }
      const ran = Math.max(0, call.ms - (call.waitMs ?? 0))
      if (turn) bump(turn.buckets, BUCKET[call.kind] ?? 'other', ran)
      if (ran >= LONG_CALL_MS) snap.insights.slow.push({ tool: call.tool, what: call.what, who: WHO, ms: ran, at })
      const tokens = Math.round((Number(d.result_bytes) || 0) / 4)
      if (tokens >= BIG_RESULT_TOKENS) snap.insights.big.push({ tool: call.tool, what: call.what, tokens, at })
    } else if (e.type === 'approval/requested') {
      // The gateway asks for the call it holds; the log does not name it, so only a lone open call is taken for it.
      const calls = [...open.values()]
      const call = calls.length === 1 ? calls[0] : undefined
      const ask = { id: call?.id ?? String(d.approval_id), who: WHO, tool: String(d.tool || call?.tool || 'approval'), what: cut(d.reason), startedAt: at, isAsking: true, call, calls }
      asking.set(String(d.approval_id), ask)
      bump(snap.insights.askedAll, ask.what)
    } else if (e.type === 'approval/decided') {
      const ask = asking.get(String(d.approval_id))
      asking.delete(String(d.approval_id))
      // With several calls open the log does not say which one was rejected: none of them is known to have run.
      if (ask && d.decision === 'rejected') ask.call ? rejected.add(ask.call.id) : ask.calls.forEach(c => unsure.add(c.id))
      if (ask) settle(ask, at, turn)
    }
    else if (e.type === 'subagent/spawned') {
      const card = { id: String(d.agent_id), type: String(d.agent || 'subagent'), model: String(d.model ?? ''), effort: '', task: cut(String(d.task ?? '').split('\n')[0]), status: 'running', files: 0, tools: 0, input: 0, output: 0, startedAt: at, prompt: mask(String(d.task ?? '')).slice(0, ANSWER_CUT), callId: [...open.keys()].at(-1) }
      agents.set(card.id, card)
      snap.log.push({ at, who: card.type, what: card.task, result: 'started', agentId: card.id })
    } else if (e.type === 'subagent/completed' || e.type === 'subagent/failed') {
      const card = agents.get(String(d.agent_id))
      if (!card) continue
      card.status = e.type === 'subagent/completed' ? 'done' : d.outcome === 'stopped' ? 'cancelled' : 'error'
      card.endedAt = at
      // Why it failed, such as the model provider throttling; the page shows it on the card and in Events.
      if (d.reason) card.testsWhy = cut(d.reason)
      credits += Number(d.credits) || 0
      snap.log.push({ at, who: card.type, what: card.task, result: card.status === 'done' ? 'done' : 'failed', agentId: card.id })
    } else if (e.type === 'plan/updated' && Array.isArray(d.items)) snap.tasks = d.items.map(i => ({ id: String(i.id), subject: cut(i.text), status: i.state === 'done' ? 'completed' : 'pending', at }))
  }

  for (const call of snap.trace) {
    delete call.kind
    delete call.waitMs
  }
  for (const t of snap.turns) {
    if (t === turn) continue
    snap.insights.sessionWall += t.wallMs
    for (const [k, ms] of Object.entries(t.buckets)) bump(snap.insights.session, k, ms)
  }
  if (turn) {
    for (const a of asking.values()) bump(turn.buckets, 'you', Math.max(0, now - a.startedAt))
    turn.wallMs = Math.max(0, now - turn.startedAt)
    turn.buckets.model = modelMs(turn)
    snap.main.turnAt = turn.startedAt
    snap.main.turnLive = true
  }
  const asks = [...asking.values()].map(({ call, calls, ...a }) => a)
  const held = new Set(asks.map(a => a.id))
  const calls = [...open.values()].filter(c => !held.has(c.id)).map(c => ({ id: c.id, who: c.who, tool: c.tool, what: c.what, startedAt: c.at }))
  // A subagent runs on after the call that started it returned, so it shows as running in its own right.
  const running = [...agents.values()].filter(a => a.status === 'running').map(a => ({ id: a.id, who: a.type, tool: 'subagent', what: a.task, startedAt: a.startedAt, agentId: a.id }))
  snap.active = [...calls, ...asks, ...running]
  snap.agents = [...agents.values()]
  for (const card of snap.agents) {
    const edits = editsOf(card)
    card.files = new Set(edits.map(x => x.path)).size
    for (const { path, at } of edits) recordEdit(snap, path, at)
  }
  snap.insights.slow.sort((a, b) => b.ms - a.ms)
  snap.insights.big.sort((a, b) => b.tokens - a.tokens)
  snap.focus = focusOf(snap, asks, calls, last, now)
  snap.files.edited = Object.keys(snap.files.editedTimes)
  snap.files.read = [...reads]
  // kiro-cli reports credits in place of tokens and cost; the page then draws them where the cost stands.
  if (credits > 0) snap.usage.credits = credits
  snap.turns = snap.turns.slice(-KEEP_TURNS)
  snap.trace = snap.trace.slice(-KEEP)
  snap.log = snap.log.slice(-KEEP)
  return { snapshot: snap, isClosed, isLive: Boolean(turn) }
}

// What the page lists under Events, as the mod's Focus does: an approval or a failed subagent is urgent.
function focusOf(snap, asks, calls, last, now) {
  const out = asks.map(a => ({ key: `ask:${a.id}`, tag: 'approval', text: `${a.tool} ${a.what}`, isUrgent: true }))
  for (const a of snap.agents) if (a.status === 'error') out.push({ key: `agent:${a.id}`, tag: LABELS.status.error, text: `${a.type} ${a.testsWhy ?? a.task}`, isUrgent: true })
  for (const c of calls) if (now - c.startedAt >= LONG_CALL_MS) out.push({ key: `slow:${c.id}`, tag: 'slow', text: `${c.tool} ${c.what} running ${dur(now - c.startedAt)}`, isUrgent: false })
  const you = last?.buckets.you ?? 0
  if (you >= WAIT_MIN_MS && last.wallMs > 0 && you / last.wallMs >= WAIT_SHARE) out.push({ key: `wait:${last.startedAt}`, tag: 'waiting', text: `approvals held up ${dur(you)} of the last ${dur(last.wallMs)} turn`, isUrgent: false })
  return out
}

// The files a subagent wrote, from kiro-cli's own transcript of its chat; `subagents/<id>/` goes once the result is delivered, so the caller keeps what it read.
// shortcut: both are internal formats of Kiro Crew and kiro-cli, and kiro-cli's home is taken as the crew home's parent; drop this once the crew log reports a subagent's tool calls.
export function subagentEdits(home, id, since) {
  if (!/^[\w-]+$/.test(String(id))) return undefined
  try {
    const { session_id: sid } = JSON.parse(readFileSync(join(home, 'subagents', id, 'state.json'), 'utf8'))
    if (!/^[\w-]+$/.test(String(sid))) return undefined
    const file = join(dirname(home), 'sessions', 'cli', `${sid}.jsonl`)
    const { mtimeMs, size } = statSync(file)
    // Size too: a write in the same mtime tick as the last read must not look unchanged.
    const mtime = `${mtimeMs}:${size}`
    if (since?.mtime === mtime) return since
    // Only what was appended since the last read, up to the last whole line; a shorter file was rewritten and is read again.
    const start = since?.offset <= size ? since.offset : 0
    const buf = Buffer.alloc(size - start)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buf, 0, buf.length, start)
    } finally {
      closeSync(fd)
    }
    const end = buf.lastIndexOf(10) + 1
    const edits = start ? [...since.edits] : []
    let at = start ? since.at : 0
    for (const row of lines(buf.subarray(0, end).toString('utf8'))) {
      const d = row.data ?? {}
      at = Number(d.meta?.timestamp) * 1000 || at
      if (row.kind !== 'ToolResults') continue
      for (const c of d.content ?? []) {
        const path = d.results?.[c.data?.toolUseId]?.tool?.kind?.BuiltIn?.FileWrite?.path
        if (c.data?.status === 'success' && typeof path === 'string') edits.push({ path, at })
      }
    }
    return { mtime, edits, at, offset: start + end }
  } catch {
    return undefined
  }
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
      text.set(String(row.meta.tool_call_id), { what: cut(path && !String(row.meta.input).startsWith('{') ? path : input || row.meta.purpose || row.content), path: typeof path === 'string' ? path : undefined, tool })
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
      // A long tool call writes nothing, so a turn under way gets more time; a chat that crashed in one still leaves.
      const isStale = isLive => now - stat.mtimeMs > idleMs * (isLive ? LIVE_PATIENCE : 1)
      // A chat that is closed or idle stays so until its log grows: nothing to fold, and an old log is not read at all.
      if (!hit && isStale(true)) cache.set(file, (hit = { size: stat.size, isDone: true }))
      if (hit?.isDone && hit.size === stat.size) continue
      // The transcript beside the log is rewritten every few seconds; the log is read again only when it grew.
      if (hit?.size !== stat.size) hit = { size: stat.size, entries: lines(readFileSync(file, 'utf8')), agents: hit?.agents ?? new Map() }
      if (hit.side !== side || !hit.text) Object.assign(hit, { side, slot: hit.entries[0]?.slot, text: toolText(home, hit.entries[0]?.slot) })
      cache.set(file, hit)
      const { agents } = hit
      // A finished subagent's transcript is read once more after it ended, then kept.
      const editsOf = card => {
        let seen = agents.get(card.id)
        if (!seen?.isFinal) {
          const got = subagentEdits(home, card.id, seen)
          // A read that failed is tried again on the next poll.
          agents.set(card.id, (seen = { ...(got ?? seen), isFinal: got !== undefined && card.status !== 'running' }))
        }
        return seen.edits ?? []
      }
      const { snapshot, isClosed, isLive } = foldCrewLog(hit.entries, now, hit.text, editsOf)
      // Its entries are not needed again.
      if (isClosed || isStale(isLive)) {
        // A subagent's folder may be gone when the chat goes on, so what was read from it stays.
        cache.set(file, { size: stat.size, isDone: true, agents })
        continue
      }
      if (!/^[\w-]{1,80}$/.test(snapshot.session.id)) continue
      out.push([snapshot.session.id, snapshot])
    } catch {}
  }
  for (const file of cache.keys()) if (!seen.has(file)) cache.delete(file)
  return out
}

// The chat Kiro Crew's tab sits beside, idle or closed: its newest log, as it ended. `cache` keeps each log's slot and its last fold.
export function readKiroSlot(home, slot, now, cache = new Map()) {
  const root = join(home, 'crew-log', 'sessions')
  let best
  const seen = new Set()
  try {
    for (const dir of readdirSync(root)) {
      const file = join(root, dir, 'log.jsonl')
      seen.add(file)
      let head = cache.get(file)
      if (!head) {
        head = { slot: '', createdAt: 0 }
        try {
          const first = JSON.parse(firstLine(file))
          Object.assign(head, { slot: String(first.slot ?? ''), createdAt: Number(first.createdAt) || 0 })
        } catch {}
        cache.set(file, head)
      }
      if (head.slot === slot && (!best || head.createdAt > best.head.createdAt)) best = { file, head }
    }
  } catch {
    return undefined
  }
  for (const file of cache.keys()) if (!seen.has(file)) cache.delete(file)
  if (!best) return undefined
  try {
    const { size } = statSync(best.file)
    if (best.head.size !== size) Object.assign(best.head, { size, snapshot: foldCrewLog(lines(readFileSync(best.file, 'utf8')), now, toolText(home, slot)).snapshot })
    const { snapshot } = best.head
    return /^[\w-]{1,80}$/.test(snapshot.session.id) ? [snapshot.session.id, { ...snapshot, now }] : undefined
  } catch {
    return undefined
  }
}

// A log's first line, without reading a long log whole.
function firstLine(file) {
  const buf = Buffer.alloc(4096)
  const fd = openSync(file, 'r')
  try {
    return buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString('utf8').split('\n', 1)[0]
  } finally {
    closeSync(fd)
  }
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
