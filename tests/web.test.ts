import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { WebSnapshot } from '../types'
import { LANGUAGES } from '../hooks/i18n'
import { shapeInsights } from '../hooks/state'
import { changeKey, pushTurn, toSnapshot, urgentItems } from '../hooks/web'
import { SHAPE } from './fixtures/snapshot-shape'
import { settingsWith, withOptions } from './options-helper'

type On = Parameters<TestBody>[1]

const PANE = {
  plugin: 'agentmon-live',
  component: 'Pane',
  requestId: 'agentmon-live',
  surface: 'terminal',
  props: { title: 'AgentMon Live', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

// A running server: `ensure` answers the port, `open` succeeds, the rest of the host stays quiet.
let panesOpened = 0

function engine(on: On, ensure: () => unknown = () => ({ exitCode: 0, stdout: '{"port":47311}\n', stderr: '' }), sessionId: () => string = () => 'sess-1', openExit = 0) {
  const argvs: (readonly string[])[] = []
  on('process.run', async (_, e) => {
    argvs.push(e.argv)
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: 'main\n', stderr: '' } as never }
    if (e.argv.includes('open')) return { value: { exitCode: openExit, stdout: '', stderr: '' } as never }
    return { value: (await ensure()) as never }
  })
  on('command.register', () => ({ value: { command: 'agentmon' } }))
  on('ui.open', () => {
    panesOpened += 1
    return { value: { isPlaced: true } }
  })
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

const onlyPosts = <T extends { method?: string; url: string }>(sent: T[]) => sent.filter(s => s.method === 'POST' && s.url.includes('/state/'))

test('toSnapshot maps a session to the contract the page reads', () => {
  const t = LANGUAGES.de!
  const snap: WebSnapshot = toSnapshot({
    session: { id: 's', cwd: '/w', branch: 'main' },
    now: 1000,
    main: { model: 'm', effort: 'high' },
    usage: { startedAt: 5, context: { window: 100, tokens: 19, percent: 19 }, cost: { usd: 2 }, rateLimits: [{ kind: 'seven_day', percentUsed: 77 }, { kind: 'five_hour', percentUsed: 5, resetsAt: '2026-11-06T00:00:00Z' }, { kind: 'other', percentUsed: 1, resetsAt: 'soon' }] },
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
    isPaneOpen: true,
    build: '1.2.3 · abc1234',
    testReview: { files: [{ path: '/r/a.test.ts', removed: 0, skips: 0, at: 1, changed: 1, lines: [{ before: 'toBe(2)', after: 'toBe(3)' }] }], dropped: [], isGreen: true },
    trace: [],
  })
  expect(snap.testReview?.files[0]).toMatchObject({ changed: 1, lines: [{ before: 'toBe(2)', after: 'toBe(3)' }] })
  expect(snap.v).toBe(1)
  expect(snap.usage).toEqual({ ctxPct: 19, ctxTokens: 19, ctxWindow: 100, rate: [{ kind: 'seven_day', pct: 77 }, { kind: 'five_hour', pct: 5, resetsAt: Date.parse('2026-11-06T00:00:00Z') }, { kind: 'other', pct: 1 }], usd: 2 })
  expect(snap.turnCount).toBe(3)
  // The finished turn, then the one under way with the time not yet booked.
  expect(snap.turns).toEqual([{ startedAt: 1, wallMs: 9, buckets: { model: 9 } }, { startedAt: 900, wallMs: 100, buckets: { model: 40, shell: 50 }, isLive: true }])
  // What needs the person comes first, then the insights.
  expect(snap.focus.map(f => [f.tag, f.isUrgent])).toEqual([[t.approval, true], [t.failed, true], ['tip', false]])
  expect(snap.lang).toBe('de')
  expect(snap.build).toBe('1.2.3 · abc1234')
  expect((snap.labels.page as Record<string, string>).events).toBe(t.web.page.events)
  expect(JSON.stringify(snap)).not.toContain('"prompt"')
  expect((snap.labels.result as Record<string, string>).failed).toBe(t.failed)

  // The page is drawn and checked from a fixture the server test holds to this same shape.
  const keys = (o: object) => Object.keys(o).sort()
  expect(keys(snap)).toEqual([...SHAPE.top].sort())
  for (const part of ['session', 'usage', 'insights', 'learned', 'labels'] as const) expect(keys(snap[part] as object)).toEqual([...SHAPE[part]].sort())
  expect(keys(snap.labels.page as object)).toEqual([...SHAPE.page].sort())
})

test('a subagent\'s calls carry its id, and its reads and edits reach the files list', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  const sent = posts(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'p', description: 'Review: a.ts', subagentType: 'general-purpose', tool_use_id: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: '/w/b.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  await clock.advance(600)
  await clock.settle()
  const body = JSON.parse(onlyPosts(sent).at(-1)!.body!) as WebSnapshot
  expect(body.files.read).toEqual(['/w/a.ts'])
  expect(body.files.edited).toEqual(['/w/b.ts'])
  expect(body.trace?.map(c => c.agentId)).toEqual(['a1', 'a1'])
  expect(body.agents[0]).toMatchObject({ callId: 't1', prompt: 'p', task: 'Review: a.ts' })
})

const lastSnapshot = (sent: { method?: string; url: string; body?: string }[]) => JSON.parse(onlyPosts(sent).at(-1)!.body!) as WebSnapshot
const AGENT_USAGE = (input: number) => ({ input_tokens: input, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' })
const agentStep = async ($: Parameters<TestBody>[0], index: number) => {
  for await (const _ of $.turn.step({ turnId: 'a', index, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' } as never)) void _
}

test('a resumed subagent runs again from where it was: no old end, its numbers add up', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  const sent = posts(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  let input = 500
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: AGENT_USAGE(input) }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'p', description: 'Review', subagentType: 'general-purpose', tool_use_id: 't1' } as never)
  await agentStep($, 0)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'a1' })
  await clock.settle()
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'a', reason: 'answer', agentId: 'a1', usage: AGENT_USAGE(500) } as never)
  await clock.advance(600)
  await clock.settle()
  expect(lastSnapshot(sent).agents[0]!.endedAt).toBeDefined()

  await $.turn.start({ text: 'one more thing', turnId: 'a', agentId: 'a1' } as never)
  await clock.advance(600)
  await clock.settle()
  const resumed = lastSnapshot(sent).agents[0]!
  expect(resumed.status).toBe('running')
  expect(resumed.endedAt).toBeUndefined()

  input = 10
  await agentStep($, 1)
  await $.tool.call({ tool: 'Read', file_path: '/w/b.ts', agentId: 'a1' })
  await clock.settle()
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'a', reason: 'answer', agentId: 'a1', usage: AGENT_USAGE(10) } as never)
  await clock.advance(600)
  await clock.settle()
  expect(lastSnapshot(sent).agents[0]).toMatchObject({ input: 510, output: 20, files: 2, status: 'done' })
})

