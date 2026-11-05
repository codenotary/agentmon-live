import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { elapsedOf, endOf, groupLines, linesOf, medianOf, pipsOf, sortLines, totalsOf } from '../../web/src/agents.ts'
import { alertOf, nextEvents, splitEvents } from '../../web/src/events.ts'
import { agentNames, countWord, parseIds, pushPoint, resultOf, rowUsd, sessionNames, stateOf, tailOf, titleFor, whoOf } from '../../web/src/format.ts'
import { PAGE_EN, pageOf } from '../../web/src/labels.ts'
import { clampView, DEFAULT_VIEW, edgeOf, flowOf, mergeDots, wholeOf, windowOf } from '../../web/src/flow.ts'
import { rowsOf, spanOf, tableRows, ticksOf, xOf } from '../../web/src/waterfall.ts'
import { BUILT, builtHash, sourceHash } from '../../web/source-hash.mjs'

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

test('kept section ids survive whatever the browser holds', () => {
  assert.deepEqual(parseIds('["log","files"]'), ['log', 'files'])
  assert.deepEqual(parseIds(null), [])
  assert.deepEqual(parseIds('not json'), [])
  assert.deepEqual(parseIds('{"a":1}'), [])
  assert.deepEqual(parseIds('["log",1,null]'), ['log'])
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

test('the axis takes round steps, and at most five ticks', () => {
  assert.deepEqual(ticksOf(4500), { step: 1000, at: [0, 1000, 2000, 3000, 4000] })
  assert.deepEqual(ticksOf(31_000).step, 10_000)
  assert.deepEqual(ticksOf(900).at, [0, 200, 400, 600, 800])
  assert.deepEqual(ticksOf(0).at, [])
  for (const ms of [1, 999, 61_000, 5_000_000, 90_000_000]) assert.ok(ticksOf(ms).at.length <= 5, String(ms))
})

const agent = (id, more = {}) => ({ id, type: 't', task: id, model: 'm', effort: '', status: 'done', files: 0, tools: 1, input: 100, output: 0, startedAt: 0, endedAt: 100, ...more })

test('the dots rate an agent against the session', () => {
  const median = { ms: 100, tokens: 100 }
  const pips = more => pipsOf(agent('a', more), median, 1000, false)
  assert.equal(pips({ endedAt: 100 }).duration, 0)
  assert.equal(pips({ endedAt: 150 }).duration, 0)
  assert.equal(pips({ endedAt: 151 }).duration, 1)
  assert.equal(pips({ endedAt: 301 }).duration, 2)
  assert.equal(pips({ input: 151 }).tokens, 1)
  assert.equal(pips({ input: 301 }).tokens, 2)
  assert.equal(pipsOf(agent('a', { input: 1_000_001 }), { ms: 0, tokens: 2_000_000 }, 1000, false).tokens, 2)
  assert.equal(pips({ errors: 0 }).errors, 0)
  assert.equal(pips({ errors: 1 }).errors, 1)
  assert.equal(pips({ errors: 2 }).errors, 2)
  assert.equal(pipsOf(agent('a'), median, 1000, true).errors, 2)
  assert.equal(pipsOf(agent('a', { status: 'running', endedAt: undefined }), { ms: 0, tokens: 0 }, 300_001, false).duration, 2)
  assert.equal(medianOf([]), 0)
  assert.equal(medianOf([1, 3, 2]), 2)
  assert.equal(medianOf([1, 2]), 1.5)
})

test('an agent the engine dropped stops counting, everywhere it is drawn', () => {
  const dropped = agent('gone', { status: 'cancelled', startedAt: 10, endedAt: undefined, lastAt: 40 })
  assert.equal(endOf(dropped, 1000), 40)
  assert.equal(elapsedOf(dropped, 1000), 30)
  assert.equal(elapsedOf({ ...dropped, lastAt: undefined }, 1000), 0)
  assert.equal(endOf(agent('live', { status: 'running', startedAt: 10, endedAt: undefined }), 1000), 1000)
  assert.equal(endOf(agent('done', { status: 'done', startedAt: 10, endedAt: 20 }), 1000), 20)
  assert.equal(flowOf(flowInput({ agents: [dropped] }), MAIN, 1000, OPEN).lanes[1].to, 40)
  const [head] = rowsOf({ ...empty, agents: [dropped] }, { from: 0, to: 1000 }, MAIN, 1000)
  assert.deepEqual([head.to, head.ms, head.state], [40, 30, 'ok'])
})

test('a last call that failed counts against the agent', () => {
  const lines = linesOf([agent('a'), agent('b')], [call('1', 't', 1, { agentId: 'a', isFailed: true }), call('2', 't', 2, { agentId: 'b', isFailed: true }), call('3', 't', 3, { agentId: 'b' })], 200)
  assert.deepEqual(lines.map(l => l.pips.errors), [2, 0])
})

test('running agents lead, then the worst, until a column is picked', () => {
  const lines = linesOf([agent('fine', { startedAt: 1 }), agent('bad', { errors: 2, startedAt: 2 }), agent('live', { status: 'running', endedAt: undefined, startedAt: 3, tools: 9 })], [], 100)
  assert.deepEqual(sortLines(lines, null, 100).map(l => l.a.id), ['live', 'bad', 'fine'])
  assert.deepEqual(sortLines(lines, { key: 'calls', isDesc: false }, 100).map(l => l.a.id), ['fine', 'bad', 'live'])
  assert.deepEqual(sortLines(lines, { key: 'health', isDesc: true }, 100).map(l => l.a.id), ['bad', 'fine', 'live'])
})

test('more than eight with one prefix fold into a row, eight stay apart', () => {
  const many = n => Array.from({ length: n }, (_, i) => agent(`a${i}`, { task: `Review: f${i}`, tools: 2, errors: i === 0 ? 2 : 0 }))
  const other = agent('x', { task: 'Other' })
  assert.deepEqual(groupLines(linesOf([...many(8), other], [], 200), 200).map(i => i.kind), Array(9).fill('agent'))
  const items = groupLines(linesOf([other, ...many(9)], [], 200), 200)
  assert.deepEqual(items.map(i => i.kind), ['agent', 'group'])
  assert.equal(items[1].prefix, 'Review: ')
  assert.equal(items[1].lines.length, 9)
  assert.equal(items[1].calls, 18)
  assert.equal(items[1].errors, 2)
  assert.equal(items[1].pips.errors, 2)
})

test('the totals count what the table shows', () => {
  const totals = totalsOf([agent('a', { usd: 0.5, output: 10 }), agent('b', { status: 'running' }), agent('c', { status: 'error' }), agent('d', { tests: 'FAIL' })])
  assert.deepEqual(totals, { count: 4, running: 1, failed: 2, tokens: 410, usd: 0.5 })
})

const flowInput = (more = {}) => ({ trace: [], agents: [], active: [], turns: [], checks: [], ...more })
const OPEN = { openGroups: new Set(), hideFinished: false }

test('the flow draws a lane per agent, arcs each way, and calls on their own lane', () => {
  const agents = [agent('a', { startedAt: 20, endedAt: 60, callId: 'spawn' }), agent('b', { startedAt: 30, endedAt: undefined, status: 'running' })]
  const trace = [call('spawn', MAIN, 10, { tool: 'Agent' }), call('x', 't', 25, { agentId: 'a', tool: 'Bash', ms: 1 }), call('y', 't', 50, { agentId: 'a', tool: 'Read', ms: 1 }), call('z', 't', 35, { agentId: 'b' })]
  const { lanes, dots, arcs } = flowOf(flowInput({ agents, trace, active: [{ id: 'z', isAsking: true }] }), MAIN, 100, OPEN)
  assert.deepEqual(lanes.map(l => l.id), ['main', 'a', 'b'])
  assert.deepEqual(dots.map(d => [d.key, d.lane, d.state, d.isBig]), [['spawn', 'main', 'ok', false], ['x', 'a', 'ok', true], ['y', 'a', 'ok', false], ['z', 'b', 'asking', true]])
  const of = key => arcs.find(a => a.key === key)
  assert.deepEqual([of('spawn:a').fromAt, of('spawn:a').toAt, of('spawn:a').toLane], [10, 25, 'a'])
  assert.deepEqual([of('back:a').fromAt, of('back:a').toAt, of('back:a').toLane], [50, 60, 'main'])
  assert.equal(of('back:b'), undefined)
  assert.deepEqual([of('ask:z').fromLane, of('ask:z').toLane], ['b', 'main'])
})

test('lanes sharing a prefix fold past eight and open on request; finished lanes can hide', () => {
  const agents = Array.from({ length: 9 }, (_, i) => agent(`a${i}`, { task: `Review: f${i}`, startedAt: i, endedAt: i === 8 ? undefined : 50 + i, status: i === 8 ? 'running' : 'done' }))
  const trace = [call('x', 't', 5, { agentId: 'a1' })]
  const folded = flowOf(flowInput({ agents, trace }), MAIN, 100, OPEN)
  assert.deepEqual(folded.lanes.map(l => l.id), ['main', 'group:Review: '])
  assert.equal(folded.lanes[1].isRunning, true)
  assert.equal(folded.dots[0].lane, 'group:Review: ')
  assert.equal(folded.arcs.filter(a => a.kind === 'spawn').length, 1)
  assert.equal(folded.arcs.filter(a => a.kind === 'handback').length, 1)
  assert.equal(flowOf(flowInput({ agents }), MAIN, 100, { ...OPEN, openGroups: new Set(['Review: ']) }).lanes.length, 10)
  const live = flowOf(flowInput({ agents, trace }), MAIN, 100, { ...OPEN, hideFinished: true })
  assert.deepEqual(live.lanes.map(l => l.id), ['main', 'a8'])
  assert.deepEqual(live.dots, [])
})

test('dots closer than four pixels merge into one mark, and the worst state shows', () => {
  const dot = (key, at, state = 'ok') => ({ key, lane: 'a', at, state, isBig: false, call: {} })
  const marks = mergeDots([dot('1', 0), dot('2', 3, 'failed'), dot('3', 100), dot('out', 2000)], { from: 0, to: 1000 }, 1000)
  assert.deepEqual(marks.map(m => [m.key, m.count, m.state]), [['1', 2, 'failed'], ['3', 1, 'ok']])
})

test('the window opens on the last activity, follows when live, and stays inside the session', () => {
  const d = flowInput({ trace: [call('x', MAIN, 1000, { ms: 500 })] })
  assert.equal(edgeOf(d, 900_000, false), 1500)
  assert.equal(edgeOf(d, 900_000, true), 900_000)
  assert.equal(edgeOf(flowInput(), 900_000, false), 900_000)
  assert.deepEqual(windowOf(DEFAULT_VIEW, d, 900_000, true), { from: 780_000, to: 900_000 })
  assert.deepEqual(windowOf({ ms: 100, at: 500 }, d, 900_000, true), { from: 400, to: 500 })
  const whole = wholeOf(d, 900_000)
  assert.equal(whole.from, 1000)
  assert.deepEqual(clampView({ ms: 1, at: null }, whole), { ms: 5000, at: null })
  assert.deepEqual(clampView({ ms: 10_000, at: 0 }, whole), { ms: 10_000, at: 11_000 })
  assert.deepEqual(clampView({ ms: 10_000, at: 2_000_000 }, whole), { ms: 10_000, at: 900_000 })
  assert.equal(clampView({ ms: 5_000_000, at: null }, whole).ms, 899_000)
})

test('what needs you comes first, the rest in time order; a wait is amber, a failure red', () => {
  const ev = (key, at, more = {}) => ({ key, tag: 't', text: key, isUrgent: false, at, ...more })
  const list = [ev('ask:1', 10, { isUrgent: true }), ev('warn', 20), ev('old', 30, { isUrgent: true, clearedAt: 40 })]
  const { attention, rest } = splitEvents(list)
  assert.deepEqual(attention.map(e => e.key), ['ask:1'])
  assert.deepEqual(rest.map(e => e.key), ['old', 'warn'])
  assert.equal(alertOf([ev('ask:1', 1, { isUrgent: true })]), 'warn')
  assert.equal(alertOf([ev('ask:1', 1, { isUrgent: true }), ev('check:x', 1, { isUrgent: true })]), 'bad')
  assert.equal(alertOf([ev('note', 1)]), undefined)
  assert.ok(titleFor([{ key: 'ask:1', tag: 'approval', text: 'x', isUrgent: true }]).startsWith('⏸'))
  assert.ok(titleFor([{ key: 'check:x', tag: 'failed', text: 'x', isUrgent: true }]).startsWith('✖'))
})

test('the calls table lists every tool, so an agent that only read still has rows', () => {
  const trace = [
    call('r', 't', 1, { tool: 'Read', ms: 5, agentId: 'a' }),
    call('e', 't', 2, { tool: 'Edit', ms: 5, isFailed: true, error: 'short', agentId: 'a' }),
    call('live', MAIN, 3),
    call('lost', MAIN, 4),
  ]
  const rows = tableRows({ trace, calls: [{ id: 'e', at: 2, who: 't', view: 'shell', what: 'x', result: 'failed', error: 'the longer text' }], active: [{ id: 'live' }] })
  assert.deepEqual(rows.map(r => [r.id, r.view, r.result]), [['r', 'Read', 'ok'], ['e', 'Edit', 'failed'], ['live', 'Bash', 'running'], ['lost', 'Bash', 'unknown']])
  assert.equal(rows[0].agentId, 'a')
  assert.equal(rows[0].ms, 5)
  assert.equal(rows[1].error, 'the longer text')
  const old = [{ id: 'g', at: 1, who: MAIN, view: 'git', what: 'git status', result: 'ok' }]
  assert.deepEqual(tableRows({ calls: old, active: [] }), old)
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

test('the built files are the set one build made', () => {
  const stamp = /<meta name="agentmon-built" content="([0-9a-f]{64})">/.exec(page)?.[1]
  assert.equal(stamp, builtHash(), 'run: cd web && npm run build')
})

test('the page loads nothing from another origin and stays small', () => {
  for (const file of ['app.html', 'app.js', 'vendor.js']) assert.doesNotMatch(readFileSync(join(ROOT, 'server', file), 'utf8'), /<(script|link|img)\b[^>]*\b(src|href)="(https?:)?\/\/|@import\s+url\(/, file)
  assert.doesNotMatch(readFileSync(join(ROOT, 'server/app.css'), 'utf8'), /@import\s+url\(|url\((https?:)?\/\//)
  for (const file of BUILT) assert.ok(page.includes(`"/${file}"`), file)
  const total = ['app.html', 'app.js', 'vendor.js', 'app.css'].reduce((n, f) => n + statSync(join(ROOT, 'server', f)).size, 0)
  assert.ok(total < 800 * 1024, `${total} bytes`)
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
  assert.equal(at({}, [], [{ status: 'running' }]), 'active')
})
