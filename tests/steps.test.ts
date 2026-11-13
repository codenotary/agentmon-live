import { expect, test } from 'claude-code/testing'

import type { Active, Step, TraceCall } from '../types'
import { isCut, KEEP_STEPS, KEEP_TRACE, stepRows, turnSpan } from '../hooks/steps'

const MODEL = 'claude-opus-5-5'
const call = (id: string, at: number, extra: Partial<TraceCall> = {}): TraceCall => ({ id, at, who: 'main', tool: 'Bash', what: `run ${id}`, ms: 10, ...extra })
const keys = (trace: TraceCall[], steps: Step[], active: Active[] = [], span: { from: number; to?: number } = { from: 100 }) => stepRows({ trace, steps, active }, span).map(r => r.id)

test('the turn runs newest first, model steps between the calls, nothing from before it or from a subagent', async () => {
  const trace = [call('old', 50), call('a', 110), call('b', 130, { tool: 'Read', what: '/r/hooks/x.ts', label: 'hooks/x.ts' }), call('sub', 140, { agentId: 's1' })]
  const steps = [{ id: 't:0', at: 100, ms: 5, model: MODEL }, { id: 't:1', at: 120, ms: 7, model: MODEL }]
  const rows = stepRows({ trace, steps, active: [] }, { from: 100 })
  expect(rows.map(r => r.id)).toEqual(['b', 't:1', 'a', 't:0'])
  expect(rows[0]).toEqual({ id: 'b', kind: 'call', state: 'ok', actor: 'files', label: 'hooks/x.ts', what: '/r/hooks/x.ts', at: 130, ms: 10, count: 1 })
  expect(rows[1]).toEqual({ id: 't:1', kind: 'step', state: 'ok', actor: 'model', label: 'Opus 5.5', at: 120, ms: 7, count: 1 })
  // A call with no label of its own shows its raw text and repeats it nowhere.
  expect(rows[2]).toMatchObject({ actor: 'shell', label: 'run a' })
  expect('what' in rows[2]!).toBe(false)
  // The last turn ends where it ended.
  expect(keys(trace, steps, [], { from: 100, to: 125 })).toEqual(['t:1', 'a', 't:0'])
})

test('a row says whether it runs, waits for the person, failed or was refused', async () => {
  const trace = [
    call('run', 110, { ms: undefined }),
    call('ask', 120, { ms: undefined }),
    call('bad', 130, { isFailed: true }),
    call('no', 140, { isFailed: true, isDenied: true }),
    // Cut off by a reload: it neither ended nor runs.
    call('cut', 150, { ms: undefined }),
  ]
  const active: Active[] = [{ id: 'run', who: 'main', tool: 'Bash', what: 'x', startedAt: 110 }, { id: 'ask', who: 'main', tool: 'Bash', what: 'x', startedAt: 120, isAsking: true }]
  // Only the newest step can still be under way.
  const steps = [{ id: 't:0', at: 105, model: MODEL }, { id: 't:1', at: 160, model: MODEL }]
  const rows = stepRows({ trace, steps, active }, { from: 100 })
  expect(rows.map(r => [r.id, r.state, r.actor, r.ms])).toEqual([
    ['t:1', 'running', 'model', 0],
    ['no', 'blocked', 'hooks', 10],
    ['bad', 'failed', 'shell', 10],
    ['ask', 'asking', 'shell', 0],
    ['run', 'running', 'shell', 0],
  ])
  // Once the turn is over nothing runs: a step a reload left without an end is gone, like such a call.
  expect(stepRows({ trace: [], steps, active: [] }, { from: 100, to: 200 })).toEqual([])
  // A call still running from before the turn began stays listed.
  expect(keys([call('long', 20, { ms: undefined })], [], [{ id: 'long', who: 'main', tool: 'Bash', what: 'x', startedAt: 20 }])).toEqual(['long'])
})

test('quiet repeats fold into the newest of them; a failure keeps its own row', async () => {
  const read = (id: string, at: number, extra: Partial<TraceCall> = {}) => call(id, at, { tool: 'Read', what: '/r/a.ts', label: 'r/a.ts', ...extra })
  const rows = stepRows({ trace: [read('1', 110), read('2', 120), read('3', 130), read('4', 140, { isFailed: true }), read('5', 150), call('6', 160)], steps: [], active: [] }, { from: 100 })
  expect(rows.map(r => [r.id, r.count, r.ms, r.state])).toEqual([
    ['6', 1, 10, 'ok'],
    ['5', 1, 10, 'ok'],
    ['4', 1, 10, 'failed'],
    ['3', 3, 30, 'ok'],
  ])
  // Three calls that ran side by side took as long as the longest of them, not three times that.
  const side = stepRows({ trace: [read('a', 110, { ms: 40 }), read('b', 111, { ms: 20 }), read('c', 112, { ms: 30 })], steps: [], active: [] }, { from: 100 })
  expect(side.map(r => [r.id, r.count, r.at, r.ms])).toEqual([['c', 3, 110, 40]])
})

test('the list covers the turn under way, else the last one', async () => {
  expect(turnSpan({ turn: { startedAt: 5 }, last: { startedAt: 1, wallMs: 2 } } as never)).toEqual({ from: 5 })
  expect(turnSpan({ last: { startedAt: 1, wallMs: 2 } } as never)).toEqual({ from: 1, to: 3 })
  expect(turnSpan({})).toBe(undefined)
})

test('a full history that starts inside the turn says the list is cut', async () => {
  const full = Array.from({ length: KEEP_TRACE }, (_, i) => call(`c${i}`, 200 + i))
  const steps = Array.from({ length: KEEP_STEPS }, (_, i) => ({ id: `t:${i}`, at: 200 + i, ms: 1, model: MODEL }))
  expect(isCut({ trace: full, steps: [] }, { from: 100 })).toBe(true)
  expect(isCut({ trace: [], steps }, { from: 100 })).toBe(true)
  // The oldest kept entry is from before the turn: the turn is whole.
  expect(isCut({ trace: full, steps }, { from: 201 })).toBe(false)
  // Not full: nothing fell out.
  expect(isCut({ trace: full.slice(1), steps: steps.slice(1) }, { from: 100 })).toBe(false)
})
