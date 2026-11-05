import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { nextEvents } from '../../web/src/events.ts'
import { agentNames, countWord, pushPoint, resultOf, rowUsd, sessionNames, stateOf, tailOf, titleFor, whoOf } from '../../web/src/format.ts'
import { PAGE_EN, pageOf } from '../../web/src/labels.ts'
import { rowsOf, spanOf, xOf } from '../../web/src/waterfall.ts'
import { sourceHash } from '../../web/source-hash.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const page = readFileSync(join(ROOT, 'server/app.html'), 'utf8')
const fixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/snapshot.json'), 'utf8'))
const empty = { trace: [], agents: [], active: [] }
const MAIN = 'Hauptsitzung'
const call = (id, who, at, more = {}) => ({ id, at, who, tool: 'Bash', what: id, ...more })

test('a turn with no calls draws no rows, and a live one ends now', () => {
  assert.deepEqual(rowsOf(empty, { from: 0, to: 10 }, MAIN, 10), [])
  assert.deepEqual(spanOf({ startedAt: 100, wallMs: 1, buckets: {}, isLive: true }, 700), { from: 100, to: 700 })
  assert.deepEqual(spanOf({ startedAt: 100, wallMs: 50, buckets: {} }, 700), { from: 100, to: 150 })
})

test('only the turn\'s calls show, in order, and the slowest is marked', () => {
  const trace = [call('before', MAIN, 5, { ms: 1 }), call('b', MAIN, 30, { ms: 50 }), call('a', MAIN, 20, { ms: 5 }), call('after', MAIN, 200, { ms: 1 })]
  const rows = rowsOf({ ...empty, trace: trace.toSorted((x, y) => y.at - x.at) }, { from: 10, to: 100 }, MAIN, 100)
  assert.deepEqual(rows.map(r => [r.key, r.depth, r.isSlowest]), [['a', 0, false], ['b', 0, true]])
})

test('a subagent\'s calls nest under it, in any language, and its starting call is not drawn twice', () => {
  const agents = [{ id: 'g', type: 'tester', task: 'run', status: 'done', startedAt: 20, endedAt: 60 }]
  const trace = [call('start', MAIN, 20, { tool: 'Agent', ms: 40 }), call('in', 'tester', 30, { ms: 5 }), call('late', MAIN, 70, { ms: 1 })]
  const rows = rowsOf({ ...empty, agents, trace }, { from: 0, to: 100 }, MAIN, 100)
  assert.deepEqual(rows.map(r => [r.key, r.depth]), [['agent:g', 0], ['in', 1], ['late', 0]])
  assert.equal(rows[0].isAgent, true)
  assert.equal(rows[0].ms, 40)
})

test('two subagents of one type keep their own calls', () => {
  const agents = [{ id: 'g1', type: 't', task: 'a', status: 'done', startedAt: 0, endedAt: 10 }, { id: 'g2', type: 't', task: 'b', status: 'done', startedAt: 20, endedAt: 30 }]
  const rows = rowsOf({ ...empty, agents, trace: [call('x', 't', 5, { ms: 1 }), call('y', 't', 25, { ms: 1 })] }, { from: 0, to: 40 }, MAIN, 40)
  assert.deepEqual(rows.map(r => r.key), ['agent:g1', 'x', 'agent:g2', 'y'])
})

test('parallel subagents of one type keep their own calls, by id', () => {
  const agents = [{ id: 'g1', type: 't', task: 'a', status: 'running', startedAt: 0 }, { id: 'g2', type: 't', task: 'b', status: 'running', startedAt: 1 }]
  const trace = [call('x', 't', 5, { ms: 1, agentId: 'g1' }), call('y', 't', 6, { ms: 1, agentId: 'g2' })]
  const rows = rowsOf({ ...empty, agents, trace }, { from: 0, to: 40 }, MAIN, 40)
  assert.deepEqual(rows.map(r => r.key), ['agent:g1', 'x', 'agent:g2', 'y'])
  assert.deepEqual(rows.filter(r => r.isAgent).map(r => [r.name, r.what]), [['a', 't'], ['b', 't']])
})

