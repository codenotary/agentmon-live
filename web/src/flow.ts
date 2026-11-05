import type { Card, Check, TraceCall, WebTurn } from '../../types/index'

import { endOf, GROUP_OVER, isRunning } from './agents.ts'
import { agentNames, prefixOf } from './format.ts'

export type FlowInput = { trace?: TraceCall[]; agents: Card[]; active: readonly { id: string; isAsking?: boolean }[]; turns: WebTurn[]; checks?: Check[] }
export type FlowOptions = { openGroups: ReadonlySet<string>; hideFinished: boolean }
export type Span = { from: number; to: number }
export type Lane = { id: string; name: string; full: string; dot: string; from: number; to: number; isMain: boolean; isGroup: boolean; isRunning: boolean; agentId?: string }
export type DotState = 'ok' | 'failed' | 'running' | 'asking'
export type Dot = { key: string; lane: string; at: number; state: DotState; isBig: boolean; call: TraceCall }
export type ArcKind = 'spawn' | 'handback' | 'ask'
export type Arc = { key: string; kind: ArcKind; fromLane: string; fromAt: number; toLane: string; toAt: number; agent: string }
export type Mark = { key: string; lane: string; at: number; to: number; state: DotState; count: number; dots: Dot[] }
// How wide the window is and where its right edge sits; a null edge follows the session.
export type FlowView = { ms: number; at: number | null }

export const MAIN_LANE = 'main'
export const DEFAULT_VIEW: FlowView = { ms: 120_000, at: null }
const MIN_WINDOW_MS = 5000
const MERGE_PX = 4
const IS_BIG = /^(Bash|Edit|Write|MultiEdit|NotebookEdit)$/
const STARTS_AGENT = /^(Agent|Task)$/

const dotOf = (a: Card) => (a.status === 'error' || a.tests === 'FAIL' ? 'error' : a.status)

export function flowOf(d: FlowInput, mainName: string, now: number, opts: FlowOptions): { lanes: Lane[]; dots: Dot[]; arcs: Arc[] } {
  const names = agentNames(d.agents)
  const shown = opts.hideFinished ? d.agents.filter(isRunning) : d.agents
  const groupSize = new Map<string, number>()
  for (const a of shown) {
    const prefix = prefixOf(a.task)
    if (prefix) groupSize.set(prefix, (groupSize.get(prefix) ?? 0) + 1)
  }
  const groupOf = (a: Card) => {
    const prefix = prefixOf(a.task)
    return prefix && (groupSize.get(prefix) ?? 0) > GROUP_OVER && !opts.openGroups.has(prefix) ? prefix : undefined
  }
  const trace = d.trace ?? []
  const firstAt = Math.min(now, ...trace.map(c => c.at), ...d.turns.map(t => t.startedAt), ...d.agents.map(a => a.startedAt))
  const lanes: Lane[] = [{ id: MAIN_LANE, name: mainName, full: mainName, dot: 'main', from: firstAt, to: now, isMain: true, isGroup: false, isRunning: true }]
  const laneOf = new Map<string, string>()
  for (const a of [...shown].sort((x, y) => x.startedAt - y.startedAt)) {
    const group = groupOf(a)
    const to = endOf(a, now)
    if (group === undefined) {
      lanes.push({ id: a.id, name: names.get(a.id)?.short ?? a.type, full: names.get(a.id)?.full ?? a.type, dot: dotOf(a), from: a.startedAt, to, isMain: false, isGroup: false, isRunning: isRunning(a), agentId: a.id })
      laneOf.set(a.id, a.id)
      continue
    }
    const id = `group:${group}`
    laneOf.set(a.id, id)
    const had = lanes.find(x => x.id === id)
    if (!had) lanes.push({ id, name: group.replace(/: $/, ''), full: group.replace(/: $/, ''), dot: dotOf(a), from: a.startedAt, to, isMain: false, isGroup: true, isRunning: isRunning(a) })
    else {
      had.to = Math.max(had.to, to)
      had.isRunning ||= isRunning(a)
      if (had.isRunning) had.dot = 'running'
      else if (dotOf(a) === 'error') had.dot = 'error'
    }
  }
  const live = new Map(d.active.map(a => [a.id, a]))
  const dots: Dot[] = []
  const lastAt = new Map<string, number>()
  const firstOf = new Map<string, number>()
  for (const c of trace) {
    const isMain = c.agentId === undefined
    if (isMain && c.who !== mainName) continue
    const lane = isMain ? MAIN_LANE : laneOf.get(c.agentId as string)
    if (lane === undefined) continue
    const running = live.get(c.id)
    const state: DotState = c.isFailed ? 'failed' : running?.isAsking ? 'asking' : c.ms === undefined && running ? 'running' : 'ok'
    dots.push({ key: c.id, lane, at: c.at, state, isBig: IS_BIG.test(c.tool), call: c })
    if (!isMain) {
      lastAt.set(c.agentId as string, c.at)
      if (!firstOf.has(c.agentId as string)) firstOf.set(c.agentId as string, c.at)
    }
  }
  const startCall = new Map(trace.filter(c => STARTS_AGENT.test(c.tool)).map(c => [c.id, c]))
  // A group lane gets one arc each way, or a fan-out would draw a sheaf.
  const seenSpawn = new Set<string>()
  const lastEnd = new Map<string, Card>()
  for (const a of shown) {
    const lane = laneOf.get(a.id) as string
    if (a.endedAt !== undefined && (lastEnd.get(lane)?.endedAt ?? 0) <= a.endedAt) lastEnd.set(lane, a)
  }
  const arcs: Arc[] = []
  for (const a of [...shown].sort((x, y) => x.startedAt - y.startedAt)) {
    const lane = laneOf.get(a.id) as string
    if (!seenSpawn.has(lane)) {
      seenSpawn.add(lane)
      const from = a.callId === undefined ? undefined : startCall.get(a.callId)?.at
      arcs.push({ key: `spawn:${a.id}`, kind: 'spawn', fromLane: MAIN_LANE, fromAt: from ?? a.startedAt, toLane: lane, toAt: firstOf.get(a.id) ?? a.startedAt, agent: a.id })
    }
    if (lastEnd.get(lane) === a && a.endedAt !== undefined) arcs.push({ key: `back:${a.id}`, kind: 'handback', fromLane: lane, fromAt: lastAt.get(a.id) ?? a.endedAt, toLane: MAIN_LANE, toAt: a.endedAt, agent: a.id })
  }
  for (const dot of dots) {
    if (dot.state === 'asking' && dot.lane !== MAIN_LANE) arcs.push({ key: `ask:${dot.key}`, kind: 'ask', fromLane: dot.lane, fromAt: dot.at, toLane: MAIN_LANE, toAt: dot.at, agent: dot.call.agentId ?? '' })
  }
  return { lanes, dots, arcs }
}