test('/agentmon clear empties what the page draws from', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  const sent = posts(on)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'work', turnId: 'm1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  await clock.advance(1000)
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'm1', reason: 'answer' } as never)
  await clock.advance(600)
  await clock.settle()
  expect(lastSnapshot(sent).trace).toHaveLength(1)
  expect(lastSnapshot(sent).turns).toHaveLength(1)
  await $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 }, command: 'agentmon', args: 'clear' } as never)
  await clock.advance(600)
  await clock.settle()
  expect(lastSnapshot(sent).trace).toEqual([])
  expect(lastSnapshot(sent).turns).toEqual([])
  expect(lastSnapshot(sent).turnCount).toBe(0)
})

test('the turn\'s answer, a message\'s recipient, an agent\'s name and a resumed start reach the page', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  const sent = posts(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'resume' } as never)
  await $.turn.start({ text: 'work', turnId: 'm1' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'scout', subagentType: 'general-purpose', tool_use_id: 't1', name: 'scout' } as never)
  await $.tool.call({ tool: 'SendMessage', to: 'scout', message: 'go on' } as never)
  await clock.advance(1000)
  await $.turn.complete({ answer: 'Fixed it.\napi_key=sk-abcdefghijklmnopqrstuv', durationMs: 1000, isAborted: false, turnId: 'm1', reason: 'answer' } as never)
  await clock.advance(600)
  await clock.settle()
  const body = lastSnapshot(sent)
  expect(body.turns.at(-1)?.answer).toBe('Fixed it.\napi_key=***')
  expect(body.trace?.find(c => c.tool === 'SendMessage')).toMatchObject({ to: 'scout', what: '→ scout' })
  expect(body.agents[0]?.name).toBe('scout')
  expect(body.log.map(x => x.what)).toContain('session resumed')
})

