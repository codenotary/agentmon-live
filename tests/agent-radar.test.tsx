import type { On } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { brief, fit, gitCommand, kilo, modelName, testsOf } from '../hooks/register'

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
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

// The engine answers every test needs; a test adds its own hooks after.
function engine(on: On) {
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
}

const SPAWN = {
  prompt: 'p',
  description: 'Mod lesen',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
} as const

const DONE = { answer: 'done', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' } as const

test('helpers format like the screenshot', async () => {
  expect(modelName('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelName('haiku')).toBe('Haiku')
  expect(kilo(35400)).toBe('35.4k')
  expect(testsOf('All 9 tests passed.')).toBe('PASS · 9 tests')
  expect(testsOf('nothing run')).toBe(undefined)
  expect(testsOf(' 5 pass\n 0 fail')).toBe(undefined)
  expect(testsOf('12 passed, 0 failed')).toBe(undefined)
  expect(testsOf('2 tests failed')).toBe('FAIL')
  expect(testsOf('3 tests passed, 2 failed')).toBe('FAIL')
  expect(brief({ tool: 'Bash', command: 'npm  test' })).toBe('npm test')
  expect(gitCommand('cd /x && git  push origin main')).toBe('git push origin main')
  expect(gitCommand('git -C repo log --oneline | head')).toBe('git -C repo log --oneline')
  expect(gitCommand('echo legit')).toBe(undefined)
  expect(fit('skills & commands', 17)).toBe('skills & command ')
  expect(fit('读取文件', 10)).toBe('读取文件  ')
  expect(fit('コンピュータ操作', 10)).toBe('コンピュ  ')
  expect(gitCommand('cd repo\ngit status')).toBe('git status')
})

test('pane counts tool calls and shows a spawned subagent', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
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
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
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
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
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
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
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
  expect(await ui.find({ type: 'Text', text: /^git status$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /git \[1\]/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /EXECUTES/ })).toBe(undefined)
  await ui.unmount()
})

test('fable box stays one line until fable is asked', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^calls/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /speaks up only when needed/ })).toBeTruthy()
  expect(await ui.find({ key: 'view:git' })).toBe(undefined)
  await ui.unmount()
})

test('mcp calls get a row and their own detail tab', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__sentry__search_issues', query: 'crash' })
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^MCP/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /sentry search_issues/ })).toBe(undefined)
  await ui.press({ key: 'view:mcp' })
  expect(await ui.find({ type: 'Text', text: /^sentry search_issues crash$/ })).toBeTruthy()
  await ui.press({ key: 'view:shell' })
  expect(await ui.find({ type: 'Text', text: /^ls -la$/ })).toBeTruthy()
  await ui.unmount()
})

test('fable verdicts show as ok and nok', async ($, on) => {
  const clock = mock.clock(on)
  const answers = ['OK', 'The tests were never run.']
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'the plan', toolUses: [] }] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('model.complete', () => ({
    value: { isAnswered: true, text: answers.shift() ?? 'OK', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'ExitPlanMode' })
  await clock.settle()
  await $.tool.call({ tool: 'ExitPlanMode' })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^✓ plan ok$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^✗ plan nok/ })).toBeTruthy()
  expect(toasts).toEqual(['Fable: The tests were never run.'])
  await ui.unmount()
})

test('a resumed agent runs again', async ($, on) => {
  engine(on)
  on('clock.now', () => ({ value: 0 }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1' })
  await $.turn.complete({ ...DONE, agentId: 'a1' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^done · 0 files/ })).toBeTruthy()
  await $.turn.start({ text: 'one more thing', turnId: 't2', agentId: 'a1' })
  expect(await ui.find({ type: 'Text', text: /^⟳ 0 s · 0 files/ })).toBeTruthy()
  await ui.unmount()
})

test('running agents are never trimmed', async ($, on) => {
  engine(on)
  on('clock.now', () => ({ value: 0 }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${n++}` }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 15; i++) {
    await $.agent.spawn({ ...SPAWN, tool_use_id: `t${i}` })
    if (i > 0) await $.turn.complete({ ...DONE, agentId: `a${i}` })
  }
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /subagents \[1\/13\]/ })).toBeTruthy()
  await ui.unmount()
})

test('clear keeps running agents and drops history', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {} }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${n++}` }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't0' })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1' })
  await $.turn.complete({ ...DONE, agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.command.run({ command: 'agent-radar', args: 'clear' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /subagents \[1\/1\].*tools \[0\]/ })).toBeTruthy()
  await ui.unmount()
})

test('an advisor answer that arrives after a clear is dropped', async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  engine(on)
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'the plan', toolUses: [] }] }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('model.complete', async () => {
    await clock.sleep(5000)
    return { value: { isAnswered: true, text: 'The plan skips the tests.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'ExitPlanMode' })
  await clock.settle()
  await $.command.run({ command: 'agent-radar', args: 'clear' })
  await clock.advance(5000)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^✗/ })).toBe(undefined)
  expect(toasts).toEqual([])
  await ui.unmount()
})

test('a call waiting for approval needs attention until it runs', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  // Only the check this test raises asks; a test has no person to answer a dialog.
  let asking = false
  on('tool.check', () => ({ decision: asking ? 'ask' : 'allow' }))
  on('tool.call', async () => {
    await clock.sleep(1000)
    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const call = $.tool.call({ tool: 'Bash', command: 'git push', tool_use_id: 'u1' })
  await clock.settle()
  asking = true
  await $.tool.check({ tool: 'Bash', input: { command: 'git push' }, tool_use_id: 'u1' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^⟳ Bash/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /approval · Bash git push/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /needs attention/ })).toBeTruthy()
  await clock.advance(1000)
  await call
  expect(await ui.find({ type: 'Text', text: /approval/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^⟳ Bash/ })).toBe(undefined)
  await ui.unmount()
})

test('three failed calls in a row need attention', async ($, on) => {
  engine(on)
  on('clock.now', () => ({ value: 0 }))
  on('tool.call', () => ({ result: {}, text: 'boom', isError: true }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'false' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /3 errors in a row/ })).toBeTruthy()
  await ui.unmount()
})

test('the engine\'s agent status wins over the card', async ($, on) => {
  engine(on)
  on('clock.now', () => ({ value: 0 }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Mod lesen', type: 'Explore', status: 'waiting' }] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Explore waiting/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^waiting · 0 files/ })).toBeTruthy()
  await ui.unmount()
})

for (const language of ['fr', 'es', 'zh', 'ja'] as const) {
  test(`${language} option draws the pane`, { options: { language } }, async ($, on) => {
    on('command.register', () => ({ value: { command: 'agent-radar' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 1 }, rateLimits: [] } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('ui.status', () => ({ value: undefined }))
    on('clock.now', () => ({ value: 0 }))
    on('tool.call', () => ({ result: {} }))

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'git status' })

    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /git \[1\]/ })).toBeTruthy()
    await ui.unmount()
  })
}
