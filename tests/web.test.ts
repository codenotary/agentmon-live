import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { WebSnapshot } from '../types'
import { LANGUAGES } from '../hooks/i18n'
import { shapeInsights } from '../hooks/state'
import { pushTurn, toSnapshot } from '../hooks/web'
import { SHAPE } from './fixtures/snapshot-shape'
import { withOptions } from './options-helper'

type On = Parameters<TestBody>[1]

const PANE = {
  plugin: 'agentmon-live',
  component: 'Pane',
  requestId: 'agentmon-live',
  surface: 'terminal',
  props: { title: 'AgentMon Live', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

// A running server: `ensure` answers the port, `open` succeeds, the rest of the host stays quiet.
function engine(on: On, ensure: () => unknown = () => ({ exitCode: 0, stdout: '{"port":47311}\n', stderr: '' }), sessionId: () => string = () => 'sess-1', openExit = 0) {
  const argvs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    argvs.push(e.argv)
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: 'main\n', stderr: '' } as never }
    if (e.argv.includes('open')) return { value: { exitCode: openExit, stdout: '', stderr: '' } as never }
    return { value: ensure() as never }
  })
  on('command.register', () => ({ value: { command: 'agentmon' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: sessionId() }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 290000, percent: 29 }, cost: { usd: 1.5 }, rateLimits: [{ kind: 'seven_day', percentUsed: 77 }] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  return argvs
}

function posts(on: On) {
  const sent: { url: string; method?: string; body?: string; type?: string }[] = []
  on('http.fetch', (_, e) => {
    sent.push({ url: e.url, method: e.init?.method, body: e.init?.body as string | undefined, type: (e.init?.headers as Record<string, string> | undefined)?.['content-type'] })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  return sent
}

const onlyPosts = <T extends { method?: string }>(sent: T[]) => sent.filter(s => s.method === 'POST')

test('toSnapshot maps a session to the contract the page reads', () => {
  const t = LANGUAGES.de!
  const snap: WebSnapshot = toSnapshot({
    session: { id: 's', cwd: '/w', branch: 'main' },
    now: 1000,
    main: { model: 'm', effort: 'high' },
    usage: { startedAt: 5, context: { window: 100, tokens: 19, percent: 19 }, cost: { usd: 2 }, rateLimits: [{ kind: 'seven_day', percentUsed: 77 }] },
    ins: shapeInsights({ turns: 3, turn: { startedAt: 900, wallMs: 0, buckets: { model: 40 }, steps: 1, mode: 'shell', since: 950 } }),
    turnRing: [{ startedAt: 1, wallMs: 9, buckets: { model: 9 } }],
    doing: [{ id: 'a', who: 'main', tool: 'Bash', what: 'rm x', startedAt: 990, isAsking: true }],
    calls: [],
    agents: [],
    checks: [{ kind: 'test', command: 'npm test', who: 'main', at: 2, result: 'failed' }],
    files: { read: [], edited: [], editedAt: 0 },
    log: [],
    tasks: [],
    streak: 0,
    dismissed: [],
    learned: { current: 's', sessions: [], mem: [], bench: [] },
    focus: [{ key: 'k', score: 1, tag: 'tip', color: 'blue', text: 'look', prompt: 'p' }],
    t,
    lang: 'de',
  })
  expect(snap.v).toBe(1)
  expect(snap.usage).toEqual({ ctxPct: 19, rate: [{ kind: 'seven_day', pct: 77 }], usd: 2 })
  expect(snap.turnCount).toBe(3)
  // The finished turn, then the one under way with the time not yet booked.
  expect(snap.turns).toEqual([{ startedAt: 1, wallMs: 9, buckets: { model: 9 } }, { startedAt: 900, wallMs: 100, buckets: { model: 40, shell: 50 }, isLive: true }])
  // What needs the person comes first, then the insights.
  expect(snap.focus.map(f => [f.tag, f.isUrgent])).toEqual([[t.approval, true], [t.failed, true], ['tip', false]])
  expect(snap.lang).toBe('de')
  expect((snap.labels.page as Record<string, string>).focus).toBe(t.web.page.focus)
  expect(JSON.stringify(snap)).not.toContain('"prompt"')
  expect((snap.labels.result as Record<string, string>).failed).toBe(t.failed)

  // The page is drawn and checked from a fixture the server test holds to this same shape.
  const keys = (o: object) => Object.keys(o).sort()
  expect(keys(snap)).toEqual([...SHAPE.top].sort())
  for (const part of ['session', 'usage', 'insights', 'learned', 'labels'] as const) expect(keys(snap[part] as object)).toEqual([...SHAPE[part]].sort())
  expect(keys(snap.labels.page as object)).toEqual([...SHAPE.page].sort())
})

test('a dismissed item stays away from the page as from the pane', () => {
  const snap = toSnapshot({
    session: { id: 's', cwd: '/w' },
    now: 1,
    main: { model: 'm', effort: '' },
    usage: { startedAt: 0, context: { window: 100 }, cost: { usd: 0 }, rateLimits: [] },
    ins: shapeInsights({}),
    turnRing: [],
    doing: [],
    calls: [],
    agents: [],
    checks: [{ kind: 'lint', command: 'x', who: 'main', at: 2, result: 'failed' }],
    files: { read: [], edited: [], editedAt: 0 },
    log: [],
    tasks: [],
    streak: 0,
    dismissed: ['check:lint:2'],
    learned: { current: '', sessions: [], mem: [], bench: [] },
    focus: [],
    t: LANGUAGES.en!,
    lang: 'en',
  })
  expect(snap.focus).toEqual([])
})

test('pushTurn keeps each finished turn once, the last 50', () => {
  let ring = pushTurn([], undefined)
  expect(ring).toEqual([])
  const turn = (startedAt: number) => ({ startedAt, wallMs: 1, buckets: {}, steps: 0 })
  ring = pushTurn(ring, turn(1))
  ring = pushTurn(ring, turn(1))
  expect(ring.length).toBe(1)
  for (let i = 2; i < 60; i += 1) ring = pushTurn(ring, turn(i))
  expect(ring.length).toBe(50)
  expect(ring[0]!.startedAt).toBe(10)
})

test('a session starts the server and posts JSON to it, once while nothing changes', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  const argvs = engine(on)
  const sent = posts(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  await clock.settle()
  const ensure = argvs.find(a => a.includes('ensure'))
  expect(ensure?.[0]).toBe('node')
  expect(ensure?.[1]).toMatch(/server\/web\.mjs$/)
  expect(ensure?.at(-1)).toBe('47311')
  expect(onlyPosts(sent).length).toBe(1)
  expect(sent[0]!.url).toBe('http://127.0.0.1:47311/state/sess-1')
  expect(sent[0]!.type).toBe('application/json')
  const body = JSON.parse(sent[0]!.body!) as WebSnapshot
  expect(body.session.branch).toBe('main')
  await clock.advance(5000)
  await clock.settle()
  expect(onlyPosts(sent).length).toBe(1)
})

test('a quiet session still posts every 30 s, so the server keeps it', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  const sent = posts(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(31_000)
  await clock.settle()
  expect(onlyPosts(sent).length).toBe(2)
})

test('web off: no process, no post, no button', async ($, on) => {
  withOptions(on, { web: 'off' })
  const clock = mock.clock(on)
  const argvs = engine(on)
  const sent = posts(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  await clock.settle()
  expect(argvs.some(a => a.includes('ensure'))).toBe(false)
  expect(onlyPosts(sent).length).toBe(0)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'web:open' })).toBe(undefined)
  await ui.unmount()
})

test('no Node: the pane draws as before, with no button and no posts', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on, () => {
    throw new Error('spawn node ENOENT')
  })
  const sent = posts(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  await clock.settle()
  expect(onlyPosts(sent).length).toBe(0)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'web:open' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /AGENTMON LIVE/ })).toBeTruthy()
  await ui.unmount()
})

