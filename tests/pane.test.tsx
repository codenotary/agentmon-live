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

test('a newer GitHub release puts update and changelog by the version, and is fetched once a day', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/.claude-plugin/plugin.json')) return { value: '{ "name": "agentmon-live", "version": "0.16.0" }' }
    throw new Error('ENOENT')
  })
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('env.get', () => ({ value: undefined }))
  let fetches = 0
  on('http.fetch', () => {
    fetches++
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ tag_name: 'v0.17.0', body: 'Update check' }) } }
  })
  let drafted = ''
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    drafted = e.text
    return { isFilled: true }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: /^update$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /is out/ })).toBe(undefined)
  await ui.press({ key: 'update' })
  expect(drafted).toBe('Update AgentMon Live from 0.16.0 to 0.17.0: run `claude plugin marketplace update agentmon-live`, then `claude plugin update agentmon-live`, then tell me to run /reload-plugins.')
  expect(await ui.find({ type: 'Text', text: /^Update check$/ })).toBe(undefined)
  await ui.press({ key: 'changelog' })
  expect(await ui.find({ type: 'Text', text: /^Update check$/ })).toBeTruthy()
  await ui.unmount()

  // A second session the same day reads the cache.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(fetches).toBe(1)
})

test('an install since the last look asks again once; a checkout ahead of the latest release is not asked each session', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/.claude-plugin/plugin.json')) return { value: '{ "name": "agentmon-live", "version": "0.17.0" }' }
    throw new Error('ENOENT')
  })
  on('env.get', () => ({ value: undefined }))
  // Seen just now, by a version saved before `installed` was kept.
  const store = new Map<string, unknown>([['release', { at: 0, version: '0.16.0', notes: '' }]])
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  let fetches = 0
  on('http.fetch', () => {
    fetches++
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ tag_name: 'v0.16.0', body: '' }) } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(fetches).toBe(1)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(fetches).toBe(1)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: /^update$/ })).toBe(undefined)
  await ui.unmount()
})

test('a failed release check shows nothing', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/.claude-plugin/plugin.json')) return { value: '{ "name": "agentmon-live", "version": "0.16.0" }' }
    throw new Error('ENOENT')
  })
  on('env.get', () => ({ value: undefined }))
  let fetched = false
  on('store.get', () => ({ value: undefined }))
  on('http.fetch', () => {
    fetched = true
    return { value: { status: 403, ok: false, headers: {}, text: 'rate limited' } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(fetched).toBe(true)
  expect(await ui.find({ type: 'Button', text: /^update/ })).toBe(undefined)
  await ui.unmount()
})
