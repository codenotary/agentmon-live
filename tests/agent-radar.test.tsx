import type { On } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { ago, findCheck, hidesExit, outcomeOf, resetTime, smoothBar, spinner } from '../hooks/format'
import { brief, fit, gitCommand, kilo, modelName, testsOf } from '../hooks/register'
import { rank } from '../hooks/state'

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

// The engine answers every test needs; a test adds its own hooks after. Returns the last status line set.
function engine(on: On) {
  let status = ''
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', (_, e) => {
    status = e.text ?? ''
    return { value: undefined }
  })
  return () => status
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
  expect(await ui.find({ type: 'Text', text: /^git\s+▕.*▏\s+1$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^read files/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d main session\s+git status/ })).toBe(undefined)
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
  const plans = ['the first plan', 'the second plan']
  on('session.messages', () => ({ value: [{ role: 'assistant', text: plans.shift() ?? 'later plan', toolUses: [] }] }))
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
  // A second plan check within the minute's cooldown would be skipped.
  await clock.advance(61_000)
  await $.tool.call({ tool: 'ExitPlanMode' })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^✓ plan\s+ OK $/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^✗ plan\s+ NOK $/ })).toBeTruthy()
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
  const status = engine(on)
  on('clock.now', () => ({ value: 0 }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${n++}` }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 15; i++) {
    await $.agent.spawn({ ...SPAWN, tool_use_id: `t${i}` })
    if (i > 0) await $.turn.complete({ ...DONE, agentId: `a${i}` })
  }
  expect(status()).toMatch(/subagents \[1\/13\]/)
})

test('clear keeps running agents and drops history', async ($, on) => {
  mock.clock(on)
  const status = engine(on)
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

  expect(status()).toMatch(/subagents \[1\/1\].*tools \[0\]/)
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
  expect(await ui.find({ type: 'Text', text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^ APPROVAL  Bash git push/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /NEEDS ATTENTION/ })).toBeTruthy()
  await clock.advance(1000)
  await call
  expect(await ui.find({ type: 'Text', text: /APPROVAL/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash/ })).toBe(undefined)
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
  expect(await ui.find({ type: 'Text', text: /^ WAITING  Explore/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^waiting · 0 files/ })).toBeTruthy()
  await ui.unmount()
})

test('shell commands are told apart by the check they run', () => {
  expect(findCheck('npm test')?.kind).toBe('test')
  expect(findCheck('claude plugin test .')?.kind).toBe('test')
  expect(findCheck('ls tests')?.kind).toBe(undefined)
  expect(findCheck('npx tsc --noEmit')?.kind).toBe('typecheck')
  expect(findCheck('npm run lint')?.kind).toBe('lint')
  expect(findCheck('cargo build --release')?.kind).toBe('build')
  expect(findCheck('cd repo && FOO=1 npx tsc --noEmit')?.kind).toBe('typecheck')
  expect(findCheck("python3 - <<'EOF'\nrun('npm test')\nnpm run lint\nEOF\necho done")?.kind).toBe(undefined)
  expect(findCheck("cat > x <<EOF\nnpm test\nEOF\nnpm run build")?.kind).toBe('build')
  expect(findCheck('grep -rn lint hooks')?.kind).toBe(undefined)
  expect(findCheck('echo "npm test"')?.kind).toBe(undefined)
  expect(findCheck('python -m pytest -q')?.kind).toBe('test')
  expect(findCheck('cd api && uv run pytest tests/')?.kind).toBe('test')
  expect(findCheck('./node_modules/.bin/jest --ci')?.kind).toBe('test')
  expect(findCheck('echo "x; npm test"')?.kind).toBe(undefined)
  expect(findCheck('pytest "tests/a b.py"')?.kind).toBe('test')
  expect(findCheck('make clean')?.kind).toBe(undefined)
  expect(findCheck('make -j8')?.kind).toBe('build')
  expect(findCheck("python3 - <<'EOF'\np='x'\nEOF\nclaude plugin test . 2>&1 | tail -2")).toEqual({ kind: 'test', part: 'claude plugin test . 2>&1' })
  expect(findCheck('cd api && uv run pytest "tests/a b.py" | tail')).toEqual({ kind: 'test', part: 'uv run pytest "tests/a b.py"' })
  expect(hidesExit('npm test | tail -5')).toBe(true)
  expect(hidesExit('set -o pipefail; npm test | tail')).toBe(false)
  expect(hidesExit('npm test || echo x')).toBe(false)
  expect(outcomeOf(' 40 pass\n 0 fail\nRan 40 tests across 1 file.', 'test')).toBe('ok')
  expect(outcomeOf(' 39 pass\n 1 fail', 'test')).toBe('failed')
  expect(outcomeOf('Tests: 2 failed, 10 passed', 'test')).toBe('failed')
  expect(outcomeOf('FAIL src/a.test.ts', 'test')).toBe('failed')
  expect(outcomeOf('===== 12 passed in 0.3s =====', 'test')).toBe('ok')
  expect(outcomeOf("src/a.ts(3,1): error TS2304: Cannot find name 'x'.", 'typecheck')).toBe('failed')
  expect(outcomeOf('', 'typecheck')).toBe('ok')
  expect(outcomeOf('✖ 3 problems (3 errors, 0 warnings)', 'lint')).toBe('failed')
  expect(outcomeOf('✔ Validation passed', 'lint')).toBe('ok')
  expect(outcomeOf('', 'test')).toBe('unknown')
  expect(outcomeOf('done', 'build')).toBe('unknown')
})

test('bars fill in eighths and the spinner turns', () => {
  expect(smoothBar(0, 4)).toBe('    ')
  expect(smoothBar(0.5, 4)).toBe('██  ')
  expect(smoothBar(1, 4)).toBe('████')
  expect(smoothBar(2, 4)).toBe('████')
  expect(smoothBar(-1, 4)).toBe('    ')
  expect(smoothBar(1 / 32, 4)).toBe('▏   ')
  expect(smoothBar(0.3, 4)).toBe('█▎  ')
  expect(spinner(0)).toBe('⠋')
  expect(spinner(500)).toBe('⠙')
  expect(spinner(5000)).toBe('⠋')
})

test('checks show their outcome and go stale after an edit', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', (_, e) =>
    'command' in e && /lint/.test(String(e.command)) ? { result: {}, text: 'lint errors', isError: true } : { result: {} },
  )

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit | tail -3' })
  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^test\s+ OK\s+npm test/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^typecheck\s+ OK / })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^ FAILED  lint npm run lint/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /STALE/ })).toBe(undefined)
  await clock.advance(1000)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
  expect(await ui.find({ type: 'Text', text: /^1 edited · 1 read/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^  src\/a\.ts$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^test\s+ OK\s+ STALE / })).toBeTruthy()
  await ui.unmount()
})

test('a call shows in its tab while it runs', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', async () => {
    await clock.sleep(3000)
    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const call = $.tool.call({ tool: 'Bash', command: 'git push' })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] git push$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /main session · 0 s$/ })).toBeTruthy()
  // The elapsed time moves on by itself while the call runs.
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: /main session · [12] s$/ })).toBeTruthy()
  await clock.advance(1500)
  await call
  expect(await ui.find({ type: 'Text', text: /^git push$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^last · Bash git push/ })).toBeTruthy()
  await ui.unmount()
})

test('usage says unavailable rather than zero, and shows rate limits', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'agent-radar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [{ kind: '5h', percentUsed: 42, resetsAt: '2026-10-26T14:00:00Z' }], cost: { usd: 1.5 } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /context\s+unavailable/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^5h .*42 % resets/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /\$1\.50/ })).toBeTruthy()
  await ui.unmount()
})

test('history folds and details unfold long text', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {} }))
  const long = `git commit -m "${'x'.repeat(80)}"`

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: long })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^git commit -m "x+…$/ })).toBeTruthy()
  await ui.press({ key: 'details' })
  expect(await ui.find({ type: 'Text', text: new RegExp(`^${long.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /TOOLS · CALLS/ })).toBeTruthy()
  await ui.press({ key: 'fold:history' })
  expect(await ui.find({ type: 'Text', text: /TOOLS · CALLS/ })).toBe(undefined)
  await ui.unmount()
})

