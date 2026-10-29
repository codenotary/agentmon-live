import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { areaOf, cells, dur, focusList, isCorrection, isNewTask, liveBuckets, peakEnd, sparkline } from '../hooks/insights'
import { EMPTY_INSIGHTS, shapeInsights } from '../hooks/state'

type On = Parameters<TestBody>[1]

const PANE = {
  plugin: 'agentmon-live',
  component: 'Pane',
  requestId: 'agentmon-live',
  surface: 'terminal',
  props: {
    title: 'AgentMon Live',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

function engine(on: On, percent = 1) {
  on('command.register', () => ({ value: { command: 'agentmon' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: percent * 10000, percent }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}

const USAGE = (input: number, cached: number) => ({ input_tokens: input, output_tokens: 200, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' })

// Drains a step's stream, as the engine does while the response arrives.
async function drain(stream: AsyncGenerator<unknown, unknown>) {
  for await (const _ of stream) void _
}

test('helpers: durations, areas, sparkline, cells', async () => {
  expect(dur(850)).toBe('0.8s')
  expect(dur(12_400)).toBe('12s')
  expect(dur(252_000)).toBe('4m12s')
  expect(dur(3_840_000)).toBe('1h04m')
  expect(areaOf('/repo/hooks/state.ts', '/repo')).toBe('hooks')
  expect(areaOf('/repo/src/api/x/y.ts', '/repo')).toBe('src/api')
  expect(areaOf('/repo/README.md', '/repo')).toBe('.')
  expect(areaOf('D:\\dev\\repo\\tests\\a.ts', 'D:\\dev\\repo')).toBe('tests')
  expect(areaOf('/etc/nginx/nginx.conf', '/repo')).toBe('etc/nginx')
  expect(sparkline([0, 50, 100], 10)).toBe('▁▄█')
  expect(cells([0.5, 0.3, 0.2], 7).reduce((a, b) => a + b, 0)).toBe(7)
  expect(liveBuckets({ startedAt: 0, wallMs: 0, buckets: { model: 100 }, steps: 1, mode: 'model', since: 100 }, 400)).toEqual({ model: 400 })
  expect(shapeInsights({ turns: 2 } as never).tokens.mainIn).toBe(0)
})

test('focus ranks a hanging call over a re-read file', async () => {
  const list = focusList({
    ins: { ...EMPTY_INSIGHTS, durations: { Bash: [2000, 3000, 2500] }, reads: { '/r/a.ts': 4 } },
    doing: [{ id: 'c1', who: 'main session', tool: 'Bash', what: 'npm run build', startedAt: 0 }],
    agents: [],
    window: 1000000,
    now: 120_000,
  })
  expect(list.map(x => x.tag)).toEqual(['slow', 're-read'])
  expect(list[0]?.text).toBe('Bash npm run build running 2m00s · usually 2.5s')
  expect(list[0]?.prompt).toMatch(/stuck/)
})

test('focus stays quiet for a call within its usual time', async () => {
  const list = focusList({
    ins: { ...EMPTY_INSIGHTS, durations: { Bash: [100_000] } },
    doing: [{ id: 'c1', who: 'main session', tool: 'Bash', what: 'make', startedAt: 0 }],
    agents: [],
    window: 1000000,
    now: 120_000,
  })
  expect(list).toEqual([])
})

test('a turn is split into model, tool and approval time', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  let asking = false
  let drafted = ''
  on('prompt.fill', (_, e) => {
    drafted = e.text
    return { isFilled: true }
  })
  on('tool.check', () => ({ decision: asking ? 'ask' : 'allow' }))
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 40_000 : 6000)
    return { result: {}, text: 'x'.repeat(e.tool === 'Read' ? 60_000 : 10) }
  })
  on('turn.step', async function* () {
    await clock.sleep(10_000)
    return { turnId: 'm1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: USAGE(1000, 39_000) }
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'build it', turnId: 'm1' })
  const step = drain($.turn.step({ turnId: 'm1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }))
  await clock.advance(10_000)
  await step
  const read = $.tool.call({ tool: 'Read', file_path: '/repo/hooks/big.json', tool_use_id: 'r1' })
  await clock.advance(6000)
  await read
  const bash = $.tool.call({ tool: 'Bash', command: 'npm run build', tool_use_id: 'b1' })
  await clock.settle()
  asking = true
  await $.tool.check({ tool: 'Bash', input: { command: 'npm run build' }, tool_use_id: 'b1' })
  asking = false
  await clock.advance(40_000)
  await bash
  await $.turn.complete({ answer: 'Built.', durationMs: 56_000, isAborted: false, turnId: 'm1', reason: 'answer' })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  // Always on top: the approvals ate most of the turn, and the big read is called out.
  expect(await ui.find({ type: 'Text', text: /^ WAITING  approvals held up 40s of the last 56s turn · most asked: Bash npm run build/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^ BIG  Read .*big\.json put ≈15\.0k tokens into context/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^last turn 56s/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /you 71%/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /model 18%/ })).toBeTruthy()
  // The approval wait does not count as Bash being slow; the read does make the slowest list.
  expect(await ui.find({ type: 'Text', text: /^\s+6\.0s Read/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^\s+40s Bash/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /now 40\.0k · cache 98% last request/ })).toBeTruthy()

  // Investigate drafts a question about allow rules.
  await ui.press({ key: 'investigate:0' })
  expect(drafted).toMatch(/allow rules/)
  await ui.unmount()
})

test('the same failing call three times is a loop; a long call in flight is slow', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', async (_, e) => {
    if (e.tool === 'Bash' && (e as { command?: string }).command === 'npm test') return { result: {}, text: 'FAIL', isError: true }
    await clock.sleep(200_000)
    return { result: {} }
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'fix', turnId: 'm1' })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const hang = $.tool.call({ tool: 'Bash', command: 'npm run dev', tool_use_id: 'h1' })
  await clock.advance(90_000)

  const ui = await $.ui.mount(PANE)
  const tags = (await ui.findAll({ type: 'Text', text: /^ [A-Z]+  / })).map(x => x.text.trim().split(/\s{2,}/)[0])
  expect(tags).toEqual(['ERROR', 'FAILED', 'SLOW', 'LOOP'])
  expect(await ui.find({ type: 'Text', text: /failed 3× in a row: Bash npm test/ })).toBeTruthy()
  // x puts the notes away first; what needs the person stays until a second x.
  await ui.press({ key: 'attention:dismiss' })
  const left = (await ui.findAll({ type: 'Text', text: /^ [A-Z]+  / })).map(x => x.text.trim().split(/\s{2,}/)[0])
  expect(left).toEqual(['ERROR', 'FAILED'])
  await ui.press({ key: 'attention:dismiss' })
  expect(await ui.find({ type: 'Text', text: /nothing needs you/ })).toBeTruthy()
  await clock.advance(200_000)
  await hang
  await ui.unmount()
})

test('focus moves between project areas are counted per turn', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'refactor', turnId: 'm1' })
  for (const p of ['hooks/a.ts', 'tests/a.ts', 'hooks/b.ts', 'types/x.d.ts', 'hooks/a.ts']) await $.tool.call({ tool: 'Read', file_path: `/repo/${p}` })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^4 switches this turn · hooks 3 · (tests|types) 1/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /re-read hooks\/a\.ts 2×/ })).toBeTruthy()
  await ui.unmount()
})