test('approvals over the session, edit times and the done gate reach the page', async ($, on) => {
  withOptions(on, { advisorMode: 'gate' })
  const clock = mock.clock(on)
  engine(on)
  const sent = posts(on)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.check', (_, e) => ({ decision: e.tool === 'Bash' ? ('ask' as const) : ('allow' as const) }))
  on('classic.Stop', () => ({}))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  for (const turnId of ['m1', 'm2']) {
    await $.turn.start({ text: 'work', turnId } as never)
    await $.tool.check({ tool: 'Bash', input: { command: 'git push' }, tool_use_id: `c${turnId}` } as never)
  }
  await clock.advance(5000)
  await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'a', new_string: 'b' })
  await clock.settle()
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'done' })
  await clock.advance(600)
  await clock.settle()
  const body = lastSnapshot(sent)
  expect(Object.values(body.insights.askedAll ?? {})).toEqual([2])
  expect(Object.keys(body.files.editedTimes ?? {})).toEqual(['/w/a.ts'])
  expect(body.log.some(x => x.who === LANGUAGES.en!.gateLog.who)).toBe(true)
  expect(body.gate).toMatchObject({ ok: expect.any(Boolean), isSent: expect.any(Boolean) })
})

test('a full session stays under the size the server takes', () => {
  const text = 'x'.repeat(300)
  const snap = toSnapshot({
    session: { id: 's', cwd: '/w' },
    now: 1,
    main: { model: 'm', effort: '' },
    usage: { startedAt: 0, context: { window: 100 }, cost: { usd: 0 }, rateLimits: [] },
    ins: shapeInsights({}),
    turnRing: Array.from({ length: 50 }, (_, i) => ({ startedAt: i, wallMs: 1, buckets: { model: 1 }, prompt: text.slice(0, 120) })),
    doing: [],
    calls: Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, at: i, who: 'general-purpose', view: 'shell' as const, what: text, result: 'failed', error: 'e'.repeat(2000), agentId: 'a' })),
    agents: Array.from({ length: 60 }, (_, i) => ({ id: `a${i}`, type: 'general-purpose', model: 'm', effort: 'high', task: text.slice(0, 100), status: 'done' as const, files: 1, tools: 1, input: 1, output: 1, startedAt: 0, callId: 'toolu_01234567890123456789', prompt: 'p'.repeat(500), usd: 1, cached: 1, errors: 1 })),
    checks: [],
    files: { read: [], edited: [], editedAt: 0 },
    log: Array.from({ length: 50 }, (_, i) => ({ at: i, who: 'general-purpose', what: text, result: 'done', agentId: 'a' })),
    tasks: [],
    streak: 0,
    dismissed: [],
    learned: { current: '', sessions: [], mem: [], bench: [] },
    focus: [],
    t: LANGUAGES.en!,
    lang: 'en',
    isPaneOpen: true,
    build: 'x',
    testReview: { files: [], dropped: [], isGreen: false },
    trace: Array.from({ length: 500 }, (_, i) => ({ id: `toolu_${i}`, at: i, who: 'general-purpose', tool: 'Bash', what: text, ms: 1, isFailed: true, error: text, agentId: 'agent-1234' })),
  })
  expect(JSON.stringify(snap).length).toBeLessThan(1024 * 1024)
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
    isPaneOpen: true,
    build: '1.2.3 · abc1234',
    testReview: { files: [], dropped: [], isGreen: false },
    trace: [],
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
  const first = onlyPosts(sent)[0]!
  expect(first.url).toBe('http://127.0.0.1:47311/state/sess-1')
  expect(first.type).toBe('application/json')
  const body = JSON.parse(first.body!) as WebSnapshot
  expect(body.session.branch).toBe('main')
  await clock.advance(5000)
  await clock.settle()
  expect(onlyPosts(sent).length).toBe(1)
})