test('a subagent goes by its description; a shared prefix drops, a long name keeps its end', () => {
  const names = agentNames([
    { id: 'a', type: 'general-purpose', task: 'Refactor review: policy.go' },
    { id: 'b', type: 'general-purpose', task: 'Refactor review: cmd/server/internal/handlers/main.go' },
    { id: 'c', type: 'general-purpose', task: 'Docs: only one here' },
    { id: 'd', type: 'Explore', task: '' },
  ])
  assert.equal(names.get('a').short, 'policy.go')
  assert.equal(names.get('a').full, 'Refactor review: policy.go')
  assert.equal(names.get('b').short, tailOf('cmd/server/internal/handlers/main.go'))
  assert.ok(names.get('b').short.startsWith('…') && names.get('b').short.endsWith('main.go'))
  assert.equal(names.get('b').short.length, 32)
  assert.equal(names.get('c').short, 'Docs: only one here')
  assert.equal(names.get('d').short, 'Explore')
  assert.equal(whoOf({ who: 'general-purpose', agentId: 'a' }, names), 'policy.go')
  assert.equal(whoOf({ who: 'general-purpose', agentId: 'gone' }, names), 'general-purpose')
  assert.equal(whoOf({ who: 'main session' }, names), 'main session')
})

test('one word for one call', () => {
  assert.equal(countWord(1, PAGE_EN), '1 Call')
  assert.equal(countWord(2, PAGE_EN), '2 Calls')
})

test('the session under way costs what the header says; a past row prefers the whole session', () => {
  const s = { session: { id: 'now' }, usage: { usd: 4.75 } }
  assert.equal(rowUsd({ id: 'now', usd: 0.59, totalUsd: 4 }, s), 4.75)
  assert.equal(rowUsd({ id: 'old', usd: 0.59, totalUsd: 4 }, s), 4)
  assert.equal(rowUsd({ id: 'old', usd: 0.59 }, s), 0.59)
  assert.equal(rowUsd({ id: 'old' }, s), undefined)
})

test('states: a running call reaches now, an approval shows, a failure shows, a lost call stays still', () => {
  const trace = [call('run', MAIN, 10), call('ask', MAIN, 20), call('bad', MAIN, 30, { ms: 1, isFailed: true }), call('lost', MAIN, 40)]
  const active = [{ id: 'run', who: MAIN, tool: 'Bash', what: '', startedAt: 10 }, { id: 'ask', who: MAIN, tool: 'Bash', what: '', startedAt: 20, isAsking: true }]
  const rows = rowsOf({ ...empty, trace, active }, { from: 0, to: 100 }, MAIN, 100)
  assert.deepEqual(rows.map(r => [r.key, r.state, r.to]), [['run', 'running', 100], ['ask', 'asking', 100], ['bad', 'failed', 31], ['lost', 'ok', 40]])
})

test('an event stays when it leaves Focus, cleared once, and comes back open', () => {
  const a = { key: 'a', tag: 't', text: 'x', isUrgent: true }
  const b = { key: 'b', tag: 't', text: 'y', isUrgent: false }
  const first = nextEvents([], [a], 100, 10)
  assert.deepEqual(first, [{ ...a, at: 100 }])
  const second = nextEvents(first, [b], 200, 10)
  assert.deepEqual(second.map(e => [e.key, e.clearedAt]), [['b', undefined], ['a', 200]])
  assert.equal(nextEvents(second, [b], 300, 10)[1].clearedAt, 200)
  const back = nextEvents(second, [a, b], 400, 10)
  assert.equal(back.find(e => e.key === 'a').clearedAt, undefined)
  assert.equal(back.find(e => e.key === 'a').at, 100)
})

test('the cap drops old cleared events before an open one', () => {
  const old = { key: 'old', tag: 't', text: 'x', isUrgent: true }
  const list = [{ ...old, at: 1 }, { key: 'c', tag: 't', text: 'y', isUrgent: false, at: 50, clearedAt: 60 }]
  assert.deepEqual(nextEvents(list, [old], 100, 1).map(e => e.key), ['old'])
})