test('a narrow pane still draws every section', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'boom', isError: true }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 50 } })
  expect(await ui.find({ type: 'Text', text: /NEEDS ATTENTION/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /CHANGES & VERIFICATION/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^● USAGE$/ })).toBeTruthy()
  await ui.unmount()
})

// Fable answers from `answers` in turn and records each prompt it was sent.
function fable(on: On, answers: string[], prompts: string[]) {
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return {
      value: { isAnswered: true, text: answers.shift() ?? 'OK', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }
  })
}

test('delegated work gets a done check with the request and subagent evidence', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  engine(on)
  fable(on, ['The subagent reported failing tests.'], prompts)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'Fix the parser', turnId: 'm1' })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1' })
  await $.turn.complete({ ...DONE, answer: '3 tests passed, 1 failed', agentId: 'a1' })
  await $.turn.complete({ ...DONE, turnId: 'm1', answer: 'Done.' })
  await clock.settle()

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Fix the parser')
  expect(prompts[0]).toMatch(/- Explore: done · FAIL \(reported\) · Mod lesen/)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^✗ done\s+ NOK $/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /↳ 0 files · 0 tools · 1 subagents/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /tokens 100 \/ 20/ })).toBeTruthy()
  await ui.unmount()
})

test('a long trail is trimmed from its oldest lines, never from the request', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  engine(on)
  fable(on, [], prompts)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {}, text: 'e'.repeat(300), isError: true }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'REQUEST-MARK keep me', turnId: 'm1' })
  for (let i = 0; i < 40; i++) await $.tool.call({ tool: 'Bash', command: `step-${i} ${'x'.repeat(90)}` })
  await clock.advance(61_000)
  await $.turn.complete({ ...DONE, turnId: 'm1', answer: 'Done.' })
  await clock.settle()

  const done = prompts.at(-1) ?? ''
  expect(done).toContain('REQUEST-MARK keep me')
  expect(done).toContain('step-39')
  expect(done).not.toContain('step-0 ')
  expect(done.length).toBeLessThan(13000)
})