test('the page closes the pane, a new start keeps it closed, and /agentmon shows it again', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  const before = panesOpened
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  let pending = true
  on('http.fetch', (_, e) => {
    const isAsked = e.url.includes('/pane/') && pending
    if (isAsked) pending = false
    return { value: isAsked ? { status: 200, ok: true, headers: {}, text: '{"isOpen":false}' } : { status: 204, ok: true, headers: {}, text: '' } }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(panesOpened - before).toBe(1)
  await clock.advance(600)
  await clock.settle()
  expect(closed).toEqual(['agentmon-live'])
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(panesOpened - before).toBe(1)
  await $.command.run({ command: 'agentmon', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(panesOpened - before).toBe(2)
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
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  await clock.settle()
  expect(onlyPosts(sent).length).toBe(0)
  expect(toasts).toEqual([LANGUAGES.en!.web.failed])
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

test('a first start that fails keeps trying, and posts once the server is up', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  let isUp = false
  const argvs = engine(on, () => {
    if (!isUp) throw new Error('ensure timed out')
    return { exitCode: 0, stdout: '{"port":47311}\n', stderr: '' }
  })
  const sent = posts(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)
  await clock.settle()
  const ensures = () => argvs.filter(a => a.includes('ensure')).length
  expect(ensures()).toBe(1)
  expect(sent.length).toBe(0)
  isUp = true
  await clock.advance(61_000)
  await clock.settle()
  expect(ensures()).toBe(2)
  await clock.advance(600)
  await clock.settle()
  expect(sent.length).toBeGreaterThan(0)
})

test('a slow first start runs one ensure, not one per loop tick', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  let release: () => void = () => undefined
  const gate = new Promise<void>(done => { release = done })
  const argvs = engine(on, () => gate.then(() => ({ exitCode: 0, stdout: '{"port":47311}\n', stderr: '' })))
  const sent = posts(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ensures = () => argvs.filter(a => a.includes('ensure')).length
  expect(ensures()).toBe(1)
  release()
  await clock.settle()
  await clock.advance(600)
  await clock.settle()
  expect(ensures()).toBe(1)
  expect(sent.length).toBeGreaterThan(0)
})

test('a tab asked for at start opens when a failed start recovers', async ($, on) => {
  withOptions(on, { webOpenOnStart: true })
  const clock = mock.clock(on)
  let isUp = false
  const argvs = engine(on, () => {
    if (!isUp) throw new Error('ensure timed out')
    return { exitCode: 0, stdout: '{"port":47311}\n', stderr: '' }
  })
  posts(on)
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const opens = () => argvs.filter(a => a.includes('open')).length
  expect(opens()).toBe(0)
  isUp = true
  await clock.advance(61_000)
  await clock.settle()
  expect(opens()).toBe(1)
})

test('a live turn posts for its clock every few seconds, and at once for anything else', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  const sent = posts(on)
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'work', turnId: 'm1' } as never)
  await clock.advance(600)
  await clock.settle()
  const before = onlyPosts(sent).length
  // Every tick would be 18 posts.
  await clock.advance(9000)
  await clock.settle()
  const clockPosts = onlyPosts(sent).length - before
  expect(clockPosts).toBeGreaterThan(1)
  expect(clockPosts).toBeLessThan(5)
  const atTool = onlyPosts(sent).length
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  await clock.advance(600)
  await clock.settle()
  expect(onlyPosts(sent).length).toBeGreaterThan(atTool)
})

test('the clock alone is no change; anything else is', () => {
  const snap = { now: 5, usage: { usd: 1 }, turns: [{ startedAt: 1, wallMs: 9, buckets: { model: 9 }, isLive: true, prompt: 'p' }] } as unknown as WebSnapshot
  const later = { ...snap, now: 6, turns: [{ startedAt: 1, wallMs: 10, buckets: { model: 10 }, isLive: true, prompt: 'p' }] } as unknown as WebSnapshot
  expect(changeKey(later)).toBe(changeKey(snap))
  expect(changeKey({ ...later, usage: { usd: 2 } } as unknown as WebSnapshot)).not.toBe(changeKey(snap))
  expect(changeKey({ ...later, turns: [] })).not.toBe(changeKey(snap))
})

test('with no tab open a session posts only its heartbeat, keeps its turns, and catches up when a tab opens', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  let clients = '0'
  let states = 0
  let last = ''
  on('http.fetch', (_, e) => {
    if (e.url.includes('/state/') && e.init?.method === 'POST') {
      states += 1
      last = e.init.body as string
    }
    return { value: { status: 204, ok: true, headers: { 'x-clients': clients }, text: '' } }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  await clock.settle()
  expect(states).toBe(1)
  await $.turn.start({ text: 'work', turnId: 'm1' } as never)
  await clock.advance(1000)
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'm1', reason: 'answer' } as never)
  await clock.advance(1000)
  await clock.settle()
  expect(states).toBe(1)
  clients = '1'
  // With no tab the loop looks every 5 s.
  await clock.advance(5100)
  await clock.settle()
  expect(states).toBe(2)
  expect((JSON.parse(last) as WebSnapshot).turns).toHaveLength(1)
})

test('a waiting subagent is urgent on the page, as in the pane', () => {
  const t = LANGUAGES.en!
  const items = urgentItems({ t, doing: [], streak: 0, checks: [], main: {}, dismissed: [], agents: [{ id: 'g', type: 'tester', task: 'run', status: 'waiting' }, { id: 'h', type: 'x', task: 'y', status: 'running' }] } as never)
  expect(items.map(x => x.key)).toEqual(['ask:agent:g'])
  expect(items[0]!.isUrgent).toBe(true)
})

