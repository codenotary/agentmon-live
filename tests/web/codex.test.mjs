import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { foldRollout, readCodex } from '../../server/codex.mjs'
import { SHAPE } from '../fixtures/snapshot-shape.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ROLLOUT = readFileSync(join(ROOT, 'tests/fixtures/codex-rollout.jsonl'), 'utf8')
const SID = '01a1c1d8-0000-7000-8000-000000000001'
const entries = ROLLOUT.trim().split('\n').map(l => JSON.parse(l))
const NOW = Date.parse('2026-11-10T10:01:30Z')

test('a rollout folds into a snapshot with every required key', () => {
  const { snapshot: s, isLive } = foldRollout(entries, NOW)
  const optional = new Set(['isPaneOpen', 'testReview', 'gate'])
  assert.deepEqual(SHAPE.top.filter(k => !(k in s) && !optional.has(k)), [])
  assert.deepEqual(Object.keys(s).filter(k => !SHAPE.top.includes(k)), [])
  assert.deepEqual([s.session.id, s.session.cwd, s.build, s.main.model, s.main.effort], [SID, '/home/dev/github/demo', 'Codex · 0.166.0', 'gpt-6.1-sol', 'medium'])
  assert.equal(isLive, true)
  assert.equal(s.turnCount, 1)
})

test('turns carry their own prompt, answer and time split, though the rollout holds a prompt twice', () => {
  const { turns } = foldRollout(entries, NOW).snapshot
  assert.deepEqual(turns.map(t => t.prompt), ['fix the failing test', 'run it again'])
  assert.deepEqual([turns[0].answer, turns[0].wallMs, turns[0].isLive, turns[1].isLive], ['Fixed.', 14000, undefined, true])
  assert.deepEqual(turns[0].buckets, { shell: 4000, read: 200, edit: 100, model: 9700 })
})

test('a call shows the command the shell got, fails on its exit status, and runs until its output comes', () => {
  const s = foldRollout(entries, NOW).snapshot
  assert.deepEqual(s.trace.map(c => [c.tool, c.what, Boolean(c.isFailed)]), [
    ['shell', 'npm test', true],
    ['shell', 'cat src/a.ts', false],
    ['apply_patch', 'src/a.ts src/b.ts', false],
    ['shell', 'npm test', false],
    ['shell', 'npm test', true],
    ['shell', 'npm run lint', false],
  ])
  assert.deepEqual(s.active.map(a => [a.id, a.what]), [['call_5', 'npm run lint']])
})

test('a script handed back while its command runs passes no check: the exit status that comes later decides', () => {
  const s = foldRollout(entries, NOW).snapshot
  assert.deepEqual(s.checks.map(c => [c.kind, c.command, c.result, c.greenAt]), [['test', 'npm test', 'failed', undefined]])
  const early = foldRollout(entries.slice(0, entries.findIndex(e => e.payload.item?.id === 'exec-late')), NOW).snapshot
  assert.deepEqual(early.checks.map(c => [c.result, c.at]), [['failed', Date.parse('2026-11-10T10:00:05Z')]])
})

test('files, tokens, context and limits come from what Codex reports', () => {
  const s = foldRollout(entries, NOW).snapshot
  assert.deepEqual(s.files.edited, ['/home/dev/github/demo/src/a.ts', '/home/dev/github/demo/src/b.ts'])
  assert.deepEqual(s.files.read, ['/home/dev/github/demo/src/a.ts'])
  assert.deepEqual(s.insights.tokens, { mainIn: 1000, mainOut: 50, mainCached: 600, agentsIn: 0, agentsOut: 0 })
  assert.deepEqual(s.usage, { rate: [{ kind: 'five_hour', pct: 12, resetsAt: 1794400000000 }, { kind: 'seven_day', pct: 40, resetsAt: 1794900000000 }], usd: 0, ctxTokens: 50000, ctxWindow: 200000, ctxPct: 25 })
})