test('repeated and rapid checks are suppressed and the budget holds', { options: { advisorBudget: 3 } }, async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  const plans = ['plan A', 'plan B', 'plan B', 'plan B', 'plan C', 'plan D']
  engine(on)
  fable(on, [], prompts)
  on('session.messages', () => ({ value: [{ role: 'assistant', text: plans.shift() ?? '', toolUses: [] }] }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const plan = async (wait: number) => {
    await clock.advance(wait)
    await $.tool.call({ tool: 'ExitPlanMode' })
    await clock.settle()
  }
  await plan(0) // A: asked
  await plan(1000) // B within the cooldown: skipped, so never asked
  await plan(61_000) // B: asked
  await plan(61_000) // B again: a duplicate, skipped
  await plan(61_000) // C: asked, the budget of 3 now used
  await plan(61_000) // D: over budget
  expect(prompts.map(p => p.match(/plan [A-D]/)?.[0])).toEqual(['plan A', 'plan B', 'plan C'])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /budget used/ })).toBeTruthy()
  expect(await ui.find({ key: 'advisor:check' })).toBe(undefined)
  await ui.unmount()
})

test('a failing advisor model leaves the dashboard working', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'the plan', toolUses: [] }] }))
  on('model.complete', () => {
    throw new Error('overloaded')
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'ExitPlanMode' })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /\(unavailable\)/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /total 1/ })).toBeTruthy()
  await ui.unmount()
})