test('docs read and code changed in one turn bring the docs hint; a refactor or a docs-only turn does not', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const docsHint = async (prompt: string, edit?: string, doc = '/repo/README.md') => {
    await $.turn.start({ text: prompt, turnId: prompt })
    await $.tool.call({ tool: 'Read', file_path: doc })
    if (edit) await $.tool.call({ tool: 'Edit', file_path: edit, old_string: 'a', new_string: 'b' } as never)
    await clock.settle()
    await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: prompt, reason: 'answer' })
    await clock.settle()
    const ui = await $.ui.mount(PANE)
    const found = await ui.find({ type: 'Text', text: /read docs \(.*\) and changed code/ })
    await ui.unmount()
    return Boolean(found)
  }
  expect(await docsHint('add a flag', '/repo/src/x.ts')).toBe(true)
  expect(await docsHint('refactor the parser', '/repo/src/x.ts')).toBe(false)
  expect(await docsHint('explain it')).toBe(false)
  for (const doc of ['/repo/requirements.txt', '/repo/CLAUDE.md', '/home/me/.claude/projects/x/memory/MEMORY.md', '/elsewhere/README.md']) {
    expect(await docsHint(`edit after ${doc}`, '/repo/src/x.ts', doc)).toBe(false)
  }
})

test('the docs hint drafts the docs-vs-code rule', async () => {
  const last = { startedAt: 1, wallMs: 1000, buckets: {}, steps: 1, docs: ['/r/README.md'] }
  const [hint] = focusList({ ins: { ...EMPTY_INSIGHTS, last }, doing: [], agents: [], window: 1000000, now: 2000 }).filter(x => x.tag === 'docs')
  expect(hint?.prompt).toBe('Where the documentation (/r/README.md) and the existing code disagree, follow the conventions in the existing code. In your reply, list each inconsistency you found between the documentation and the code.')
  expect(focusList({ ins: EMPTY_INSIGHTS, doing: [], agents: [], window: 1000000, now: 2000 }).some(x => x.tag === 'docs')).toBe(false)
})

