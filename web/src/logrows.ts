import type { Active, Card, LogLine, TraceCall } from '../../types/index'
import { firstLine, tone, traceResult, type AgentName, whoOf } from './format.ts'

export type LogRow = {
  key: string
  at: number
  who: string
  what: string
  // Absent on a prompt or a log line.
  tool?: string
  result: string
  ms?: number
  count: number
  agentId?: string
  call?: TraceCall
  isYou: boolean
  isFailed: boolean
  isRunning: boolean
  // A subagent's run row with its calls folded under it.
  run?: { calls: number; failed: number }
  // A call shown under its run row.
  isMember?: boolean
  // Claude's whole answer, on the row that closes a turn.
  answer?: string
}
export type LogChip = 'all' | 'failures' | 'you' | 'agents'
export type StripBar = { count: number; isFailed: boolean; target: number; at: number }

const STRIP_BARS = 60
// A subagent's launch call says what its own log line says.
const LAUNCH_TOOLS = /^(Agent|Task)$/

type Input = {
  log: readonly LogLine[]
  trace?: readonly TraceCall[] | undefined
  turns: readonly { startedAt: number; wallMs?: number; prompt?: string; answer?: string; isLive?: boolean }[]
  agents: readonly Pick<Card, 'id' | 'task' | 'status' | 'startedAt' | 'endedAt'>[]
  active: readonly Pick<Active, 'id'>[]
}

// One subagent is one row: its first line carries the duration and the last line's result. When the log's cap dropped the first line, the lines left stay as they are.
function logLineRows(log: readonly LogLine[], agents: Input['agents'], names: ReadonlyMap<string, AgentName>): LogRow[] {
  const dropped = new Set<LogLine>()
  const firsts = new Map<LogLine, { card: Input['agents'][number]; last?: LogLine }>()
  for (const card of agents) {
    const own = log.filter(x => x.agentId === card.id)
    const first = own[0]
    if (!first || first.what !== card.task || (card.endedAt !== undefined && own.length === 1)) continue
    const last = card.endedAt === undefined ? undefined : own.at(-1)
    if (last) dropped.add(last)
    firsts.set(first, last ? { card, last } : { card })
  }
  return log.filter(x => !dropped.has(x)).map(x => {
    const joined = firsts.get(x)
    const isRunning = joined !== undefined && (joined.card.status === 'running' || joined.card.status === 'waiting')
    const result = joined?.last?.result ?? x.result
    return {
      key: `log:${x.at}:${x.who}:${x.what}`,
      at: x.at,
      who: whoOf(x, names),
      what: x.what,
      result,
      ...(joined?.card.endedAt === undefined ? {} : { ms: joined.card.endedAt - joined.card.startedAt }),
      count: 1,
      ...(x.agentId === undefined ? {} : { agentId: x.agentId }),
      isYou: false,
      isFailed: tone(result) === 'bad' || joined?.card.status === 'error',
      isRunning,
    }
  })
}

const canMerge = (a: LogRow | undefined, b: LogRow): a is LogRow => a !== undefined && a.tool !== undefined && !a.isFailed && !a.isRunning && !b.isFailed && !b.isRunning && a.who === b.who && a.tool === b.tool && a.what === b.what && a.call?.label === b.call?.label

export function logRows({ log, trace = [], turns, agents, active }: Input, you: string, names: ReadonlyMap<string, AgentName>, claude = 'Claude'): LogRow[] {
  const running = new Set(active.map(a => a.id))
  const calls = trace.filter(c => !LAUNCH_TOOLS.test(c.tool)).map((c): LogRow => ({
    key: `call:${c.id}`,
    at: c.at,
    who: whoOf(c, names),
    what: c.what,
    tool: c.tool,
    result: traceResult(c, running.has(c.id)),
    ...(c.ms === undefined ? {} : { ms: c.ms }),
    count: 1,
    ...(c.agentId === undefined ? {} : { agentId: c.agentId }),
    call: c,
    isYou: false,
    isFailed: c.isFailed === true,
    isRunning: traceResult(c, running.has(c.id)) === 'running',
  }))
  const asked = turns.flatMap((t): LogRow[] => (t.prompt ? [{ key: `you:${t.startedAt}`, at: t.startedAt, who: you, what: firstLine(t.prompt), result: '', count: 1, isYou: true, isFailed: false, isRunning: false }] : []))
  // The answer closes its turn: placed at the turn's end, after the done gate's line.
  const answered = turns.flatMap((t): LogRow[] => (t.answer && !t.isLive ? [{ key: `answer:${t.startedAt}`, at: t.startedAt + (t.wallMs ?? 0), who: claude, what: firstLine(t.answer), answer: t.answer, result: '', count: 1, isYou: false, isFailed: false, isRunning: false }] : []))
  const ordered = [...logLineRows(log, agents, names), ...calls, ...asked, ...answered].sort((a, b) => a.at - b.at)
  const merged: LogRow[] = []
  for (const row of ordered) {
    const last = merged.at(-1)
    if (canMerge(last, row)) merged[merged.length - 1] = { ...last, count: last.count + row.count, ms: (last.ms ?? 0) + (row.ms ?? 0) }
    else merged.push(row)
  }
  return merged
}