const RANK: Record<DotState, number> = { ok: 0, running: 1, failed: 2, asking: 3 }

// Dots closer than a few pixels become one mark with a count, so a 60-call agent stays legible.
export function mergeDots(dots: readonly Dot[], span: Span, widthPx: number): Mark[] {
  const pxPerMs = widthPx / Math.max(1, span.to - span.from)
  const byLane = new Map<string, Dot[]>()
  for (const d of dots) if (d.at >= span.from && d.at <= span.to) byLane.set(d.lane, [...(byLane.get(d.lane) ?? []), d])
  const marks: Mark[] = []
  for (const [lane, list] of byLane) {
    let run: Dot[] = []
    const flush = () => {
      const [first] = run
      const last = run.at(-1)
      if (!first || !last) return
      marks.push({ key: first.key, lane, at: first.at, to: last.at, state: run.reduce<DotState>((s, x) => (RANK[x.state] > RANK[s] ? x.state : s), 'ok'), count: run.length, dots: run })
    }
    for (const d of [...list].sort((x, y) => x.at - y.at)) {
      const prev = run.at(-1)
      if (prev && (d.at - prev.at) * pxPerMs >= MERGE_PX) {
        flush()
        run = []
      }
      run.push(d)
    }
    flush()
  }
  return marks
}

export function wholeOf(d: FlowInput, now: number): Span {
  const from = Math.min(now - MIN_WINDOW_MS, ...(d.trace ?? []).map(c => c.at), ...d.turns.map(t => t.startedAt), ...d.agents.map(a => a.startedAt))
  return { from, to: now }
}

// Live, the edge is now; at rest, the last thing that happened, so a fresh page opens on activity and not on an empty stretch.
export function edgeOf(d: FlowInput, now: number, isLive: boolean): number {
  if (isLive) return now
  const ends = [...(d.trace ?? []).map(c => c.at + (c.ms ?? 0)), ...d.agents.map(a => endOf(a, now)), ...d.turns.map(t => t.startedAt + t.wallMs)]
  return ends.length ? Math.min(now, Math.max(...ends)) : now
}

export function windowOf(view: FlowView, d: FlowInput, now: number, isLive: boolean): Span {
  const to = view.at ?? edgeOf(d, now, isLive)
  return { from: to - view.ms, to }
}

export function clampView(view: FlowView, whole: Span): FlowView {
  const ms = Math.round(Math.min(Math.max(MIN_WINDOW_MS, view.ms), Math.max(MIN_WINDOW_MS, whole.to - whole.from)))
  return { ms, at: view.at === null ? null : Math.min(whole.to, Math.max(whole.from + ms, view.at)) }
}