test('a server that went away is started again, at most once a minute', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  const argvs = engine(on)
  let isDown = false
  on('http.fetch', () => {
    if (isDown) throw new Error('ECONNREFUSED')
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  await clock.settle()
  isDown = true
  await clock.advance(31_000)
  await clock.settle()
  const ensures = () => argvs.filter(a => a.includes('ensure')).length
  expect(ensures()).toBe(2)
  await clock.advance(5000)
  await clock.settle()
  expect(ensures()).toBe(2)
})

test('the button and /agentmon open run the opener on the server address', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  const argvs = engine(on)
  posts(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'web:open' })).toBeTruthy()
  await ui.press({ key: 'web:open' })
  await ui.unmount()
  const opens = () => argvs.filter(a => a.includes('open'))
  expect(opens().length).toBe(1)
  expect(opens()[0]!.at(-1)).toBe('http://127.0.0.1:47311/')
  const r = await $.command.run({ command: 'agentmon', args: 'open', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(opens().length).toBe(2)
  expect(String(r.text)).toContain('http://127.0.0.1:47311/')
})

test('/agentmon open with web off says how to turn it on', async ($, on) => {
  withOptions(on, { web: 'off' })
  const clock = mock.clock(on)
  engine(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const r = await $.command.run({ command: 'agentmon', args: 'open', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(String(r.text)).toBe(LANGUAGES.en!.web.off)
})

test('webOpenOnStart opens one tab per session, also across a reload', async ($, on) => {
  withOptions(on, { webOpenOnStart: true })
  const clock = mock.clock(on)
  const argvs = engine(on)
  posts(on)
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(argvs.filter(a => a.includes('open')).length).toBe(1)
})

test('after /clear the old id leaves and posts go on under the new one', async ($, on) => {
  let id = 'sess-1'
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on, undefined, () => id)
  const sent = posts(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as never)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  await clock.settle()
  id = 'sess-2'
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { sessionId: 'sess-1' } } as never)
  await clock.advance(600)
  await clock.settle()
  expect(sent.find(s => s.method === 'DELETE')?.url).toBe('http://127.0.0.1:47311/state/sess-1')
  expect(onlyPosts(sent).at(-1)?.url).toBe('http://127.0.0.1:47311/state/sess-2')
})

test('a post another server refuses looks for ours, and does not repeat the search', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  const argvs = engine(on)
  on('http.fetch', () => ({ value: { status: 404, ok: false, headers: {}, text: '' } }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)
  await clock.settle()
  expect(argvs.filter(a => a.includes('ensure')).length).toBe(2)
})

test('no browser to open: the answer gives the address, not a Node problem', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on, () => ({ exitCode: 0, stdout: '{"port":47311}\n', stderr: '' }), undefined, 1)
  posts(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const r = await $.command.run({ command: 'agentmon', args: 'open', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(String(r.text)).toBe(LANGUAGES.en!.web.noBrowser('http://127.0.0.1:47311/'))
})

test('the session leaves the server when it ends', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  const sent = posts(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as never)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  await clock.settle()
  await $.session.end({ reason: 'other', sessionId: 'sess-1', resume: { sessionId: 'sess-1' } } as never)
  const gone = sent.find(s => s.method === 'DELETE')
  expect(gone?.url).toBe('http://127.0.0.1:47311/state/sess-1')
  expect(gone?.type).toBe('application/json')
})
