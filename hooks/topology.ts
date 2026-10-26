import type { Advisor, Card, Check, Flow, Main } from '../types'
import { CATEGORIES } from './i18n'
import type { Category } from './i18n'

export type Topo = {
  session: { model: string; effort: string; uptimeMs: number; cost?: number; compactions: number }
  context?: number
  limits: { kind: string; percent: number; resetsAt?: number }[]
  tools: { cat: Category; total: number; perMin: number; errors: number }[]
  agents: { type: string; model: string; status: Card['status']; isFail: boolean }[]
  fable: { state: 'off' | NonNullable<Advisor['state']>; verdicts: boolean[] }
  checks: { kind: Check['kind']; result: Check['result'] }[]
  callsPerMin: number
}

type Usage = { startedAt: number; context: { percent?: number }; cost?: { usd: number }; rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] }

// Everything the topology views draw, from what the pane already reads; pure, so both views and tests share it.
export function topology(input: {
  main: Main
  counts: Record<string, number>
  errors: Record<string, number>
  compactions: number
  agents: Card[]
  usage: Usage
  advisor: Advisor
  isListening: boolean
  checks: Check[]
  flow: Flow[]
  now: number
}): Topo {
  const { now } = input
  const recent = input.flow.filter(f => now - f.at < 60_000)
  const perMin = (cat: string) => recent.filter(f => f.cat === cat).length
  const reset = (s?: string) => (s && !Number.isNaN(Date.parse(s)) ? Date.parse(s) : undefined)
  return {
    session: {
      model: input.main.model,
      effort: input.main.effort,
      uptimeMs: Math.max(0, now - input.usage.startedAt),
      cost: input.usage.cost?.usd,
      compactions: input.compactions,
    },
    context: input.usage.context.percent,
    limits: input.usage.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: reset(r.resetsAt) })),
    tools: [...CATEGORIES, 'other' as const]
      .map(cat => ({ cat, total: input.counts[cat] ?? 0, perMin: perMin(cat), errors: input.errors[cat] ?? 0 }))
      .filter(x => x.total > 0),
    agents: input.agents.map(a => ({ type: a.type, model: a.model, status: a.status, isFail: a.tests === 'FAIL' || a.status === 'error' })),
    fable: {
      state: !input.isListening ? 'off' : (input.advisor.state ?? 'idle'),
      verdicts: input.advisor.notes.slice(-3).map(n => n.ok !== false),
    },
    checks: input.checks.map(c => ({ kind: c.kind, result: c.result })),
    callsPerMin: recent.length,
  }
}

// A limit's short name for a narrow label: five_hour -> 5h.
export const limitName = (kind: string) => kind.replace('five_hour', '5h').replace('seven_day', '7d').replace(/_/g, ' ')

export const isRunning = (a: Topo['agents'][number]) => a.status === 'running' || a.status === 'waiting'

// The one place the gauges turn warning and alarm colours.
export const isHigh = (p: number) => p >= 80
export const isMid = (p: number) => p >= 50

// How full each row of a gauge is, in eighths (0..8), bottom row first: tanks on the canvas and in the flow share it.
export function fillEighths(fraction: number, rows: number): number[] {
  const level = Math.max(0, Math.min(1, fraction)) * rows * 8
  return Array.from({ length: rows }, (_, r) => Math.max(0, Math.min(8, Math.round(level - r * 8))))
}