test('a plan window filling faster than it resets is worth a look', async () => {
  const at = 3 * 3_600_000
  const reading = (min: number, pct: number) => ({ at: at - min * 60_000, pct, resetsAt: at + 2 * 3_600_000 })
  const pace = (limits: typeof EMPTY_INSIGHTS.limits) => focusList({ ins: { ...EMPTY_INSIGHTS, limits }, doing: [], agents: [], window: 1000000, now: at }).filter(x => x.tag === 'pace')
  const fast = pace({ five_hour: [reading(10, 44), reading(0, 62)] })
  expect(fast.map(x => x.text)).toEqual(['5h window 62% · +18 in 10 min · full in ~21m06s, resets in 2h00m'])
  expect(fast[0]?.prompt).toMatch(/no new subagents/)
  expect(pace({ five_hour: [reading(10, 44), reading(0, 46)] })).toEqual([])
  // Readings closer than five minutes say nothing yet.
  expect(pace({ five_hour: [reading(2, 44), reading(0, 62)] })).toEqual([])
})

test('plan readings build the pace; a new window starts a fresh list', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const measure = async (pct: number, resetsAt: string) => {
    await $.session.measure({ context: { window: 1000000 }, rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt }], changed: ['rateLimits'] })
    await clock.settle()
  }
  const paced = async () => {
    const ui = await $.ui.mount(PANE)
    const found = await ui.find({ type: 'Text', text: /5h window/ })
    await ui.unmount()
    return Boolean(found)
  }
  await measure(10, '2099-01-01T00:00:00Z')
  await clock.advance(10 * 60_000)
  // 10% to 62% in ten minutes would be a pace, but the reset moved: a new window, nothing to compare.
  await measure(62, '2099-01-02T00:00:00Z')
  expect(await paced()).toBe(false)
  await clock.advance(10 * 60_000)
  await measure(80, '2099-01-02T00:00:00Z')
  expect(await paced()).toBe(true)
})

test('a large session idle past the cache life warns before the next prompt', async () => {
  const now = 10 * 3_600_000
  const cold = (idleMin: number, tokens: number) =>
    focusList({ ins: { ...EMPTY_INSIGHTS, lastActive: now - idleMin * 60_000 }, doing: [], agents: [], window: 1000000, tokens, now }).filter(x => x.tag === 'cold')
  expect(cold(70, 180_000).map(x => x.text)).toEqual(['prompt cache expired · idle 1h10m · the next prompt re-writes ≈180.0k tokens · /compact first'])
  expect(cold(40, 180_000)).toEqual([])
  expect(cold(70, 120_000)).toEqual([])
})

test('peak hours are weekdays 05:00 to 11:00 Pacific, and show only with plan windows', async () => {
  expect(peakEnd(Date.parse('2026-10-27T15:00:00Z'))).toBe(Date.parse('2026-10-27T18:00:00Z'))
  expect(peakEnd(Date.parse('2026-11-03T13:30:00Z'))).toBe(Date.parse('2026-11-03T19:00:00Z'))
  expect(peakEnd(Date.parse('2026-10-27T19:00:00Z'))).toBeUndefined()
  expect(peakEnd(Date.parse('2026-10-31T15:00:00Z'))).toBeUndefined()
  const now = Date.parse('2026-10-27T15:00:00Z')
  const peak = (limits: typeof EMPTY_INSIGHTS.limits) => focusList({ ins: { ...EMPTY_INSIGHTS, limits }, doing: [], agents: [], window: 1000000, now }).filter(x => x.tag === 'peak')
  expect(peak({})).toEqual([])
  expect(peak({ seven_day: [{ at: now, pct: 30 }] }).map(x => x.text)).toEqual([expect.stringMatching(/^peak hours until .+ · limits may be used up faster during this time$/)])
})