test('the end of a turn closes the call it cut off, and a count without limits keeps the last ones', () => {
  const stamp = sec => new Date(Date.parse('2026-11-10T10:00:00Z') + sec * 1000).toISOString()
  const more = [
    { timestamp: stamp(85), type: 'event_msg', payload: { type: 'token_count', info: null } },
    { timestamp: stamp(86), type: 'event_msg', payload: { type: 'turn_aborted' } },
    { timestamp: stamp(90), type: 'event_msg', payload: { type: 'task_started' } },
    { timestamp: stamp(91), type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'call_6', name: 'exec', input: 'tools.exec_command({cmd:"npm run build"})' } },
    { timestamp: stamp(92), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', command: ['zsh', '-lc', 'npm run build'], parsed_cmd: [], status: 'completed', exit_code: 0 } } },
  ]
  const s = foldRollout([...entries, ...more], Date.parse(stamp(95))).snapshot
  assert.deepEqual(s.active.map(a => a.id), ['call_6'])
  assert.deepEqual(s.trace.slice(-2).map(c => [c.id, c.what, c.ms]), [['call_5', 'npm run lint', 4000], ['call_6', 'npm run build', undefined]])
  assert.deepEqual(s.checks.map(c => c.kind), ['test'])
  assert.deepEqual(s.usage.rate.map(r => r.kind), ['five_hour', 'seven_day'])
})

test('a failed script fails its call, and an empty rollout still folds', () => {
  const failed = entries.map(e => (e.payload.call_id === 'call_2' && e.payload.output ? { ...e, payload: { ...e.payload, output: 'Script failed\nWall time 0.0 seconds\n' } } : e))
  assert.equal(foldRollout(failed, NOW).snapshot.trace[1].isFailed, true)
  assert.deepEqual(foldRollout([], NOW).snapshot.turns, [])
})

test('the reader lists a chat written to lately, reads it again only when it grew, and drops an idle one', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentmon-codex-'))
  const day = join(home, 'sessions/2026/11/10')
  mkdirSync(day, { recursive: true })
  const file = join(day, `rollout-2026-11-10T10-00-00-${SID}.jsonl`)
  const old = join(day, 'rollout-2026-11-01T10-00-00-old.jsonl')
  writeFileSync(file, ROLLOUT)
  writeFileSync(old, ROLLOUT.replaceAll(SID, 'old'))
  writeFileSync(join(day, 'rollout-2025-04-17-legacy.json'), '{}')
  utimesSync(file, NOW / 1000, NOW / 1000)
  utimesSync(old, NOW / 1000 - 9000, NOW / 1000 - 9000)
  const cache = new Map()
  assert.deepEqual(readCodex(home, NOW, 60_000, cache).map(([id]) => id), [SID])
  const read = cache.get(file).entries
  readCodex(home, NOW, 60_000, cache)
  assert.equal(cache.get(file).entries, read)

  appendFileSync(file, `${JSON.stringify({ timestamp: '2026-11-10T10:01:20.000Z', type: 'event_msg', payload: { type: 'turn_aborted' } })}\n{"half":`)
  utimesSync(file, NOW / 1000, NOW / 1000)
  const [[, s]] = readCodex(home, NOW, 60_000, cache)
  assert.equal(s.main.turnLive, undefined)
  assert.deepEqual(readCodex(home, NOW + 61_000, 60_000, cache), [])
  assert.deepEqual(readCodex(join(home, 'none'), NOW, 60_000), [])
})

test('the Codex plugin carries the plugin version and its hook starts a server file that exists', () => {
  const plugin = JSON.parse(readFileSync(join(ROOT, '.codex-plugin/plugin.json'), 'utf8'))
  assert.equal(plugin.version, JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).version)
  const { hooks } = JSON.parse(readFileSync(join(ROOT, plugin.hooks), 'utf8'))
  const [, file] = hooks.SessionStart[0].hooks[0].command.match(/PLUGIN_ROOT\}\/(\S+?)"/)
  assert.ok(existsSync(join(ROOT, file)), file)
  // Codex shows a hook's output to the model, and `ensure` prints the server's key.
  assert.match(hooks.SessionStart[0].hooks[0].command, />\/dev\/null 2>&1 \|\| true$/)
})
