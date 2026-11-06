import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { elapsedOf, endOf, groupLines, linesOf, medianOf, pipsOf, sortLines, totalsOf } from '../../web/src/agents.ts'
import { alertOf, nextEvents, splitEvents } from '../../web/src/events.ts'
import { agentNames, blockedOf, callTime, countWord, editsSinceGreen, firstLine, nextRow, SECTION_KEYS, withPrompts, parseIds, pushPoint, resultOf, sessionNames, stateOf, tailOf, titleFor, whoOf } from '../../web/src/format.ts'
import { fileGroups } from '../../web/src/files.ts'
import { chipCounts, logRows, matchesChip, stripOf } from '../../web/src/logrows.ts'
import { bandTone, fill, GUIDE, isAheadOfPace, paceOf, referenceOf, reversedLevel, typicalOf } from '../../web/src/kpi.ts'
import { PAGE_EN, pageOf } from '../../web/src/labels.ts'
import { clampView, DEFAULT_VIEW, dragMode, edgeOf, flowOf, mergeDots, wholeOf, windowOf } from '../../web/src/flow.ts'
import { rowsOf, sortCalls, tableRows, ticksOf, xOf } from '../../web/src/waterfall.ts'
import { BUILT, builtHash, sourceHash } from '../../web/source-hash.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const page = readFileSync(join(ROOT, 'server/app.html'), 'utf8')
const fixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/snapshot.json'), 'utf8'))
const empty = { trace: [], agents: [], active: [] }
const MAIN = 'Hauptsitzung'
const call = (id, who, at, more = {}) => ({ id, at, who, tool: 'Bash', what: id, ...more })