test('the german pane names the insights', { options: { language: 'de' } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on, 85)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^ KONTEXT  Kontext 85% · Verdichtung steht bevor/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /FOKUS/ })).toBeTruthy()
  await ui.unmount()
})

test('focus and insights draw on desktop too', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, 90)
  on('tool.call', async () => {
    await clock.sleep(7000)
    return { result: {}, text: 'ok' }
  })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 'm1' })
  // Grep is not in this build's typed tool list; the engine still raises it.
  const call = $.tool.call({ tool: 'Grep', pattern: 'x', path: '/repo/src/api' } as never)
  await clock.advance(7000)
  await call
  await $.turn.complete({ answer: 'ok', durationMs: 7000, isAborted: false, turnId: 'm1', reason: 'answer' })
  await clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /context 90% · compaction is near/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^\s+7\.0s Grep/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('an unrelated task in a large session, corrections in a row and a read-only subagent on a large model each bring a hint', async () => {
  expect(isNewTask(['web'], ['hooks', 'tests'], 200_000)).toBe(true)
  expect(isNewTask(['web', 'hooks'], ['hooks'], 200_000)).toBe(false)
  expect(isNewTask(['web'], ['hooks'], 50_000)).toBe(false)
  expect(isNewTask(['web'], [], 200_000)).toBe(false)

  expect(isCorrection('still failing with the same error')).toBe(true)
  expect(isCorrection("that didn't work")).toBe(true)
  expect(isCorrection('funktioniert immer noch nicht')).toBe(true)
  expect(isCorrection('add a calendar widget')).toBe(false)

  const card = { id: 'a1', type: 'scanner', model: 'claude-opus-5-5', effort: 'medium', task: 'find imports', status: 'done' as const, files: 4, tools: 5, others: 0, input: 0, output: 0, startedAt: 0 }
  const list = focusList({
    ins: { ...EMPTY_INSIGHTS, turns: 4, corrections: 2, last: { startedAt: 1, wallMs: 1000, buckets: {}, steps: 1, ctxStart: 210_000, isNewTask: true } },
    doing: [],
    agents: [card, { ...card, id: 'a2' }, { ...card, id: 'a3', type: 'Explore' }, { ...card, id: 'a4', type: 'editor', others: 2 }, { ...card, id: 'a5', type: 'cheap', model: 'claude-haiku-5-5' }],
    window: 1000000,
    now: 2000,
  })
  const tags = (tag: string) => list.filter(x => x.tag === tag)
  expect(tags('new task').map(x => x.text)).toEqual(['the last turn worked where this 210.0k session had not been · /clear before the next unrelated task (/clear <name> to come back)'])
  expect(tags('redo')[0]?.text).toBe('2 corrections in a row · a third rarely lands: /clear and one new prompt with what you learned')
  expect(tags('redo')[0]?.prompt).toContain('start fresh with /clear')
  expect(tags('model').map(x => x.text)).toEqual(['scanner ran on Opus 5.5 and only read or searched · model: haiku in its definition costs less'])
})

test('a prompt that corrects an edit turn counts; two in a row bring the redo hint, a new request resets it', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const turn = async (text: string, id: string) => {
    await $.turn.start({ text, turnId: id })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
    await clock.settle()
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: id, reason: 'answer' })
    await clock.settle()
  }
  await turn('fix the parser', 'm1')
  await turn('still failing', 'm2')
  await turn("that didn't work either", 'm3')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /2 corrections in a row/ })).toBeTruthy()
  await ui.unmount()
  await turn('now add a calendar widget', 'm4')
  const again = await $.ui.mount(PANE)
  expect(await again.find({ type: 'Text', text: /corrections in a row/ })).toBeFalsy()
  await again.unmount()
})
