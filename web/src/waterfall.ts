import type { Active, Card, TraceCall } from '../../types/index'

import { endOf, isRunning } from './agents.ts'
import { agentNames, traceResult } from './format.ts'
import type { Detail } from './store.ts'

// `unknown`: no end, and the session no longer runs it (lost, for example to a module reload), as `traceResult` says.
export type BarState = 'ok' | 'failed' | 'running' | 'asking' | 'unknown'
export type Row = { key: string; name: string; full?: string; what: string; depth: number; from: number; to: number; ms?: number; state: BarState; isAgent: boolean; isSlowest: boolean; call?: TraceCall }
export type WaterfallInput = { trace?: TraceCall[]; agents: Card[]; active: Active[] }

// A subagent's own row stands for the call that started it.
export const STARTS_AGENT = /^(Agent|Task)$/

// Every tool call for the table, so an agent's row and its calls agree. `calls` holds only git, shell and MCP, with the longer error text; a session of an older version sends only that.
export function tableRows(d: { trace?: TraceCall[]; calls: readonly (Omit<Detail, 'view'> & { view: string })[]; active: readonly { id: string }[] }): Detail[] {
  if (!d.trace) return [...d.calls]
  const running = new Set(d.active.map(a => a.id))
  const fuller = new Map(d.calls.map(c => [c.id, c.error]))
  return d.trace.map(c => {
    const error = fuller.get(c.id) ?? c.error
    return {
      id: c.id,
      at: c.at,
      who: c.who,
      view: c.tool,
      what: c.what,
      result: traceResult(c, running.has(c.id)),
      ...(c.ms === undefined ? {} : { ms: c.ms }),
      ...(error ? { error } : {}),
      ...(c.agentId === undefined ? {} : { agentId: c.agentId }),
    }
  })
}

export type CallColumn = 'at' | 'who' | 'what' | 'result'
export type CallSort = { id: CallColumn; isDesc: boolean }

export function sortCalls(rows: readonly Detail[], sort: CallSort, whoName: (c: Detail) => string): Detail[] {
  const value = (c: Detail) => (sort.id === 'who' ? whoName(c) : c[sort.id])
  const by = (x: Detail, y: Detail) => {
    const [a, b] = [value(x), value(y)]
    return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
  }
  return [...rows].sort((x, y) => by(x, y) * (sort.isDesc ? -1 : 1))
}

const TICK_STEPS_MS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]
const MAX_TICKS = 5
// Round steps, so the axis never reads 0s 1s 3s 4s.
export function ticksOf(ms: number): { step: number; at: number[] } {
  const step = TICK_STEPS_MS.find(x => ms / x <= MAX_TICKS) ?? Math.ceil(ms / MAX_TICKS / 3_600_000) * 3_600_000
  return { step, at: Array.from({ length: Math.ceil(ms / step) }, (_, i) => i * step) }
}

export const xOf = (at: number, from: number, to: number) => Math.min(100, Math.max(0, ((at - from) / Math.max(1, to - from)) * 100))

// A turn's calls in the order they started, each subagent's nested under it, so a stall shows as a long bar or a gap.
// shortcut: the session keeps the last 500 calls, so a longer turn loses its start; raise KEEP_TRACE if people hit it.
export function rowsOf(d: WaterfallInput, span: { from: number; to: number }, now: number): Row[] {
  const { from, to } = span
  const running = new Map(d.active.map(a => [a.id, a]))
  const endOfCall = (c: TraceCall) => (c.ms !== undefined ? c.at + c.ms : running.has(c.id) ? now : c.at)
  const callRow = (c: TraceCall, depth: number): Row => {
    const live = running.get(c.id)
    const state: BarState = c.isFailed ? 'failed' : c.ms !== undefined ? 'ok' : !live ? 'unknown' : live.isAsking ? 'asking' : 'running'
    const end = endOfCall(c)
    return { key: c.id, name: c.tool, what: c.what, depth, from: c.at, to: end, ...(c.ms === undefined ? {} : { ms: c.ms }), state, isAgent: false, isSlowest: false, call: c }
  }
  const names = agentNames(d.agents)
  const agentTypes = new Set(d.agents.map(a => a.type))
  const agents = d.agents.filter(a => a.startedAt <= to && endOf(a, now) >= from)
  const nested = new Map<string, TraceCall[]>(agents.map(a => [a.id, []]))
  const blocks: { at: number; rows: Row[] }[] = []
  for (const c of d.trace ?? []) {
    // By overlap, as for agents: a long call that began before the window is still in it.
    if (endOfCall(c) < from || c.at > to) continue
    if (c.agentId === undefined && !agentTypes.has(c.who)) {
      if (!STARTS_AGENT.test(c.tool)) blocks.push({ at: c.at, rows: [callRow(c, 0)] })
      continue
    }
    // Parallel agents of one type all fit the type and time, so those only serve a session of an older version.
    const owner = c.agentId !== undefined ? agents.find(a => a.id === c.agentId) : agents.filter(a => a.type === c.who && a.startedAt <= c.at && endOf(a, now) >= c.at).at(-1)
    if (owner) nested.get(owner.id)?.push(c)
    else blocks.push({ at: c.at, rows: [callRow(c, 1)] })
  }
  for (const a of agents) {
    const end = endOf(a, now)
    const head: Row = { key: `agent:${a.id}`, name: names.get(a.id)?.short ?? a.type, full: names.get(a.id)?.full, what: a.type, depth: 0, from: a.startedAt, to: end, ms: end - a.startedAt, state: a.status === 'error' ? 'failed' : isRunning(a) ? 'running' : 'ok', isAgent: true, isSlowest: false }
    blocks.push({ at: a.startedAt, rows: [head, ...(nested.get(a.id) ?? []).map(c => callRow(c, 1))] })
  }
  const rows = blocks.sort((a, b) => a.at - b.at).flatMap(b => b.rows)
  const slowest = rows.filter(r => !r.isAgent && r.ms).sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))[0]
  return rows.map(r => (r === slowest ? { ...r, isSlowest: true } : r))
}
