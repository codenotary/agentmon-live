import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { LANGUAGES } from '../hooks/i18n'

// The kit declares the hook-adding `on` without exporting its type.
type On = Parameters<TestBody>[1]
// What the engine stamps on a command the person typed.
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

const PANE = {
  plugin: 'agentmon-live',
  component: 'Pane',
  requestId: 'agentmon-live',
  surface: 'terminal',
  props: { title: 'AgentMon Live', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

function engine(on: On) {
  on('command.register', () => ({ value: { command: 'agentmon' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000000, tokens: 290000, percent: 29 }, cost: { usd: 17.9 }, rateLimits: [{ kind: 'five_hour', percentUsed: 6 }, { kind: 'seven_day', percentUsed: 75 }] },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
}

test('hiddenSections drops those boxes', { options: { hiddenSections: ' usage, skills' } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /USAGE/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /FOCUS/ })).toBeTruthy()
  await ui.unmount()
})

test('the command reaches details without focusing the pane', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await $.command.run({ ...TYPED, command: 'agentmon', args: 'details' })).toEqual({ text: 'AgentMon Live: details on' })
  expect(await ui.find({ type: 'Button', text: /● details/ })).toBeTruthy()
  await ui.unmount()
})

test('the tools history shows calls in the last minute, and drops them when idle', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const command of ['ls', 'pwd', 'whoami']) await $.tool.call({ tool: 'Bash', command })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^shell\s+▕.*▏\s+3 3\/min$/ })).toBeTruthy()
  // An idle pane still drops the rate once the calls are a minute old.
  await clock.advance(61_000)
  expect(await ui.find({ type: 'Text', text: /^shell\s+▕.*▏\s+3$/ })).toBeTruthy()
  await ui.unmount()
})
