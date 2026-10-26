import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { areaOf, cells, dur, focusList, liveBuckets, sparkline } from '../hooks/insights'
import { EMPTY_INSIGHTS, shapeInsights } from '../hooks/state'

type On = Parameters<TestBody>[1]

const PANE = {
  plugin: 'agent-radar',
  component: 'Pane',
  requestId: 'agent-radar',
  surface: 'terminal',
  props: {
    title: 'Agent Radar',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

function engine(on: On, percent = 1) {
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
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
  expect(await ui.find({ type: 'Text', text: /now 40\.0k · cache 98%/ })).toBeTruthy()

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
  // x puts them away.
  await ui.press({ key: 'attention:dismiss' })
  expect(await ui.find({ type: 'Text', text: /LOOP/ })).toBe(undefined)
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
  const call = $.tool.call({ tool: 'Grep', pattern: 'x', path: '/repo/src/api' })
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
