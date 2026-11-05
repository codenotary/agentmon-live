import type { Card, Check, TraceCall, WebTurn } from '../../types/index'

import { dotOf, endOf, isRunning } from './agents.ts'
import { agentNames } from './format.ts'
import { STARTS_AGENT } from './waterfall.ts'

export type FlowInput = { trace?: TraceCall[]; agents: Card[]; active: readonly { id: string; isAsking?: boolean }[]; turns: WebTurn[]; checks?: Check[] }
export type FlowOptions = { hideFinished: boolean }
export type Span = { from: number; to: number }
export type Lane = { id: string; name: string; full: string; dot: string; from: number; to: number; isMain: boolean; isRunning: boolean; agentId?: string }
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

export function flowOf(d: FlowInput, mainName: string, now: number, opts: FlowOptions): { lanes: Lane[]; dots: Dot[]; arcs: Arc[] } {
  const names = agentNames(d.agents)
  const shown = opts.hideFinished ? d.agents.filter(isRunning) : d.agents
  const trace = d.trace ?? []
  const firstAt = Math.min(now, ...trace.map(c => c.at), ...d.turns.map(t => t.startedAt), ...d.agents.map(a => a.startedAt))
  const lanes: Lane[] = [{ id: MAIN_LANE, name: mainName, full: mainName, dot: 'main', from: firstAt, to: now, isMain: true, isRunning: true }]
  const inOrder = [...shown].sort((x, y) => x.startedAt - y.startedAt)
  for (const a of inOrder) lanes.push({ id: a.id, name: names.get(a.id)?.short ?? a.type, full: names.get(a.id)?.full ?? a.type, dot: dotOf(a), from: a.startedAt, to: endOf(a, now), isMain: false, isRunning: isRunning(a), agentId: a.id })
  const hasLane = new Set(lanes.map(l => l.id))
  const live = new Map(d.active.map(a => [a.id, a]))
  const dots: Dot[] = []
  const lastAt = new Map<string, number>()
  const firstOf = new Map<string, number>()
  for (const c of trace) {
    const isMain = c.agentId === undefined
    if (isMain && c.who !== mainName) continue
    const lane = isMain ? MAIN_LANE : (c.agentId as string)
    if (!hasLane.has(lane)) continue
    const running = live.get(c.id)
    const state: DotState = c.isFailed ? 'failed' : running?.isAsking ? 'asking' : c.ms === undefined && running ? 'running' : 'ok'
    dots.push({ key: c.id, lane, at: c.at, state, isBig: IS_BIG.test(c.tool), call: c })
    if (!isMain) {
      lastAt.set(c.agentId as string, c.at)
      if (!firstOf.has(c.agentId as string)) firstOf.set(c.agentId as string, c.at)
    }
  }
  const startCall = new Map(trace.filter(c => STARTS_AGENT.test(c.tool)).map(c => [c.id, c]))
  const arcs: Arc[] = []
  for (const a of inOrder) {
    const from = a.callId === undefined ? undefined : startCall.get(a.callId)?.at
    arcs.push({ key: `spawn:${a.id}`, kind: 'spawn', fromLane: MAIN_LANE, fromAt: from ?? a.startedAt, toLane: a.id, toAt: firstOf.get(a.id) ?? a.startedAt, agent: a.id })
    if (a.endedAt !== undefined) arcs.push({ key: `back:${a.id}`, kind: 'handback', fromLane: a.id, fromAt: lastAt.get(a.id) ?? a.endedAt, toLane: MAIN_LANE, toAt: a.endedAt, agent: a.id })
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

// Near an edge resizes, inside moves, elsewhere draws a new window. In a long session two minutes are a few pixels wide: all of that moves, or no drag could ever move it.
export function dragMode(x: number, left: number, right: number, edgePx: number): 'move' | 'left' | 'right' | 'new' {
  if (right - left < edgePx * 3) return x >= left - edgePx && x <= right + edgePx ? 'move' : 'new'
  if (Math.abs(x - left) <= edgePx) return 'left'
  if (Math.abs(x - right) <= edgePx) return 'right'
  return x > left && x < right ? 'move' : 'new'
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
  // Following, the session grows into a wider window; only a window held in place must fit what exists.
  const room = view.at === null ? Infinity : Math.max(MIN_WINDOW_MS, whole.to - whole.from)
  const ms = Math.round(Math.min(Math.max(MIN_WINDOW_MS, view.ms), room))
  return { ms, at: view.at === null ? null : Math.min(whole.to, Math.max(whole.from + ms, view.at)) }
}