test('check now asks Fable at once, past the cooldown', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  engine(on)
  fable(on, [], prompts)
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'the plan', toolUses: [] }] }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'advisor:check' })
  await clock.settle()
  await $.command.run({ command: 'agent-radar', args: 'check' })
  await clock.settle()
  expect(prompts.length).toBe(2)
  expect(prompts[0]).toMatch(/^Look at the work so far/)
  expect(await ui.find({ type: 'Text', text: /^✓ check\s+ OK $/ })).toBeTruthy()
  await ui.unmount()
})

test('an advisor answer that arrives after a reload is dropped', async ($, on) => {
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
    return { value: { isAnswered: true, text: 'Stale objection.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'ExitPlanMode' })
  await clock.settle()
  // A reload or an option change runs session.start again.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Stale objection/ })).toBe(undefined)
  expect(toasts).toEqual([])
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
    expect(await ui.find({ type: 'Text', text: /^git\s+▕.*▏\s+1$/ })).toBeTruthy()
    await ui.unmount()
  })
}

test('a hung advisor call times out and leaves Fable usable', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  let timeoutMs: number | undefined
  on('model.complete', (_, e) => {
    timeoutMs = e.timeoutMs
    return { value: { isAnswered: true, text: 'OK', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'agent-radar', args: 'check' })
  await clock.settle()
  expect(timeoutMs).toBe(30_000)
})

test('a reload settles calls, checks and subagents nobody will report back', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  let listed = [{ id: 'a1', description: 'Mod lesen', type: 'Explore', status: 'running' }]
  on('agent.list', () => ({ value: listed }))
  // The call never reports back: the module reloads while it runs.
  on('tool.call', () => new Promise(() => {}))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1' })
  void $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'u1' })
  listed = []
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^ RUNNING / })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] / })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^test\s+unknown / })).toBeTruthy()
  await ui.unmount()
})

const TODOS = [
  { content: 'Read the mod', status: 'completed', activeForm: 'Reading the mod' },
  { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
  { content: 'Ship it', status: 'pending', activeForm: 'Shipping it' },
] as const

test('the task list shows progress and the task in progress', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /TASKS 1\/3/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Writing tests/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Ship it/ })).toBe(undefined)
  await ui.press({ key: 'details' })
  expect(await ui.find({ type: 'Text', text: /· Ship it/ })).toBeTruthy()
  await ui.unmount()
})

test('task calls create, finish and delete tasks; a failed update changes nothing', async ($, on) => {
  mock.clock(on)
  engine(on)
  let next = 0
  on('tool.call', (_, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++next), subject: e.subject } } }
    if (e.tool === 'TaskUpdate' && e.status === 'pending') return { result: {}, text: 'no such task', isError: true }
    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TaskCreate', subject: 'A', description: 'a' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'B', description: 'b' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'C', description: 'c' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'deleted' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'pending' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /TASKS 1\/2/ })).toBeTruthy()
  await ui.unmount()
})

test('the done check names open tasks', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  engine(on)
  fable(on, ['OK'], prompts)
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'build it', turnId: 'm1' })
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Read', file_path: `/f${i}` })
  await $.turn.complete({ ...DONE, turnId: 'm1', answer: 'Done.' })
  await clock.settle()

  expect(prompts.at(-1)).toContain('Open tasks:\n- in_progress: Write tests\n- pending: Ship it')
})

test('elapsed and reset times read at a glance', () => {
  expect(ago(45_000)).toBe('45 s')
  expect(ago(2_970_000)).toBe('49 min')
  expect(ago(7_500_000)).toBe('2 h 5 min')
  const now = new Date(2026, 9, 26, 12, 0).getTime()
  expect(resetTime(new Date(2026, 9, 26, 21, 30).getTime(), now)).toBe('21:30')
  expect(resetTime(new Date(2026, 9, 29, 15, 0).getTime(), now)).toMatch(/^\S+ 15:00$/)
})