test('a time with no calls draws no rows', () => {
  assert.deepEqual(rowsOf(empty, { from: 0, to: 10 }, MAIN, 10), [])
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
  const same = agentNames([{ id: '1', type: 't', task: 'Audit: x' }, { id: '2', type: 't', task: 'Audit: x' }, { id: '3', type: 't', task: 'Audit: y' }])
  assert.deepEqual([...same.values()].map(n => n.short), ['x #1', 'x #2', 'y'])
  assert.equal(same.get('2').full, 'Audit: x')
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

test('a call under a second keeps its milliseconds', () => {
  assert.equal(callTime(476), '476 ms')
  assert.equal(callTime(476.4), '476 ms')
  assert.equal(callTime(1500), '2s')
  assert.equal(callTime(61_000), '1m 1s')
  assert.equal(callTime(undefined), '')
})

test('time blocked on you counts the session and the turn under way', () => {
  const turns = [{ wallMs: 100, buckets: { you: 50 }, isLive: true }]
  assert.deepEqual(blockedOf({ insights: { session: { you: 150 }, sessionWall: 300 }, turns }), { ms: 200, pct: 50 })
  assert.deepEqual(blockedOf({ insights: { session: { you: 150 }, sessionWall: 300 }, turns: [{ wallMs: 100, buckets: { you: 50 } }] }), { ms: 150, pct: 50 })
  assert.deepEqual(blockedOf({ insights: {}, turns: [] }), { ms: 0, pct: 0 })
})

test('edits since the last passing test run', () => {
  const files = { editedTimes: { a: 10, b: 30, c: 40 } }
  assert.equal(editsSinceGreen(files, [{ kind: 'test', at: 20, result: 'ok' }]), 2)
  assert.equal(editsSinceGreen(files, [{ kind: 'lint', at: 50, result: 'ok' }, { kind: 'test', at: 50, result: 'ok' }]), 0)
  assert.equal(editsSinceGreen(files, [{ kind: 'test', at: 20, result: 'failed' }]), undefined)
  assert.equal(editsSinceGreen(files, []), undefined)
  assert.equal(editsSinceGreen({}, [{ kind: 'test', at: 20, result: 'ok' }]), 0)
})

test('the log shows each turn\'s prompt, in time order, first line only', () => {
  const log = [{ at: 5, who: 'x', what: 'early', result: 'ok' }, { at: 20, who: 'x', what: 'late', result: 'ok' }]
  const rows = withPrompts(log, [{ startedAt: 10, prompt: 'fix it\nplease' }, { startedAt: 15 }], 'You')
  assert.deepEqual(rows.map(r => r.what), ['early', 'fix it', 'late'])
  assert.equal(rows[1].who, 'You')
  assert.equal(firstLine('a\nb'), 'a')
})

test('j and k stay on the rows; g keys name sections', () => {
  assert.equal(nextRow(-1, 3, 1), 0)
  assert.equal(nextRow(0, 3, 1), 1)
  assert.equal(nextRow(2, 3, 1), 2)
  assert.equal(nextRow(0, 3, -1), 0)
  assert.equal(nextRow(-1, 0, 1), -1)
  assert.equal(SECTION_KEYS.a, 'agents')
})

test('one word for one call', () => {
  assert.equal(countWord(1, PAGE_EN), '1 Call')
  assert.equal(countWord(2, PAGE_EN), '2 Calls')
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
const OPEN = { hideFinished: false }

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

test('every agent has its own lane, however many share a task; finished lanes can hide', () => {
  const agents = Array.from({ length: 10 }, (_, i) => agent(`a${i}`, { task: 'Review the code', startedAt: i, endedAt: i === 9 ? undefined : 50 + i, status: i === 9 ? 'running' : 'done' }))
  const trace = [call('x', 't', 5, { agentId: 'a1' })]
  const { lanes, dots, arcs } = flowOf(flowInput({ agents, trace }), MAIN, 100, OPEN)
  assert.deepEqual(lanes.map(l => l.id), ['main', ...agents.map(a => a.id)])
  assert.equal(new Set(lanes.map(l => l.name)).size, 11)
  assert.equal(lanes[1].name, 'Review the code #1')
  assert.equal(dots[0].lane, 'a1')
  assert.equal(arcs.filter(a => a.kind === 'spawn').length, 10)
  assert.equal(arcs.filter(a => a.kind === 'handback').length, 9)
  const live = flowOf(flowInput({ agents, trace }), MAIN, 100, { hideFinished: true })
  assert.deepEqual(live.lanes.map(l => l.id), ['main', 'a9'])
  assert.deepEqual(live.dots, [])
})

test('a drag on the strip moves, resizes or draws by where it starts; a tiny window only moves', () => {
  assert.equal(dragMode(100, 100, 300, 6), 'left')
  assert.equal(dragMode(299, 100, 300, 6), 'right')
  assert.equal(dragMode(200, 100, 300, 6), 'move')
  assert.equal(dragMode(50, 100, 300, 6), 'new')
  assert.equal(dragMode(101, 100, 104, 6), 'move')
  assert.equal(dragMode(96, 100, 104, 6), 'move')
  assert.equal(dragMode(80, 100, 104, 6), 'new')
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
  assert.equal(clampView({ ms: 120_000, at: null }, { from: 0, to: 30_000 }).ms, 120_000)
  assert.deepEqual(clampView({ ms: 5_000_000, at: 500_000 }, whole), { ms: 899_000, at: 900_000 })
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

test('the calls table sorts numbers as numbers and words as words, and either way round', () => {
  const rows = [{ at: 9, who: 'b', what: 'z', result: 'ok' }, { at: 10, who: 'a', what: 'y', result: 'failed' }]
  const who = c => c.who
  assert.deepEqual(sortCalls(rows, { id: 'at', isDesc: true }, who).map(c => c.at), [10, 9])
  assert.deepEqual(sortCalls(rows, { id: 'at', isDesc: false }, who).map(c => c.at), [9, 10])
  assert.deepEqual(sortCalls(rows, { id: 'what', isDesc: false }, who).map(c => c.what), ['y', 'z'])
  assert.deepEqual(sortCalls(rows, { id: 'who', isDesc: true }, c => c.who.toUpperCase()).map(c => c.who), ['b', 'a'])
  assert.equal(rows[0].at, 9)
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

test('typical needs three earlier live sessions and leaves out this one', () => {
  const row = (id, totalUsd, live = true) => ({ id, totalUsd, live })
  const pick = r => r.totalUsd
  assert.equal(typicalOf([row('a', 1), row('b', 2)], 'now', pick), undefined)
  assert.equal(typicalOf([row('a', 1), row('b', 2), row('now', 3)], 'now', pick), undefined)
  assert.equal(typicalOf([row('a', 1), row('b', 2), row('c', 9), row('now', 500)], 'now', pick), 2)
  assert.equal(typicalOf([row('a', 1), row('b', 2), row('c', 9, false)], 'now', pick), undefined)
  assert.equal(typicalOf([row('a', 1), row('b', 2), row('c', undefined)], 'now', pick), undefined)
})

test('pace runs evenly over the window and is unknown without a reset ahead', () => {
  const week = 7 * 86_400_000
  assert.equal(paceOf('seven_day', 1000 + week / 2, 1000), 50)
  assert.equal(paceOf('seven_day', undefined, 1000), undefined)
  assert.equal(paceOf('seven_day', 1000, 1000), undefined)
  assert.equal(paceOf('other', 5000, 1000), undefined)
  assert.equal(paceOf('five_hour', 1000 + 365 * week, 1000), 0)
  assert.equal(isAheadOfPace(55, 50), false)
  assert.equal(isAheadOfPace(56, 50), true)
  assert.equal(isAheadOfPace(99, undefined), false)
})

test('tones follow what is good for the figure', () => {
  assert.deepEqual([100, 101, 150, 151].map(v => bandTone(v, 100, 150)), ['good', 'warn', 'warn', 'bad'])
  assert.deepEqual([80, 79, 50, 49, undefined].map(reversedLevel), ['good', 'warn', 'warn', 'bad', ''])
})

test('relation text fills its values and leaves an unknown one showing', () => {
  assert.equal(fill(PAGE_EN.relOf, { a: '1K', b: '2K' }), '1K of 2K')
  assert.equal(fill(PAGE_EN.ofTypical, { pct: 57, v: '$4.10' }), '57% of typical $4.10')
  assert.equal(fill('{a} {x}', { a: 0 }), '0 {x}')
})

const filesOf = (test, more = {}) => ({
  files: { read: ['a', 'r1', 'r2'], edited: ['a', 'b', 'c'], editedTimes: { a: 100, b: 300, c: 200 } },
  checks: test ? [{ kind: 'lint', at: 999, result: 'ok' }, { kind: 'test', ...test }] : [],
  insights: {},
  ...more,
})
const paths = rows => rows.map(r => r.path)

test('edited files split at the last passing test, latest change first', () => {
  const g = fileGroups(filesOf({ at: 250, result: 'ok' }))
  assert.equal(g.state, 'green')
  assert.equal(g.tone, 'bad')
  assert.deepEqual(paths(g.toCheck), ['b'])
  assert.deepEqual(paths(g.beforeGreen), ['c', 'a'])
  assert.equal(g.toCheck.length, editsSinceGreen({ editedTimes: { a: 100, b: 300, c: 200 } }, [{ kind: 'test', at: 250, result: 'ok' }]))
})

test('without a passing test every edited file still needs one', () => {
  const failed = fileGroups(filesOf({ at: 999, result: 'failed' }))
  assert.deepEqual([failed.state, failed.tone, failed.beforeGreen.length, failed.toCheck.length], ['failed', 'bad', 0, 3])
  for (const test of [undefined, { at: 999, result: 'running' }, { at: 999, result: 'unknown' }]) {
    const g = fileGroups(filesOf(test))
    assert.deepEqual([g.state, g.tone, g.beforeGreen.length, g.toCheck.length], ['none', 'warn', 0, 3])
  }
})

test('an edit with no time cannot count as tested', () => {
  const g = fileGroups(filesOf({ at: 999, result: 'ok' }, { files: { read: [], edited: ['old', 'a'], editedTimes: { a: 1 } } }))
  assert.deepEqual(paths(g.toCheck), ['old'])
  assert.deepEqual(paths(g.beforeGreen), ['a'])
})

test('only read leaves out edited files, most read first, and marks new files and re-reads', () => {
  const g = fileGroups(filesOf(undefined, { insights: { reads: { a: 9, r1: 1, r2: 3 }, edits: { b: 4 }, sizes: { b: { now: 5 }, c: { first: 1, now: 5 } } } }))
  assert.deepEqual(g.readOnly, [{ path: 'r2', reads: 3, isOften: true }, { path: 'r1', reads: 1, isOften: false }])
  const byPath = Object.fromEntries(g.toCheck.map(r => [r.path, r]))
  assert.deepEqual([byPath.b.isNew, byPath.b.edits, byPath.c.isNew, byPath.a.isNew], [true, 4, false, false])
})

const traced = (id, at, more = {}) => ({ id, at, who: 'main', tool: 'Read', what: 'a.ts', ms: 10, ...more })
const rowsOf2 = (input, names = new Map()) => logRows({ log: [], trace: [], turns: [], agents: [], ...input }, 'You', names)

test('the log stream holds prompts, calls and log lines in time order, without launch calls', () => {
  const rows = rowsOf2({
    turns: [{ startedAt: 1, prompt: 'do it\nmore' }, { startedAt: 2 }],
    trace: [traced('t', 3), traced('launch', 4, { tool: 'Agent', what: 'x' })],
    log: [{ at: 2, who: 'main', what: 'compacted', result: '' }],
  })
  assert.deepEqual(rows.map(r => r.what), ['do it', 'compacted', 'a.ts'])
  assert.equal(rows[0].isYou, true)
})

test('equal calls in a row merge; a failure, a running call or another call between does not', () => {
  const rows = rowsOf2({ trace: [traced('1', 1), traced('2', 2), traced('f', 3, { isFailed: true, error: 'x' }), traced('3', 4), traced('run', 5, { ms: undefined }), traced('o', 6, { what: 'b.ts' }), traced('4', 7)] })
  assert.deepEqual(rows.map(r => [r.key, r.count, r.result]), [['call:1', 2, 'ok'], ['call:f', 1, 'failed'], ['call:3', 1, 'ok'], ['call:run', 1, 'running'], ['call:o', 1, 'ok'], ['call:4', 1, 'ok']])
  assert.equal(rows[0].ms, 20)
  assert.equal(rows[3].isRunning, true)
})

test('a subagent is one row, and its test report stays apart', () => {
  const log = [{ at: 10, who: 'tester', what: 'Run tests', result: 'started', agentId: 'g' }, { at: 20, who: 'tester', what: 'Tests passed', result: 'PASS (reported)', agentId: 'g' }, { at: 21, who: 'tester', what: 'done after 11s', result: '2 files, 5 tools', agentId: 'g' }]
  const rows = rowsOf2({ log, agents: [{ id: 'g', task: 'Run tests', status: 'done', startedAt: 10, endedAt: 21 }] }, new Map([['g', { short: 'Run tests', full: 'Run tests' }]]))
  assert.deepEqual(rows.map(r => [r.what, r.result, r.ms, r.who]), [['Run tests', '2 files, 5 tools', 11, 'Run tests'], ['Tests passed', 'PASS (reported)', undefined, 'Run tests']])
})

test('a running subagent shows as running; one whose first line the cap dropped keeps its last; an errored one is failed', () => {
  const start = { at: 10, who: 't', what: 'task', result: 'started', agentId: 'g' }
  const running = rowsOf2({ log: [start], agents: [{ id: 'g', task: 'task', status: 'running', startedAt: 10 }] })
  assert.deepEqual([running[0].isRunning, running[0].ms], [true, undefined])
  const capped = rowsOf2({ log: [{ ...start, what: 'done after 1s', result: '1 file' }], agents: [{ id: 'g', task: 'task', status: 'done', startedAt: 1, endedAt: 10 }] })
  assert.deepEqual(capped.map(r => [r.what, r.result]), [['done after 1s', '1 file']])
  const errored = rowsOf2({ log: [start, { ...start, at: 11, what: 'done', result: '0 files' }], agents: [{ id: 'g', task: 'task', status: 'error', startedAt: 10, endedAt: 11 }] })
  assert.deepEqual([errored.length, errored[0].isFailed], [1, true])
})

test('an older session without a trace still has its log', () => {
  assert.equal(logRows({ log: [{ at: 1, who: 'm', what: 'x', result: '' }], turns: [], agents: [] }, 'You', new Map()).length, 1)
})

test('chips count and match the rows', () => {
  const rows = rowsOf2({ turns: [{ startedAt: 1, prompt: 'p' }], trace: [traced('a', 2, { agentId: 'g' }), traced('f', 3, { isFailed: true })] })
  assert.deepEqual(chipCounts(rows), { all: 3, failures: 1, you: 1, agents: 1 })
  assert.deepEqual(rows.filter(r => matchesChip(r, 'failures')).map(r => r.key), ['call:f'])
  assert.deepEqual(chipCounts([]), { all: 0, failures: 0, you: 0, agents: 0 })
})

test('the strip spans the rows, counts merged calls, and goes to a bar\'s first failure', () => {
  assert.deepEqual(stripOf([]), [])
  const rows = rowsOf2({ trace: [traced('1', 0), traced('2', 1, { what: 'b' }), traced('f', 2, { isFailed: true }), traced('g', 3, { isFailed: true }), traced('z', 100, { what: 'z' })] })
  const strip = stripOf(rows, 10)
  assert.equal(strip.length, 10)
  assert.deepEqual([strip[0].count, strip[0].isFailed, strip[0].target, strip[0].at], [4, true, 2, 2])
  assert.equal(strip[5], null)
  assert.deepEqual([strip[9].count, strip[9].target], [1, 4])
  assert.equal(stripOf(rowsOf2({ trace: [traced('1', 5)] }), 3).filter(Boolean).length, 1)
})

test('a project with no history compares with the guide, and says so', () => {
  assert.deepEqual(referenceOf(undefined, GUIDE.usd), { value: 10, isGuide: true })
  assert.deepEqual(referenceOf(4, GUIDE.usd), { value: 4, isGuide: false })
  assert.equal(fill(PAGE_EN.ofGuide, { pct: 24, v: '$10.00' }), '24% of $10.00 guide')
})

test('a failed report stays red when the log cap dropped the started line', () => {
  const log = [{ at: 20, who: 't', what: 'Tests failed', result: 'FAIL (reported)', agentId: 'g' }, { at: 21, who: 't', what: 'done after 11s', result: '1 file · 3 tools', agentId: 'g' }]
  const rows = rowsOf2({ log, agents: [{ id: 'g', task: 'Run tests', status: 'done', startedAt: 10, endedAt: 21 }] })
  assert.deepEqual(rows.map(r => [r.what, r.result, r.isFailed]), [['Tests failed', 'FAIL (reported)', true], ['done after 11s', '1 file · 3 tools', false]])
})
