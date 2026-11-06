import type { BenchRow } from '../../types/index'
import { medianOf } from './agents.ts'
import type { Tone } from './format.ts'

const MIN_ROWS = 3
const AHEAD_BY_PCT = 5
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

// Median of this project's earlier sessions. Only rows recorded as they ran: a row read back from a transcript counts turns its own way and has no whole-session cost.
export function typicalOf(rows: readonly BenchRow[], currentId: string, pick: (r: BenchRow) => number | undefined): number | undefined {
  const values = rows.filter(r => r.live && r.id !== currentId).map(pick).filter((v): v is number => v !== undefined && v > 0)
  return values.length < MIN_ROWS ? undefined : medianOf(values)
}

// The percent used by now if a plan window were spent evenly up to its reset.
export function paceOf(kind: string, resetsAt: number | undefined, now: number): number | undefined {
  const size = WINDOW_MS[kind]
  if (size === undefined || resetsAt === undefined || resetsAt <= now) return undefined
  return Math.max(0, Math.min(100, (1 - (resetsAt - now) / size) * 100))
}

export const isAheadOfPace = (pct: number, pace: number | undefined) => pace !== undefined && pct > pace + AHEAD_BY_PCT

// For a figure where less is better.
export const bandTone = (value: number, goodTo: number, warnTo: number): Tone => (value <= goodTo ? 'good' : value <= warnTo ? 'warn' : 'bad')

// For a figure where more is better, such as cache hits.
export const reversedLevel = (pct: number | undefined): Tone => (pct === undefined ? '' : pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad')

// shortcut: fixed round figures until a project has three earlier sessions, read a per-model figure if these mislead.
export const GUIDE = { usd: 10, turns: 20 }
export const referenceOf = (typical: number | undefined, guide: number) => ({ value: typical ?? guide, isGuide: typical === undefined })

export const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (raw, key: string) => String(values[key] ?? raw))
