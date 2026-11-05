import type { Card, TraceCall } from '../../types/index'

import { prefixOf, type Tone } from './format.ts'

// 0 needs no attention, 1 is worth a look, 2 needs one.
export type Level = 0 | 1 | 2
export type Pips = { duration: Level; tokens: Level; errors: Level }
export type AgentLine = { a: Card; pips: Pips; worst: Level }
export type Totals = { count: number; running: number; failed: number; tokens: number; usd: number }
export type SortKey = 'elapsed' | 'calls' | 'tokens' | 'usd' | 'errors' | 'files' | 'health'
export type Sort = { key: SortKey; isDesc: boolean } | null
export type Item = { kind: 'agent'; line: AgentLine } | { kind: 'group'; prefix: string; lines: AgentLine[]; pips: Pips; worst: Level; totals: Totals; from: number; to: number; calls: number; errors: number; files: number }

const LONG_RUN_MS = 5 * 60_000
const MANY_INPUT_TOKENS = 1_000_000
// More than this many sharing a prefix fold into one row: a fan-out stays on one screen.
const GROUP_OVER = 8

export const LEVEL_TONE: Record<Level, Tone> = { 0: 'good', 1: 'warn', 2: 'bad' }
export const isRunning = (a: Pick<Card, 'status'>) => a.status === 'running' || a.status === 'waiting'
export const isFailed = (a: Pick<Card, 'status' | 'tests'>) => a.status === 'error' || a.tests === 'FAIL'
// An agent the engine dropped has a final status and no `endedAt`: its time stops at its last sign of life, not at now.
export const endOf = (a: Pick<Card, 'status' | 'startedAt' | 'endedAt' | 'lastAt'>, now: number) => a.endedAt ?? (isRunning(a) ? now : (a.lastAt ?? a.startedAt))
export const dotOf = (a: Pick<Card, 'status' | 'tests'>) => (isFailed(a) ? 'error' : a.status)
export const elapsedOf = (a: Pick<Card, 'status' | 'startedAt' | 'endedAt' | 'lastAt'>, now: number) => endOf(a, now) - a.startedAt
export const tokensOf = (a: Pick<Card, 'input' | 'output'>) => a.input + a.output

export function medianOf(list: readonly number[]): number {
  if (list.length === 0) return 0
  const sorted = [...list].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid] ?? 0
  return sorted.length % 2 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2
}

// Against the session's own agents, so the rule holds for a 4-call review and a 60-call refactor alike.
const levelOver = (value: number, median: number): Level => (median <= 0 ? 0 : value > 3 * median ? 2 : value > 1.5 * median ? 1 : 0)

export function pipsOf(a: Card, median: { ms: number; tokens: number }, now: number, isLastFailed: boolean): Pips {
  const ms = elapsedOf(a, now)
  const errors = a.errors ?? 0
  return {
    duration: isRunning(a) && ms > LONG_RUN_MS ? 2 : levelOver(ms, median.ms),
    tokens: a.input > MANY_INPUT_TOKENS ? 2 : levelOver(tokensOf(a), median.tokens),
    errors: errors >= 2 || isLastFailed ? 2 : errors === 1 ? 1 : 0,
  }
}

const worstOf = (p: Pips) => Math.max(p.duration, p.tokens, p.errors) as Level

export function linesOf(agents: readonly Card[], trace: readonly TraceCall[], now: number): AgentLine[] {
  const finished = agents.filter(a => !isRunning(a))
  const median = { ms: medianOf(finished.map(a => elapsedOf(a, now))), tokens: medianOf(finished.map(tokensOf)) }
  const lastFailed = new Map<string, boolean>()
  for (const c of trace) if (c.agentId !== undefined) lastFailed.set(c.agentId, Boolean(c.isFailed))
  return agents.map(a => {
    const pips = pipsOf(a, median, now, lastFailed.get(a.id) ?? false)
    return { a, pips, worst: worstOf(pips) }
  })
}

export function totalsOf(agents: readonly Card[]): Totals {
  return {
    count: agents.length,
    running: agents.filter(isRunning).length,
    failed: agents.filter(isFailed).length,
    tokens: agents.reduce((n, a) => n + tokensOf(a), 0),
    usd: agents.reduce((n, a) => n + (a.usd ?? 0), 0),
  }
}

const VALUE: Record<SortKey, (l: AgentLine, now: number) => number> = {
  elapsed: (l, now) => elapsedOf(l.a, now),
  calls: l => l.a.tools,
  tokens: l => tokensOf(l.a),
  usd: l => l.a.usd ?? 0,
  errors: l => l.a.errors ?? 0,
  files: l => l.a.files,
  health: l => l.worst,
}

// Running agents stay on top until the person picks a column; then the worst first, so what needs a look leads while the session runs.
export function sortLines(lines: readonly AgentLine[], sort: Sort, now: number): AgentLine[] {
  const by = sort
    ? (x: AgentLine, y: AgentLine) => (VALUE[sort.key](x, now) - VALUE[sort.key](y, now)) * (sort.isDesc ? -1 : 1)
    : (x: AgentLine, y: AgentLine) => Number(isRunning(y.a)) - Number(isRunning(x.a)) || y.worst - x.worst
  return [...lines].sort((x, y) => by(x, y) || x.a.startedAt - y.a.startedAt)
}

export function groupLines(lines: readonly AgentLine[], now: number): Item[] {
  const byPrefix = new Map<string, AgentLine[]>()
  for (const l of lines) {
    const prefix = prefixOf(l.a.task)
    if (prefix) byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), l])
  }
  const done = new Set<string>()
  const items: Item[] = []
  for (const line of lines) {
    const prefix = prefixOf(line.a.task)
    const members = byPrefix.get(prefix) ?? []
    if (members.length <= GROUP_OVER) {
      items.push({ kind: 'agent', line })
      continue
    }
    if (done.has(prefix)) continue
    done.add(prefix)
    const cards = members.map(m => m.a)
    const pips: Pips = {
      duration: Math.max(...members.map(m => m.pips.duration)) as Level,
      tokens: Math.max(...members.map(m => m.pips.tokens)) as Level,
      errors: Math.max(...members.map(m => m.pips.errors)) as Level,
    }
    items.push({
      kind: 'group',
      prefix,
      lines: members,
      pips,
      worst: worstOf(pips),
      totals: totalsOf(cards),
      from: Math.min(...cards.map(a => a.startedAt)),
      to: Math.max(...cards.map(a => endOf(a, now))),
      calls: cards.reduce((n, a) => n + a.tools, 0),
      errors: cards.reduce((n, a) => n + (a.errors ?? 0), 0),
      files: cards.reduce((n, a) => n + a.files, 0),
    })
  }
  return items
}
