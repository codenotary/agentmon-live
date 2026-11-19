import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { issueLink } from '../hooks/feedback'
import { LANGUAGES } from '../hooks/i18n'
import { cfg } from '../hooks/state'
import { settingsWith, withOptions } from './options-helper'

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
}

test('hiddenSections drops those boxes', async ($, on) => {

  withOptions(on, { hiddenSections: ' usage, skills' })
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

test('an edited settings.json applies at the next prompt, and at once when Claude edits it', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  let settings = settingsWith({ layout: 'classic' })
  on('env.get', () => ({ value: undefined }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/settings.json')) return { value: settings }
    throw new Error('ENOENT')
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const showsUsage = async () => {
    await clock.settle()
    const ui = await $.ui.mount(PANE)
    const found = await ui.find({ type: 'Text', text: /USAGE/ })
    await ui.unmount()
    return found !== undefined
  }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await showsUsage()).toBe(true)

  settings = settingsWith({ layout: 'classic', hiddenSections: 'usage' })
  await $.turn.start({ text: 'next', turnId: 't1' })
  expect(await showsUsage()).toBe(false)

  settings = settingsWith({ layout: 'classic' })
  await $.tool.call({ tool: 'Edit', file_path: '/home/me/.claude/settings.json', old_string: 'a', new_string: 'b' })
  expect(await showsUsage()).toBe(true)
})

test('a secret in the project settings shows on Focus: git will commit it, or git-ignored when git says so or there is no repo', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  let exit = 1
  on('env.get', () => ({ value: undefined }))
  on('fs.read', (_, e) => {
    if (e.path === '/r/.claude/settings.local.json') return { value: JSON.stringify({ env: { SERVICE_API_KEY: ['9f8e7d6c', '5b4a3210ffee'].join('') } }) }
    throw new Error('ENOENT')
  })
  on('process.run', (_, e) => ({ value: { exitCode: e.argv[1] === 'check-ignore' ? exit : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const shows = async (text: RegExp) => {
    await clock.settle()
    const ui = await $.ui.mount(PANE)
    const found = await ui.find({ type: 'Text', text })
    await ui.unmount()
    return found !== undefined
  }
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await shows(/plain-text secrets: 1 · \.claude\/settings\.local\.json · git will commit it/)).toBe(true)
  for (const [turnId, code] of [['t2', 0], ['t3', 128]] as const) {
    exit = code
    await $.turn.start({ text: 'next', turnId })
    expect(await shows(/settings\.local\.json · git-ignored/)).toBe(true)
  }
  cfg.leaks = []
})

test('feedback drafts a prompt, the tool puts the draft in the pane, and only send posts it', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('env.get', (_, e) => ({ value: e.name === 'AGENTMON_FEEDBACK_URL' ? 'http://localhost:8787/feedback' : undefined }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__agentmon-live__${e.name}` } }))
  on('ui.toast', () => ({ value: undefined }))
  const posts: { url: string; body: string }[] = []
  on('http.fetch', (_, e) => {
    if (e.init?.method === 'POST') posts.push({ url: e.url, body: String(e.init.body) })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  let drafted = ''
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    drafted = e.text
    return { isFilled: true }
  })

  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'feedback' })
  expect(drafted).toContain('mcp__agentmon-live__feedback')

  const refused = await $.tool.call({ tool: 'mcp__agentmon-live__feedback', type: 'praise', text: 'x' })
  expect(String(refused.result)).toContain('Not taken')
  await $.tool.call({ tool: 'mcp__agentmon-live__feedback', type: 'idea', text: 'Export the flow as a picture.' })
  expect(await ui.find({ type: 'Text', text: /^Export the flow as a picture\.$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Link', text: /GitHub/ })).toBeTruthy()
  const second = await $.tool.call({ tool: 'mcp__agentmon-live__feedback', type: 'thanks', text: 'Another.' })
  expect(String(second.result)).toContain('already')
  expect(posts.length).toBe(0)

  await Promise.all([ui.press({ key: 'feedback:send' }), ui.press({ key: 'feedback:send' })])
  expect(posts.map(p => p.url)).toEqual(['http://localhost:8787/feedback'])
  expect(JSON.parse(posts[0]!.body)).toMatchObject({ type: 'idea', text: 'Export the flow as a picture.', app: 'agentmon-live', language: 'en' })
  expect(JSON.parse(posts[0]!.body).install).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^Export the flow/ })).toBe(undefined)

  await $.tool.call({ tool: 'mcp__agentmon-live__feedback', type: 'thanks', text: 'Good pane.' })
  expect(await ui.find({ type: 'Link', text: /GitHub/ })).toBe(undefined)
  await ui.press({ key: 'feedback:cancel' })
  expect(await ui.find({ type: 'Text', text: /^Good pane/ })).toBe(undefined)
  expect(posts.length).toBe(1)
  await $.tool.call({ tool: 'mcp__agentmon-live__feedback', type: 'other', text: 'Left\u202eover.\n\u200bLine\tend' })
  // What could hide or reorder the text is gone before the person reads it; the line break stays.
  expect(await ui.find({ type: 'Text', text: /^Left over\.\n Line end$/ })).toBeTruthy()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { sessionId: 's1' } } as never)
  expect(await ui.find({ type: 'Text', text: /^Left over/ })).toBe(undefined)
  await ui.unmount()

  const link = issueLink({ type: 'problem', text: '漢'.repeat(2000), details: '' })
  expect(link.length).toBeLessThan(6000)
  expect(link).toContain('Claude+Code')

  for (const t of Object.values(LANGUAGES)) {
    for (const part of ['problem', 'idea', 'thanks', 'other', '2000', 'mcp__agentmon-live__feedback']) expect(t.promptFeedback(2000)).toContain(part)
  }
})

test('a store read that failed at the start does not replace the kept install ID', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('env.get', () => ({ value: undefined }))
  on('fs.read', (_, e, next) => (e.path.endsWith('/settings.json') ? { value: settingsWith({ feedbackIdentity: 'ada@example.com' }) } : next(e)))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__agentmon-live__${e.name}` } }))
  on('ui.toast', () => ({ value: undefined }))
  let isReadBroken = true
  on('store.get', (_, e, next) => {
    if (e.key !== 'feedbackInstall') return next(e)
    if (isReadBroken) throw new Error('locked')
    return { value: 'kept-id' }
  })
  on('store.set', () => ({ value: undefined }))
  const sent: { install?: string }[] = []
  on('http.fetch', (_, e) => {
    sent.push(JSON.parse(String(e.init?.body ?? '{}')) as { install?: string })
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  await $.tool.call({ tool: 'mcp__agentmon-live__feedback', type: 'thanks', text: 'One.' })
  await ui.press({ key: 'feedback:send' })
  expect(sent).toEqual([])
  isReadBroken = false
  // `w` pressed while the send is under way does not change who it is from.
  await Promise.all([ui.press({ key: 'feedback:send' }), ui.press({ key: 'feedback:who' })])
  expect(sent[0]?.install).toBe('kept-id')
  await ui.unmount()
})

test('feedback is anonymous until the person names it; the install ID is the mod\'s own', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('env.get', () => ({ value: undefined }))
  on('fs.read', (_, e, next) => (e.path.endsWith('/settings.json') ? { value: settingsWith({ feedbackIdentity: 'ada@example.com' }) } : next(e)))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__agentmon-live__${e.name}` } }))
  on('ui.toast', () => ({ value: undefined }))
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  let isStoreBroken = false
  on('store.set', (_, e) => {
    if (isStoreBroken) throw new Error('disk full')
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const calls: { method: string; url: string; body: string }[] = []
  on('http.fetch', (_, e) => {
    calls.push({ method: e.init?.method ?? 'GET', url: e.url, body: String(e.init?.body ?? '') })
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  const sent = () => calls.filter(c => c.method === 'POST').map(c => JSON.parse(c.body) as { install?: string; identity?: string })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)

  // An identity in the options starts the draft named; `w` takes the name off again.
  await $.tool.call({ tool: 'mcp__agentmon-live__feedback', type: 'thanks', text: 'One.' })
  expect(await ui.find({ type: 'Button', text: /ada@example\.com/ })).toBeTruthy()
  await ui.press({ key: 'feedback:who' })
  expect(await ui.find({ type: 'Button', text: /anonymous/ })).toBeTruthy()
  await ui.press({ key: 'feedback:send' })
  expect(sent()[0]).not.toHaveProperty('install')
  expect(sent()[0]).not.toHaveProperty('identity')
  expect(store.get('feedbackInstall')).toBe(undefined)

  await $.tool.call({ tool: 'mcp__agentmon-live__feedback', type: 'thanks', text: 'Two.' })
  // An ID that cannot be kept sends nothing, and the draft stays.
  isStoreBroken = true
  await ui.press({ key: 'feedback:send' })
  expect(sent().length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /^Two\.$/ })).toBeTruthy()
  isStoreBroken = false
  await ui.press({ key: 'feedback:send' })
  const id = String(store.get('feedbackInstall'))
  expect(id).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
  expect(sent()[1]).toMatchObject({ install: id, identity: 'ada@example.com' })

  expect(calls.at(-1)).toMatchObject({ method: 'POST', url: 'https://feedback.codenotary.com/feedback' })
  await ui.unmount()
})

test('feedback off shows no button and takes no draft', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  withOptions(on, { feedback: 'off' })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__agentmon-live__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: /^feedback$/ })).toBe(undefined)
  const refused = await $.tool.call({ tool: 'mcp__agentmon-live__feedback', type: 'idea', text: 'x' })
  expect(String(refused.result)).toContain('turned off')
  await ui.unmount()
})

async function starAfter($: Parameters<TestBody>[0], on: On, count: number, options: Record<string, unknown>) {
  const clock = mock.clock(on)
  engine(on)
  withOptions(on, options)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__agentmon-live__${e.name}` } }))
  const store = new Map<string, unknown>([['starCount', count]])
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  const link = await ui.find({ type: 'Button', text: /★/ })
  await ui.unmount()
  expect(store.get('starCount')).toBe(count + 1)
  return Boolean(link)
}

