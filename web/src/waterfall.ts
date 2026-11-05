import type { Active, Card, TraceCall, WebTurn } from '../../types/index'

import { agentNames } from './format.ts'

export type BarState = 'ok' | 'failed' | 'running' | 'asking'
export type Row = { key: string; name: string; full?: string; what: string; depth: number; from: number; to: number; ms?: number; state: BarState; isAgent: boolean; isSlowest: boolean; call?: TraceCall }
export type WaterfallInput = { trace?: TraceCall[]; agents: Card[]; active: Active[] }

// A subagent's own row stands for the call that started it.
const STARTS_AGENT = /^(Agent|Task)$/

export const spanOf = (t: WebTurn, now: number) => ({ from: t.startedAt, to: t.isLive ? now : t.startedAt + t.wallMs })

// An agent can outlive the turn that started it: the axis takes in every row, so no bar is cut off at the edge.
export const fitSpan = (span: { from: number; to: number }, rows: readonly { from: number; to: number }[]) => ({
  from: Math.min(span.from, ...rows.map(r => r.from)),
  to: Math.max(span.to, ...rows.map(r => r.to)),
})

const TICK_STEPS_MS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]
const MAX_TICKS = 5
// Round steps, so the axis never reads 0s 1s 3s 4s.
export function ticksOf(ms: number): { step: number; at: number[] } {
  const step = TICK_STEPS_MS.find(x => ms / x <= MAX_TICKS) ?? Math.ceil(ms / MAX_TICKS / 3_600_000) * 3_600_000
  return { step, at: Array.from({ length: Math.ceil(ms / step) }, (_, i) => i * step) }
}

// With nothing to show yet, a new turn would blank the chart: the newest turn with rows stands in until its first call.
export function followedTurn(d: WaterfallInput, turns: readonly WebTurn[], mainName: string, now: number): WebTurn | undefined {
  return turns.findLast(t => rowsOf(d, spanOf(t, now), mainName, now).length > 0) ?? turns.at(-1)
}

export const xOf = (at: number, from: number, to: number) => Math.min(100, Math.max(0, ((at - from) / Math.max(1, to - from)) * 100))

// A turn's calls in the order they started, each subagent's nested under it, so a stall shows as a long bar or a gap.
// shortcut: the session keeps the last 200 calls, so a longer turn loses its start; raise KEEP_TRACE if people hit it.
export function rowsOf(d: WaterfallInput, span: { from: number; to: number }, mainName: string, now: number): Row[] {
  const { from, to } = span
  const running = new Map(d.active.map(a => [a.id, a]))
  const callRow = (c: TraceCall, depth: number): Row => {
    const live = running.get(c.id)
    const state: BarState = c.isFailed ? 'failed' : c.ms !== undefined || !live ? 'ok' : live.isAsking ? 'asking' : 'running'
    const end = c.ms !== undefined ? c.at + c.ms : live ? now : c.at
    return { key: c.id, name: c.tool, what: c.what, depth, from: c.at, to: end, ...(c.ms === undefined ? {} : { ms: c.ms }), state, isAgent: false, isSlowest: false, call: c }
  }
  const names = agentNames(d.agents)
  const agents = d.agents.filter(a => a.startedAt <= to && (a.endedAt ?? now) >= from)
  const nested = new Map<string, TraceCall[]>(agents.map(a => [a.id, []]))
  const blocks: { at: number; rows: Row[] }[] = []
  for (const c of d.trace ?? []) {
    if (c.at < from || c.at > to) continue
    if (c.agentId === undefined && c.who === mainName) {
      if (!STARTS_AGENT.test(c.tool)) blocks.push({ at: c.at, rows: [callRow(c, 0)] })
      continue
    }
    // Parallel agents of one type all fit the type and time, so those only serve a session of an older version.
    const owner = c.agentId !== undefined ? agents.find(a => a.id === c.agentId) : agents.filter(a => a.type === c.who && a.startedAt <= c.at && (a.endedAt ?? now) >= c.at).at(-1)
    if (owner) nested.get(owner.id)?.push(c)
    else blocks.push({ at: c.at, rows: [callRow(c, 1)] })
  }
  for (const a of agents) {
    const end = a.endedAt ?? now
    const head: Row = { key: `agent:${a.id}`, name: names.get(a.id)?.short ?? a.type, full: names.get(a.id)?.full, what: a.type, depth: 0, from: a.startedAt, to: end, ms: end - a.startedAt, state: a.status === 'error' ? 'failed' : a.endedAt === undefined ? 'running' : 'ok', isAgent: true, isSlowest: false }
    blocks.push({ at: a.startedAt, rows: [head, ...(nested.get(a.id) ?? []).map(c => callRow(c, 1))] })
  }
  const rows = blocks.sort((a, b) => a.at - b.at).flatMap(b => b.rows)
  const slowest = rows.filter(r => !r.isAgent && r.ms).sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))[0]
  return rows.map(r => (r === slowest ? { ...r, isSlowest: true } : r))
}