test('/agentmon open says the web view waits for the next session when turned on after the start', async ($, on) => {
  const options: Record<string, unknown> = { web: 'off' }
  withOptions(on, options)
  engine(on)
  posts(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const run = () => $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 }, command: 'agentmon', args: 'open' } as never)
  expect(String((await run()).text)).toBe(LANGUAGES.en!.web.off)
  options.web = 'on'
  await $.turn.start({ text: 'work', turnId: 'm1' } as never)
  expect(String((await run()).text)).toBe(LANGUAGES.en!.web.nextSession)
})

test('a server that does not know the session gets it at once, not at the next heartbeat', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  let isForgotten = false
  let states = 0
  on('http.fetch', (_, e) => {
    if (e.url.includes('/state/')) states += 1
    if (e.url.includes('/pane/') && isForgotten) {
      isForgotten = false
      return { value: { status: 404, ok: false, headers: {}, text: '' } }
    }
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  await clock.settle()
  const before = states
  await clock.advance(1500)
  await clock.settle()
  expect(states).toBe(before)
  isForgotten = true
  await clock.advance(1500)
  await clock.settle()
  expect(states).toBe(before + 1)
})

test('a pane that is open but not placed counts as not shown, as in the terminal band', async ($, on) => {
  withOptions(on, {})
  const clock = mock.clock(on)
  engine(on)
  const sent = posts(on)
  on('ui.panes', () => ({ value: [{ id: PANE, isPlaced: false }] as never }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  await clock.settle()
  expect(lastSnapshot(sent).isPaneOpen).toBe(false)
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

test('the run\'s key goes with every post, a server without the mark gets no snapshot, and the browser opens an address with a one-time code', async ($, on) => {
  const [key, mark, code] = ['ab'.repeat(32), 'cd'.repeat(32), 'ef'.repeat(16)]
  withOptions(on, { webToken: 'off' })
  const clock = mock.clock(on)
  const argvs = engine(on, () => ({ exitCode: 0, stdout: `{"port":47311,"key":"${key}","mark":"${mark}"}\n`, stderr: '' }))
  let isOurs = true
  const asked: { url: string; headers: Record<string, string> }[] = []
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('http.fetch', (_, e) => {
    asked.push({ url: e.url, headers: (e.init?.headers ?? {}) as Record<string, string> })
    const headers = { 'x-clients': '1', ...(isOurs ? { 'x-agentmon-mark': mark } : {}) }
    return { value: e.url.endsWith('/ticket') ? { status: 200, ok: true, headers, text: JSON.stringify({ code }) } : { status: 204, ok: true, headers, text: '' } }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  await clock.settle()
  expect(argvs.find(a => a.includes('ensure'))?.at(-1)).toBe('--open')
  expect(asked.some(a => a.url.includes('/state/'))).toBe(true)
  expect(asked.every(a => a.headers['x-agentmon-key'] === key)).toBe(true)
  const r = await $.command.run({ command: 'agentmon', args: 'open', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(argvs.find(a => a.includes('open'))?.at(-1)).toBe(`http://127.0.0.1:47311/?c=${code}`)
  expect(String(r.text)).not.toContain(code)
  // Another program on the port: it answers, but not with the mark.
  isOurs = false
  const before = asked.filter(a => a.url.includes('/state/')).length
  await $.turn.start({ text: 'work', turnId: 'm1' } as never)
  await clock.advance(2000)
  await clock.settle()
  expect(asked.filter(a => a.url.includes('/state/')).length).toBe(before)
})

test('with a snapshot folder the session writes there, starts no server, and marks its file ended', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'AGENTMON_SPOOL' ? '/spool' : undefined }))
  on('fs.read', (_, e, next) => (e.path.endsWith('/settings.json') ? { value: settingsWith({}) } : next(e)))
  const clock = mock.clock(on)
  const argvs = engine(on)
  const sent = posts(on)
  const written: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    if (e.path.startsWith('/spool/')) written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as never)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  await clock.settle()
  expect(written[0]?.path).toBe('/spool/sess-1.json')
  expect((JSON.parse(written[0]!.text) as WebSnapshot).session.id).toBe('sess-1')
  expect(argvs.some(a => a.includes('ensure'))).toBe(false)
  expect(sent.length).toBe(0)
  await $.session.end({ reason: 'other', sessionId: 'sess-1', resume: { sessionId: 'sess-1' } } as never)
  expect(written.at(-1)).toEqual({ path: '/spool/sess-1.json', text: '{"ended":true}' })
})