// One row per subagent run: its calls fold under the row its start wrote, or under its first call when the log's cap dropped that line.
// `open` holds the agents unfolded; their calls follow the run row in time order.
export function foldAgents(rows: readonly LogRow[], open: ReadonlySet<string>): LogRow[] {
  const heads = new Map<string, LogRow>()
  const calls = new Map<string, LogRow[]>()
  for (const r of rows) {
    if (r.agentId === undefined) continue
    if (r.tool === undefined) {
      if (!heads.has(r.agentId)) heads.set(r.agentId, r)
    } else (calls.get(r.agentId) ?? calls.set(r.agentId, []).get(r.agentId)!).push(r)
  }
  const out: LogRow[] = []
  const placed = new Set<string>()
  for (const r of rows) {
    const id = r.agentId
    const head = id === undefined ? undefined : heads.get(id)
    if (id === undefined || (r.tool === undefined && r !== head)) {
      out.push(r)
      continue
    }
    if (placed.has(id) || (r.tool !== undefined && head)) continue
    placed.add(id)
    const own = calls.get(id) ?? []
    const failed = own.filter(c => c.isFailed).reduce((n, c) => n + c.count, 0)
    const base = head ?? { ...r, key: `run:${id}`, tool: undefined, what: '', result: '', call: undefined, ms: undefined }
    // The who column names the agent already; the run row says what it did.
    out.push({ ...base, what: '', run: { calls: own.reduce((n, c) => n + c.count, 0), failed }, isFailed: base.isFailed || failed > 0 })
    if (open.has(id)) out.push(...own.map(c => ({ ...c, isMember: true })))
  }
  return out
}

export const matchesChip = (row: LogRow, chip: LogChip) => (chip === 'all' ? true : chip === 'failures' ? row.isFailed : chip === 'you' ? row.isYou : row.agentId !== undefined)

export const chipCounts = (rows: readonly LogRow[]): Record<LogChip, number> => ({
  all: rows.length,
  failures: rows.filter(r => matchesChip(r, 'failures')).length,
  you: rows.filter(r => matchesChip(r, 'you')).length,
  agents: rows.filter(r => matchesChip(r, 'agents')).length,
})

// Bars over the rows' time span. `target` is the row a click goes to: the bar's first failure, or its first row. An empty stretch has no bar to click.
export function stripOf(rows: readonly LogRow[], bars = STRIP_BARS): (StripBar | null)[] {
  const first = rows[0]
  const last = rows.at(-1)
  if (!first || !last) return []
  const span = last.at - first.at || 1
  const strip: (StripBar | null)[] = Array.from({ length: bars }, () => null)
  rows.forEach((row, i) => {
    const at = Math.min(bars - 1, Math.floor(((row.at - first.at) / span) * bars))
    const bar = strip[at]
    if (!bar) strip[at] = { count: row.count, isFailed: row.isFailed, target: i, at: row.at }
    else strip[at] = { ...bar, count: bar.count + row.count, isFailed: bar.isFailed || row.isFailed, target: row.isFailed && !bar.isFailed ? i : bar.target, at: row.isFailed && !bar.isFailed ? row.at : bar.at }
  })
  return strip
}

// The same row as last time, for `memo`: only a running row's clock moves it.
export const sameRow = (a: LogRow, b: LogRow) => a.key === b.key && a.at === b.at && a.who === b.who && a.what === b.what && a.tool === b.tool && a.result === b.result && a.ms === b.ms && a.count === b.count && a.isFailed === b.isFailed && a.isRunning === b.isRunning && a.run?.calls === b.run?.calls && a.run?.failed === b.run?.failed && a.isMember === b.isMember
