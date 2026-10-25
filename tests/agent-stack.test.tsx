import { expect, test } from 'claude-code/testing'

import { brief, gitCommand, kilo, modelName, testsOf } from '../hooks/register'

const PANE = {
  plugin: 'agent-stack',
  component: 'Pane',
  requestId: 'agent-stack',
  surface: 'terminal',
  props: {
    title: 'Agent Stack',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

test('helpers format like the screenshot', async () => {
  expect(modelName('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelName('haiku')).toBe('Haiku')
  expect(kilo(35400)).toBe('35.4k')
  expect(testsOf('All 9 tests passed.')).toBe('PASS · 9 tests')
  expect(testsOf('nothing run')).toBe(undefined)
  expect(testsOf(' 5 pass\n 0 fail')).toBe(undefined)
  expect(testsOf('12 passed, 0 failed')).toBe(undefined)
  expect(testsOf('2 tests failed')).toBe('FAIL')
  expect(brief({ tool: 'Bash', command: 'npm  test' })).toBe('npm test')
  expect(gitCommand('cd /x && git  push origin main')).toBe('git push origin main')
  expect(gitCommand('git -C repo log --oneline | head')).toBe('git -C repo log --oneline')
  expect(gitCommand('echo legit')).toBe(undefined)
  expect(gitCommand('cd repo\ngit status')).toBe('git status')
})

test('pane counts tool calls and shows a spawned subagent', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-stack' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 330000, percent: 33 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'p',
    description: 'Mod lesen',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /total 2/ }))?.text).toBe('total 2')
  expect(await ui.find({ type: 'Text', text: /Haiku 5\.5/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Mod lesen/ })).toBeTruthy()
  await ui.unmount()
})

test('pane counts failed calls and compactions', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-stack' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('tool.call', () => ({ result: {}, text: 'boom', isError: true }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'Zusammenfassung', toolUses: [] }] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hallo', toolUses: [] }] })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^1 failed$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /1× compacted/ })).toBeTruthy()
  await ui.unmount()
})

test('german option localizes the pane', { options: { language: 'de' } }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-stack' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('tool.call', () => ({ result: {}, text: 'boom', isError: true }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'false' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /gesamt 1/ }))?.text).toBe('gesamt 1')
  expect(await ui.find({ type: 'Text', text: /^1 fehler$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Sitzungsprotokoll/ })).toBeTruthy()
  await ui.unmount()
})

test('git commands get their own row and log line', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-stack' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /total 2/ }))?.text).toBe('total 2')
  expect(await ui.find({ type: 'Text', text: /^last git/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /git \[1\]/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /EXECUTES/ })).toBe(undefined)
  await ui.unmount()
})
