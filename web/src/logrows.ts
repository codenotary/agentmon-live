import type { Card, LogLine, TraceCall } from '../../types/index'
import { firstLine, tone, type AgentName, whoOf } from './format.ts'

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
}
export type LogChip = 'all' | 'failures' | 'you' | 'agents'
export type StripBar = { count: number; isFailed: boolean; target: number; at: number }

const STRIP_BARS = 60
// A subagent's launch call says what its own log line says.
const LAUNCH_TOOLS = /^(Agent|Task)$/

type Input = {
  log: readonly LogLine[]
  trace?: readonly TraceCall[] | undefined
  turns: readonly { startedAt: number; prompt?: string }[]
  agents: readonly Pick<Card, 'id' | 'task' | 'status' | 'startedAt' | 'endedAt'>[]
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

const canMerge = (a: LogRow | undefined, b: LogRow): a is LogRow => a !== undefined && a.tool !== undefined && !a.isFailed && !a.isRunning && !b.isFailed && !b.isRunning && a.who === b.who && a.tool === b.tool && a.what === b.what

export function logRows({ log, trace = [], turns, agents }: Input, you: string, names: ReadonlyMap<string, AgentName>): LogRow[] {
  const calls = trace.filter(c => !LAUNCH_TOOLS.test(c.tool)).map((c): LogRow => ({
    key: `call:${c.id}`,
    at: c.at,
    who: whoOf(c, names),
    what: c.what,
    tool: c.tool,
    result: c.isFailed ? 'failed' : c.ms === undefined ? 'running' : 'ok',
    ...(c.ms === undefined ? {} : { ms: c.ms }),
    count: 1,
    ...(c.agentId === undefined ? {} : { agentId: c.agentId }),
    call: c,
    isYou: false,
    isFailed: c.isFailed === true,
    isRunning: c.ms === undefined && c.isFailed !== true,
  }))
  const asked = turns.flatMap((t): LogRow[] => (t.prompt ? [{ key: `you:${t.startedAt}`, at: t.startedAt, who: you, what: firstLine(t.prompt), result: '', count: 1, isYou: true, isFailed: false, isRunning: false }] : []))
  const ordered = [...logLineRows(log, agents, names), ...calls, ...asked].sort((a, b) => a.at - b.at)
  const merged: LogRow[] = []
  for (const row of ordered) {
    const last = merged.at(-1)
    if (canMerge(last, row)) merged[merged.length - 1] = { ...last, count: last.count + row.count, ms: (last.ms ?? 0) + (row.ms ?? 0) }
    else merged.push(row)
  }
  return merged
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
