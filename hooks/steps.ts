import type { Active, Insights, Step, StepRow, TraceCall } from '../types'
import { callText, modelName } from './format'
import { actorOf } from './label'

// The turn the step list shows: the one under way, else the last one.
export function turnSpan(ins: Pick<Insights, 'turn' | 'last'>): { from: number; to?: number } | undefined {
  if (ins.turn) return { from: ins.turn.startedAt }
  return ins.last ? { from: ins.last.startedAt, to: ins.last.startedAt + ins.last.wallMs } : undefined
}

// The main loop's turn as rows, newest first: each model request and each call. A subagent is its `Agent` call; its own calls stay in the waterfall.
// A running row has `ms` 0 and is timed from `at` by whoever draws it, so the rows do not change with the clock.
// shortcut: rows are built here only, so a session read from Kiro, Codex or a snapshot folder has no step list; build on the page when those need one.
export function stepRows(d: { trace: readonly TraceCall[]; steps: readonly Step[]; active: readonly Active[] }, span: { from: number; to?: number }): StepRow[] {
  const live = new Map(d.active.map(a => [a.id, a]))
  const isIn = (at: number) => at >= span.from && (span.to === undefined || at <= span.to)
  const calls = d.trace.flatMap((c): StepRow[] => {
    const running = live.get(c.id)
    // A call that neither ended nor runs was cut off by a reload: nothing to say about it.
    if (c.agentId !== undefined || !(running || (isIn(c.at) && c.ms !== undefined))) return []
    const state = c.isDenied ? 'blocked' : c.isFailed ? 'failed' : c.ms !== undefined ? 'ok' : running?.isAsking ? 'asking' : 'running'
    return [{ id: c.id, kind: 'call', state, actor: c.isDenied ? 'hooks' : actorOf(c.tool), label: callText(c), ...(c.label === undefined ? {} : { what: c.what }), at: c.at, ms: c.ms ?? 0, count: 1 }]
  })
  const newest = d.steps.at(-1)
  const steps = d.steps.flatMap((s): StepRow[] =>
    isIn(s.at) && (s.ms !== undefined || s === newest) ? [{ id: s.id, kind: 'step', state: s.ms === undefined ? 'running' : 'ok', actor: 'model', label: modelName(s.model), at: s.at, ms: s.ms ?? 0, count: 1 }] : [],
  )
  const out: StepRow[] = []
  for (const row of [...calls, ...steps].sort((a, b) => b.at - a.at)) {
    const top = out.at(-1)
    // Quiet repeats fold into the newest of them; a failure always keeps its own row.
    if (top && top.state === 'ok' && row.state === 'ok' && top.kind === row.kind && top.actor === row.actor && top.label === row.label) out[out.length - 1] = { ...top, count: top.count + 1, ms: top.ms + row.ms }
    else out.push(row)
  }
  return out
}