test('every tenth load asks for a star', async ($, on) => {
  expect(await starAfter($, on, 9, {})).toBe(true)
})

test('the other loads ask for no star', async ($, on) => {
  expect(await starAfter($, on, 10, {})).toBe(false)
})

test('feedback off asks for no star', async ($, on) => {
  expect(await starAfter($, on, 9, { feedback: 'off' })).toBe(false)
})

// A failed lint check gives the pane an item to investigate.
async function askAfter($: Parameters<TestBody>[0], on: On, press: string, options: Record<string, unknown>) {
  const clock = mock.clock(on)
  engine(on)
  withOptions(on, options)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__agentmon-live__${e.name}` } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('tool.call', () => ({ result: {}, text: 'src/a.ts: 3 problems', isError: true }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  const before = [await ui.find({ type: 'Text', text: /Did you like the result/ }), await ui.find({ type: 'Button', text: /★/ })].map(Boolean)
  await ui.press({ key: press })
  await clock.settle()
  const after = [await ui.find({ type: 'Text', text: /Did you like the result/ }), await ui.find({ type: 'Button', text: /★/ })].map(Boolean)
  await ui.unmount()
  return { before, after, filled }
}

test('an investigate asks for feedback or a star, once the finding went to the prompt', async ($, on) => {
  const { before, after, filled } = await askAfter($, on, 'investigate:0', {})
  expect(before).toEqual([false, false])
  expect(after).toEqual([true, true])
  expect(filled.at(-1)).toMatch(/^The last lint check failed/)
})

test('the feedback button alone asks for nothing', async ($, on) => {
  expect((await askAfter($, on, 'feedback', {})).after).toEqual([false, false])
})

test('feedback off asks for nothing after an investigate', async ($, on) => {
  expect((await askAfter($, on, 'investigate:0', { feedback: 'off' })).after).toEqual([false, false])
})

// A turn with one model step and three reads of one file.
async function turnWithReads($: Parameters<TestBody>[0], on: On) {
  const clock = mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void _
  for (const id of ['r1', 'r2', 'r3']) await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/state.ts', tool_use_id: id })
  await clock.settle()
  return clock
}

test('the turn shows step by step, quiet repeats folded', async ($, on) => {
  await turnWithReads($, on)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /TURN STEPS/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Files\s+hooks\/state\.ts\s+×3/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Model\s+Opus 5\.5/ })).toBeTruthy()
  await ui.unmount()
})

test('hiddenSections hides the turn steps', async ($, on) => {
  withOptions(on, { hiddenSections: 'steps' })
  await turnWithReads($, on)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /TURN STEPS/ })).toBe(undefined)
  await ui.unmount()
})

test('memory, hooks and a typed command have rows of their own, and one category shows alone', async ($, on) => {
  // Classic shows ten rows; the default five would cut the sixth.
  withOptions(on, { layout: 'classic' })
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  on('classic.InstructionsLoaded', () => ({}))
  const clock = await turnWithReads($, on)
  await $.tool.call({ tool: 'Read', file_path: '/repo/CLAUDE.md', tool_use_id: 'm1' })
  await $.skill.prompt({ skill: 'review', text: 'body', frontmatter: {}, source: 'userSettings' })
  const hook = { type: 'hook_additional_context', text: 'be brief', origin: { kind: 'hook', event: 'UserPromptSubmit' } } as const
  await $.prompt.attachment(hook)
  await $.prompt.attachment(hook)
  // A subagent's request carries its own: not the main turn's step.
  await $.prompt.attachment({ ...hook, origin: { kind: 'hook', event: 'SubagentStart' }, agentId: 'a1' })
  await $.classic.InstructionsLoaded({ file_path: '/repo/web/CLAUDE.md', memory_type: 'Project', load_reason: 'nested_traversal' })
  await $.classic.InstructionsLoaded({ file_path: '/repo/docs/CLAUDE.md', memory_type: 'Project', load_reason: 'nested_traversal', agent_id: 'a1' })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Memory\s+repo\/CLAUDE\.md/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Memory\s+web\/CLAUDE\.md · folder entered/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Skills\s+\/review/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Hooks\s+hook added context \(UserPromptSubmit\)\s+×2/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /SubagentStart/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /docs\/CLAUDE\.md/ })).toBe(undefined)

  expect((await $.command.run({ ...TYPED, command: 'agentmon', args: 'steps memory' })).text).toBe('AgentMon Live: turn steps · Memory')
  expect(await ui.find({ type: 'Text', text: /TURN STEPS · MEMORY/i })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Skills\s+\/review/ })).toBe(undefined)
  expect((await $.command.run({ ...TYPED, command: 'agentmon', args: 'steps' })).text).toBe('AgentMon Live: turn steps · all')
  expect(await ui.find({ type: 'Text', text: /Skills\s+\/review/ })).toBeTruthy()
  expect((await $.command.run({ ...TYPED, command: 'agentmon', args: 'Steps Hooks' })).text).toBe('AgentMon Live: turn steps · Hooks')
  await ui.unmount()
})

test('a hook that sends the turn back has a row in the turn that goes on', async ($, on) => {
  on('classic.Stop', () => ({ block: 'go on' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = await turnWithReads($, on)
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'done' })
  await clock.advance(1000)
  await $.turn.start({ text: '', turnId: 't1' })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Hooks\s+a hook sent the turn back/ })).toBeTruthy()
  await ui.unmount()
})

test('a refused call keeps its own time in the step list', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ deny: 'not allowed here' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'git push --force', tool_use_id: 'b1' })
  // Long after: a finished row must not count on like a running one.
  await clock.advance(60_000)
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  const row = await ui.find({ type: 'Text', text: /⊘ .*git push/ })
  expect(row?.text).toMatch(/git push\s+0\.0s$/)
  await ui.unmount()
})

test('instruction files no InstructionsLoaded named get their rows from the prompt context, once', async ($, on) => {
  withOptions(on, { layout: 'classic' })
  on('classic.InstructionsLoaded', () => ({}))
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
  const clock = await turnWithReads($, on)
  await $.classic.InstructionsLoaded({ file_path: '/repo/web/CLAUDE.md', memory_type: 'Project', load_reason: 'nested_traversal' })
  const files = [
    { path: '/repo/web/CLAUDE.md', kind: 'project', content: '' },
    { path: '/repo/CLAUDE.local.md', kind: 'local', content: '' },
    { path: '/repo/docs/rules.md', kind: 'project', content: '', parent: '/repo/CLAUDE.local.md' },
  ] as const
  await $.prompt.context({ blocks: [], instructionFiles: files } as never)
  await $.prompt.context({ blocks: [], instructionFiles: files } as never)
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Memory\s+repo\/CLAUDE\.local\.md · session start\s/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Memory\s+docs\/rules\.md · included\s/ })).toBeTruthy()
  expect(await ui.findAll({ type: 'Text', text: /web\/CLAUDE\.md/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /CLAUDE\.local\.md · session start/ })).toHaveLength(1)
  await ui.unmount()
})

test('after a session switch the prompt context lists the instruction files again', async ($, on) => {
  withOptions(on, { layout: 'classic' })
  let id = 's1'
  on('session.id', () => ({ value: id }))
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
  const clock = await turnWithReads($, on)
  const files = [{ path: '/repo/CLAUDE.md', kind: 'project', content: '' }] as const
  await $.prompt.context({ blocks: [], instructionFiles: files } as never)
  id = 's2'
  await $.turn.start({ text: 'next', turnId: 't2' })
  await $.prompt.context({ blocks: [], instructionFiles: files } as never)
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  // Listed once per session: the second session's row folds into the first one's.
  expect(await ui.find({ type: 'Text', text: /Memory\s+repo\/CLAUDE\.md · session start\s+×2/ })).toBeTruthy()
  await ui.unmount()
})
