import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { tankRows, toolsBarWidth } from '../hooks/flow'
import { LANGUAGES } from '../hooks/i18n'
import { topology } from '../hooks/topology'

// The kit declares the hook-adding `on` without exporting its type.
type On = Parameters<TestBody>[1]

const PANE = {
  plugin: 'agent-radar',
  component: 'Pane',
  requestId: 'agent-radar',
  surface: 'terminal',
  props: { title: 'Agent Radar', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

function engine(on: On) {
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000000, tokens: 290000, percent: 29 }, cost: { usd: 17.9 }, rateLimits: [{ kind: 'five_hour', percentUsed: 6 }, { kind: 'seven_day', percentUsed: 75 }] },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
}

const ADVISOR = { isOn: true, calls: 0, notes: [], state: 'idle' as const }
const USAGE = { startedAt: 0, context: { percent: 29 }, rateLimits: [{ kind: 'five_hour', percentUsed: 6 }] }

test('topology counts the last minute as the rate and maps agents', () => {
  const topo = topology({
    main: { model: 'claude-opus-5-5', effort: 'medium' },
    counts: { shell: 3, git: 1 },
    errors: { shell: 1 },
    compactions: 0,
    agents: [{ id: 'a', type: 'Explore', model: 'claude-haiku-5-5', effort: '', task: 't', status: 'running', files: 0, tools: 0, input: 0, output: 0, startedAt: 90_000 }],
    usage: USAGE,
    advisor: ADVISOR,
    isListening: true,
    checks: [],
    flow: [{ cat: 'shell', at: 10_000 }, { cat: 'shell', at: 95_000 }, { cat: 'git', at: 99_000 }],
    now: 100_000,
  })
  expect(topo.callsPerMin).toBe(2)
  expect(topo.tools.map(x => [x.cat, x.total, x.perMin, x.errors])).toEqual([['git', 1, 1, 0], ['shell', 3, 1, 1]])
  expect(topo.agents).toEqual([{ type: 'Explore', model: 'claude-haiku-5-5', status: 'running', isFail: false }])
  expect(topo.context).toBe(29)
  expect(topo.session.uptimeMs).toBe(100_000)
})

test('tanks fill from the bottom', () => {
  expect(tankRows(0.5, 4)).toEqual([0, 0, 8, 8])
  expect(tankRows(0.1, 2)).toEqual([0, 2])
})

test('a flow tools row fits its box at every width', () => {
  // Name 12, count 5 and ' 999/min' beside the bar, inside the box's inner width.
  for (const inner of [30, 67, 107]) expect(12 + toolsBarWidth(inner) + 5 + ' 999/min'.length).toBeLessThanOrEqual(inner)
})

test('v switches between the dashboard and the flow view', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Text', text: /^● SESSION$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^● TOOLS$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /1\/min/ })).toBeTruthy()
  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Text', text: /CHANGES & VERIFICATION|USAGE/ })).toBeTruthy()
  await ui.unmount()
})

test('the desktop gets the same two views', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Text', text: /^● SESSION$/ })).toBeTruthy()
  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Text', text: /^● SESSION$/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /USAGE/ })).toBeTruthy()
  await ui.unmount()
})

test('needs attention stays on top in the flow view', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'boom', isError: true }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'view' })
  const titles = (await ui.findAll({ type: 'Text', text: /^● [A-Z& ·]+$/ })).map(x => x.text.trim())
  expect(titles[0]).toBe('● NEEDS ATTENTION')
  expect(titles[1]).toBe('● SESSION')
  await ui.unmount()
})
