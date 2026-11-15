import type { Active, Insights, Step, StepRow, TraceCall } from '../types'
import { callText, modelName } from './format'
import { actorOf } from './label'

export const KEEP_TRACE = 500
export const KEEP_STEPS = 200

// A full history that starts inside the turn has dropped the turn's first calls or model requests.
export function isCut(d: { trace: readonly TraceCall[]; steps: readonly Step[] }, span: { from: number }): boolean {
  const isFull = (list: readonly { at: number }[], keep: number) => list.length >= keep && list[0]!.at >= span.from
  return isFull(d.trace, KEEP_TRACE) || isFull(d.steps.filter(s => !s.note), KEEP_STEPS) || isFull(d.steps.filter(s => s.note), KEEP_STEPS)
}

// A new step joins the list. Requests and moments each keep their newest KEEP_STEPS, so a hook that speaks at every call pushes no request out.
export function keepSteps(all: readonly Step[], s: Step): Step[] {
  const same = all.filter(x => !x.note === !s.note)
  const drop = same.length >= KEEP_STEPS ? same[0] : undefined
  return [...all.filter(x => x !== drop), s]
}

// The turn the step list shows: the one under way, else the last one.
export function turnSpan(ins: Pick<Insights, 'turn' | 'last'>): { from: number; to?: number } | undefined {
  if (ins.turn) return { from: ins.turn.startedAt }
  return ins.last ? { from: ins.last.startedAt, to: ins.last.startedAt + ins.last.wallMs } : undefined
}

// The main loop's turn as rows, newest first: each model request and each call. A subagent is its `Agent` call; its own calls stay in the waterfall.
// A running row has `ms` 0 and is timed from `at` by whoever draws it, so the rows do not change with the clock.
// A step with no end counts as running only in the turn under way: after a reload a finished turn has no such step.
// shortcut: rows are built here only, so a session read from Kiro, Codex or a snapshot folder has no step list; build on the page when those need one.
export function stepRows(d: { trace: readonly TraceCall[]; steps: readonly Step[]; active: readonly Active[] }, span: { from: number; to?: number }): StepRow[] {
  const live = new Map(d.active.map(a => [a.id, a]))
  const isIn = (at: number) => at >= span.from && (span.to === undefined || at <= span.to)
  const calls = d.trace.flatMap((c): StepRow[] => {
    const running = live.get(c.id)
    // A call that neither ended nor runs was cut off by a reload: nothing to say about it.
    if (c.agentId !== undefined || !(running || (isIn(c.at) && c.ms !== undefined))) return []
    const state = c.isDenied ? 'blocked' : c.isFailed ? 'failed' : c.ms !== undefined ? 'ok' : running?.isAsking ? 'asking' : 'running'
    return [{ id: c.id, kind: 'call', state, actor: c.isDenied ? 'hooks' : c.isMemory ? 'memory' : actorOf(c.tool), label: callText(c), ...(c.label === undefined ? {} : { what: c.what }), at: c.at, ms: c.ms ?? 0, count: 1 }]
  })
  const newest = d.steps.findLast(s => !s.note)
  const steps = d.steps.flatMap((s): StepRow[] =>
    isIn(s.at) && (s.ms !== undefined || (s === newest && span.to === undefined)) ? [{ id: s.id, kind: 'step', state: s.ms === undefined ? 'running' : 'ok', actor: s.note?.actor ?? 'model', label: s.note?.label ?? modelName(s.model), at: s.at, ms: s.ms ?? 0, count: 1 }] : [],
  )
  const out: StepRow[] = []
  for (const row of [...calls, ...steps].sort((a, b) => b.at - a.at)) {
    const top = out.at(-1)
    // Quiet repeats fold into the newest of them, timed from the first start to the last end: calls that ran side by side do not add up. A failure always keeps its own row.
    if (top && top.state === 'ok' && row.state === 'ok' && top.kind === row.kind && top.actor === row.actor && top.label === row.label) out[out.length - 1] = { ...top, count: top.count + 1, at: row.at, ms: Math.max(top.at + top.ms, row.at + row.ms) - row.at }
    else out.push(row)
  }
  return out
}