test('positions stay on the track', () => {
  assert.equal(xOf(-5, 0, 100), 0)
  assert.equal(xOf(500, 0, 100), 100)
  assert.equal(xOf(1, 1, 1), 0)
})

test('history skips repeats and keeps to its cap', () => {
  assert.deepEqual(pushPoint([1, 2], 2, 3), [1, 2])
  assert.deepEqual(pushPoint([1, 2, 3], 4, 3), [2, 3, 4])
})

test('a session of an older version gets English for the labels it lacks', () => {
  const p = pageOf({ labels: { page: { events: 'Ereignisse' } } })
  assert.equal(p.events, 'Ereignisse')
  assert.equal(p.waterfall, PAGE_EN.waterfall)
  assert.equal(pageOf(undefined).noSessions, PAGE_EN.noSessions)
})

test('the page\'s English fallback is the English the mod sends', () => {
  assert.deepEqual(PAGE_EN, fixture.labels.page)
})

test('result words map in either language, unknown words pass through', () => {
  const l = { result: { ok: 'ok', failed: 'fehlgeschlagen' } }
  assert.deepEqual(resultOf('failed', l), { text: 'fehlgeschlagen', tone: 'bad' })
  assert.deepEqual(resultOf('fehlgeschlagen', l), { text: 'fehlgeschlagen', tone: 'bad' })
  assert.deepEqual(resultOf('weird', l), { text: 'weird', tone: '' })
})

test('only urgent items set the tab title, shortened', () => {
  assert.equal(titleFor([{ tag: 'context', text: 'x', isUrgent: false }]), 'AgentMon Live')
  assert.equal(titleFor([{ tag: 'failed', text: 'tests', isUrgent: true }]), '✖ failed tests · AgentMon')
  assert.ok(titleFor([{ tag: 'failed', text: 'y'.repeat(99), isUrgent: true }]).length < 60)
})

test('the built page is current with its source', () => {
  const stamp = /<meta name="agentmon-source" content="([0-9a-f]{64})">/.exec(page)?.[1]
  assert.equal(stamp, sourceHash(), 'run: cd web && npm run build')
})

test('the page loads nothing from another origin and stays small', () => {
  assert.doesNotMatch(page, /<(script|link|img)\b[^>]*\b(src|href)="(https?:)?\/\//)
  assert.doesNotMatch(page, /@import\s+url\(/)
  assert.ok(statSync(join(ROOT, 'server/app.html')).size < 700 * 1024)
})

test('a session of an older version sends no trace: the waterfall is empty, not a crash', () => {
  const { trace: _, ...old } = empty
  assert.deepEqual(rowsOf(old, { from: 0, to: 10 }, MAIN, 10), [])
})

test('the session switch names sessions by folder and branch, and tells two in one place apart by id', () => {
  const at = (cwd, branch) => ({ session: { cwd, branch } })
  const names = sessionNames(new Map([['aaaaaaaa1', at('/w/a', 'main')], ['bbbbbbbb2', at('/w/a', 'main')], ['c', at('/w/c')]]))
  assert.equal(names.get('aaaaaaaa1'), '/w/a · main · aaaaaa')
  assert.equal(names.get('bbbbbbbb2'), '/w/a · main · bbbbbb')
  assert.equal(names.get('c'), '/w/c')
})

test('a session is idle, active, or waiting for you, and waiting wins', () => {
  const at = (main, active, agents) => stateOf({ main, active, agents })
  assert.equal(at({}, [], []), 'idle')
  assert.equal(at({ turnLive: {} }, [], []), 'active')
  assert.equal(at({}, [{}], []), 'active')
  assert.equal(at({ turnLive: {} }, [{ isAsking: true }], []), 'waiting')
  assert.equal(at({}, [], [{ status: 'waiting' }]), 'waiting')
  assert.equal(at({}, [], [{ status: 'done' }]), 'idle')
})