test('a dropped advisor answer still counts its tokens, and a reload keeps unavailable', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  let answer = true
  on('model.complete', async () => {
    await clock.sleep(1000)
    return answer
      ? { value: { isAnswered: true, text: 'OK', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
      : { value: { isAnswered: false, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'agent-radar', args: 'check' })
  await clock.settle()
  await $.command.run({ command: 'agent-radar', args: 'clear' })
  await clock.advance(1000)
  answer = false
  await $.command.run({ command: 'agent-radar', args: 'check' })
  await clock.advance(1000)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /tokens 100 \/ 20/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /\(unavailable\)/ })).toBeTruthy()
  await ui.unmount()
})

test('loaded skills show who loaded them and how often', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  // The Skill tool loads the skill's text while it runs, as a session does.
  on('tool.call', async (_, e) => {
    if (e.tool === 'Skill') await $.skill.prompt({ skill: e.skill, text: 'body', frontmatter: {}, source: 'plugin', pluginName: 'superpowers' })
    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1' })
  await $.tool.call({ tool: 'Skill', skill: 'brainstorming' })
  await $.tool.call({ tool: 'Skill', skill: 'brainstorming', agentId: 'a1' })
  await $.skill.prompt({ skill: 'review', text: 'body', frontmatter: {}, source: 'userSettings' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /SKILLS & COMMANDS · 2/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^superpowers:brainstorming\s+×2 · Explore · / })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^review\s+×1 · you · / })).toBeTruthy()
  await ui.unmount()
})

test('sections are ranked: urgent first, then the recently active, then the usual order', () => {
  const s = (key: string, isUrgent: boolean, at: number) => ({ key, isUrgent, at })
  const order = (list: ReturnType<typeof s>[]) => rank(list, 1_000_000).map(x => x.key)
  expect(order([s('tasks', false, 0), s('advisor', false, 0), s('usage', false, 0)])).toEqual(['tasks', 'advisor', 'usage'])
  expect(order([s('tasks', false, 0), s('changes', false, 990_000), s('skills', false, 999_000)])).toEqual(['skills', 'changes', 'tasks'])
  expect(order([s('tasks', false, 999_000), s('usage', true, 0)])).toEqual(['usage', 'tasks'])
})

test('a failed check moves its section to the top', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('tool.call', (_, e) => ('command' in e && /lint/.test(String(e.command)) ? { result: {}, text: 'lint errors', isError: true } : { result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
  const titles = async () => (await ui.findAll({ type: 'Text', text: /^● [A-Z& ]+$/ })).map(x => x.text.trim())
  const ui = await $.ui.mount(PANE)
  expect((await titles()).slice(0, 2)).toEqual(['● TASKS', '● FABLE'])
  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
  // Needs attention stays above every section.
  expect((await titles()).slice(0, 2)).toEqual(['● NEEDS ATTENTION', '● CHANGES & VERIFICATION'])
  await ui.unmount()
})

test('the header names the loaded version and commit', async ($, on) => {
  mock.clock(on)
  engine(on)
  const files: Record<string, string> = {
    '.claude-plugin/plugin.json': '{ "name": "agent-radar", "version": "0.6.0" }',
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.git/packed-refs': '# pack-refs\n3366336aaaabbbbccccddddeeeeffff000011112 refs/heads/main\n',
  }
  on('fs.read', (_, e) => {
    // A file not listed reads empty, as the module's own fallback leaves a missing one.
    return { value: Object.entries(files).find(([k]) => e.path.endsWith(`/${k}`))?.[1] ?? '' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^ 0\.6\.0 · 3366336$/ })).toBeTruthy()
  await ui.unmount()
})
