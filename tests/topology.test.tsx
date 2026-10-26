import type { On } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { CANVAS_ROWS, Cells, paintTopology } from '../hooks/canvas'
import { tankRows } from '../hooks/flow'
import { topology } from '../hooks/topology'

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

test('cells encode one triplet per cell and tanks fill from the bottom', () => {
  const c = new Cells(4, 3)
  c.text(1, 1, 'AB')
  const words = new Uint32Array(Uint8Array.from(atob(c.encode()), ch => ch.charCodeAt(0)).buffer)
  expect(words.length).toBe(4 * 3 * 3)
  expect(words[(1 * 4 + 1) * 3]).toBe(0x41)
  expect(words[(1 * 4 + 2) * 3]).toBe(0x42)
  expect(tankRows(0.5, 4, 1)).toEqual(['·', '·', '█', '█'])
  const t = new Cells(1, 6)
  t.tank(0, 0, 1, 6, 0.5, 0xffffff)
  // Inside rows 1..4: the bottom two full, the top two empty.
  expect([1, 2, 3, 4].map(y => String.fromCodePoint(t.words[y * 3]!))).toEqual([' ', ' ', '█', '█'])
})

test('the canvas paints within its size', () => {
  const topo = topology({ main: { model: 'claude-opus-5-5', effort: 'medium' }, counts: { shell: 2 }, errors: {}, compactions: 0, agents: [], usage: USAGE, advisor: ADVISOR, isListening: true, checks: [], flow: [], now: 1000 })
  const c = paintTopology(topo, 100, 0, { session: 'session', tools: 'tools', agents: 'agents', context: 'context', limits: 'limits', fable: 'fable' })
  expect(c.words.length).toBe(100 * CANVAS_ROWS * 3)
  const row = (y: number) => Array.from({ length: 100 }, (_, x) => String.fromCodePoint(c.words[(y * 100 + x) * 3]!)).join('')
  expect(row(0)).toContain('SESSION')
  expect(row(0)).toContain('TOOLS')
})

test('v cycles radar, flow and canvas on the terminal', async ($, on) => {
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
  expect(await ui.find({ type: 'Raster' })).toBeTruthy()
  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Raster' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /CHANGES & VERIFICATION|USAGE/ })).toBeTruthy()
  await ui.unmount()
})

test('desktop skips the canvas', async ($, on) => {
  mock.clock(on)
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Text', text: /^● SESSION$/ })).toBeTruthy()
  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Text', text: /^● SESSION$/ })).toBe(undefined)
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
