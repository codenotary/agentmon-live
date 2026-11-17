import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { codexGaps, stopAnswer } from '../../codex/gate.mjs'
import { answer, feedbackLink, PANE_URI, paneTree, pickChat, words, STATUSLINE_URI, statusText, threadOf } from '../../codex/mcp.mjs'
import { foldRollout, readCodex } from '../../server/codex.mjs'
import { SHAPE } from '../fixtures/snapshot-shape.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ROLLOUT = readFileSync(join(ROOT, 'tests/fixtures/codex-rollout.jsonl'), 'utf8')
const SID = '01a1c1d8-0000-7000-8000-000000000001'
const entries = ROLLOUT.trim().split('\n').map(l => JSON.parse(l))
const NOW = Date.parse('2026-11-10T10:01:30Z')

test('a rollout folds into a snapshot with every required key', () => {
  const { snapshot: s, isLive } = foldRollout(entries, NOW)
  const optional = new Set(['isPaneOpen', 'testReview', 'gate', 'steps', 'isStepsCut'])
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
    { timestamp: stamp(85), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: {} } },
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

test('a compaction logs a row, and the context is the newest count after it', () => {
  const stamp = sec => new Date(Date.parse('2026-11-10T10:00:00Z') + sec * 1000).toISOString()
  const count = used => ({ timestamp: stamp(86), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {}, last_token_usage: { total_tokens: used }, model_context_window: 200000 } } })
  const more = [count(180000), { timestamp: stamp(86), type: 'event_msg', payload: { type: 'context_compacted' } }, count(30000)]
  const s = foldRollout([...entries, ...more], NOW).snapshot
  assert.deepEqual(s.log.filter(r => r.what === 'context compacted').map(r => r.who), ['main session'])
  assert.equal(s.usage.ctxPct, 15)
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
  // Still written to days later: its folder is out of the window, the chat is not.
  const later = NOW + 5 * 86_400_000
  utimesSync(file, later / 1000, later / 1000)
  assert.deepEqual(readCodex(home, later, 60_000, cache).map(([id]) => id), [SID])
  assert.deepEqual(readCodex(home, later, 60_000).map(([id]) => id), [])
  assert.deepEqual(readCodex(home, later + 61_000, 60_000, cache), [])
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

const gated = (checks, editedTimes) => ({ turns: [{ startedAt: 100 }], checks, files: { editedTimes } })

test('the Codex gate sends back a check that failed after this turn\'s edit or ran before its last one, and nothing else', () => {
  const test = (result, at) => ({ kind: 'test', command: 'npm test', result, at })
  assert.deepEqual(codexGaps(gated([test('failed', 300)], { '/r/a.ts': 200 })), ['test failed: npm test'])
  assert.deepEqual(codexGaps(gated([test('ok', 150)], { '/r/a.ts': 200 })), ['test ran before the last edit: npm test'])
  assert.deepEqual(codexGaps(gated([test('ok', 300)], { '/r/a.ts': 200 })), [])
  // Failed before the edit: stale, not this turn's failure. An earlier turn's check and a running one do not count.
  assert.deepEqual(codexGaps(gated([test('failed', 150), test('failed', 50), test('running', 300)], { '/r/a.ts': 200 })), ['test ran before the last edit: npm test'])
  // Docs only, or no edit this turn: nothing to check.
  assert.deepEqual(codexGaps(gated([test('failed', 300)], { '/r/README.md': 200, '/r/old.ts': 50 })), [])
  assert.deepEqual(codexGaps({ turns: [], checks: [], files: {} }), [])
})

test('the Stop hook answers Codex only with a block, never twice in a row, and the fixture chat passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentmon-gate-'))
  const file = join(dir, 'rollout.jsonl')
  writeFileSync(file, ROLLOUT)
  assert.equal(stopAnswer({ transcript_path: file }, NOW), undefined)
  const edited = `${ROLLOUT}${JSON.stringify({ timestamp: '2026-11-10T10:01:25.000Z', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'FileChange', changes: { '/home/dev/github/demo/src/c.ts': { type: 'update' } }, status: 'completed' } } })}\n`
  writeFileSync(file, edited)
  assert.deepEqual(stopAnswer({ transcript_path: file }, NOW), { decision: 'block', reason: 'Before you report done, this looks unfinished:\n- test ran before the last edit: npm test\n\nFinish it, or say plainly why not.' })
  assert.equal(stopAnswer({ transcript_path: file, stop_hook_active: true }, NOW), undefined)
  // Run as Codex runs it: bad input lets Codex stop.
  const run = input => spawnSync(process.execPath, [join(ROOT, 'codex/gate.mjs')], { input, encoding: 'utf8' })
  assert.deepEqual([run('not json').status, run('not json').stdout], [0, ''])
  assert.equal(run(JSON.stringify({ transcript_path: join(dir, 'none') })).stdout, '')
})

test('the MCP server lists a statusline tool Codex can find and reads the line as a UI tree', () => {
  const chats = () => [['a', gated([{ kind: 'test', command: 'npm test', result: 'failed', at: 300 }], { '/r/a.ts': 200 })]].map(([id, s]) => [id, { ...s, usage: { ctxPct: 25, rate: [{ kind: 'five_hour', pct: 12 }] } }])
  const { tools } = answer({ method: 'tools/list' }, chats)
  assert.deepEqual(tools.find(t => t.name === 'statusline')._meta['openai/ui'].entrypoints, [{ type: 'statusline', resourceUri: STATUSLINE_URI }])
  const { contents: [c] } = answer({ method: 'resources/read', params: { uri: STATUSLINE_URI } }, chats)
  assert.equal(c.mimeType, 'application/json')
  assert.deepEqual(JSON.parse(c.text), { type: 'text', children: ['AgentMon · 1 open · test failed · ctx 25% · 5h 12% · http://127.0.0.1:47311/'] })
  assert.match(statusText(undefined), /no live Codex chat/)
  assert.throws(() => answer({ method: 'resources/read', params: { uri: 'ui://other' } }, chats), /unknown resource/)
  assert.throws(() => answer({ method: 'nope' }, chats), /method not found/)
})

test('the chat the status line shows is the one Codex names, else the one with the latest turn', () => {
  const at = startedAt => ({ turns: [{ startedAt }] })
  const chats = [['a', at(5)], ['b', at(9)], ['c', at(1)]]
  assert.equal(pickChat(chats, 'c'), chats[2][1])
  assert.equal(pickChat(chats, undefined), chats[1][1])
  assert.equal(pickChat([], undefined), undefined)
})

test('feedback makes a link the person submits and sends nothing', () => {
  const said = feedbackLink({ type: 'idea', text: 'Show approvals\nfor Codex' })
  const url = new URL(said.split('\n').at(-1))
  assert.deepEqual([url.searchParams.get('title'), url.searchParams.get('labels')], ['Show approvals', 'enhancement'])
  assert.match(said, /^Nothing was sent/)
  assert.match(feedbackLink({ type: 'rant', text: 'x' }), /^Not taken/)
  assert.match(feedbackLink({ type: 'idea', text: ' ' }), /^Not taken/)
})

test('the MCP server answers JSON-RPC over stdio and skips notifications', () => {
  const lines = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: STATUSLINE_URI } }]
  const dir = mkdtempSync(join(tmpdir(), 'agentmon-mcp-'))
  const run = spawnSync(process.execPath, [join(ROOT, 'codex/mcp.mjs'), 'serve'], { input: lines.map(l => JSON.stringify(l)).join('\n') + '\n', encoding: 'utf8', env: { ...process.env, CODEX_HOME: join(dir, 'none') } })
  const replies = run.stdout.trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(replies.map(r => r.id), [1, 2])
  assert.equal(replies[0].result.serverInfo.name, 'agentmon-live')
  assert.match(JSON.parse(replies[1].result.contents[0].text).children[0], /no live Codex chat/)
})

test('the Codex plugin declares the MCP server, skills and Stop hook it ships', () => {
  const plugin = JSON.parse(readFileSync(join(ROOT, '.codex-plugin/plugin.json'), 'utf8'))
  const server = plugin.mcpServers['agentmon-live']
  assert.ok(existsSync(join(ROOT, server.cwd, server.args[0])))
  assert.ok(existsSync(join(ROOT, plugin.skills, 'agentmon/SKILL.md')))
  const { hooks } = JSON.parse(readFileSync(join(ROOT, plugin.hooks), 'utf8'))
  const [, file] = hooks.Stop[0].hooks[0].command.match(/PLUGIN_ROOT\}\/(\S+?)"/)
  assert.ok(existsSync(join(ROOT, file)), file)
})

test('the pane is a panel of text, charts and keys for the chat Codex names, with no seconds clock', () => {
  const s = foldRollout(entries, NOW).snapshot
  const panel = paneTree(s)
  const text = words(panel)
  assert.equal(panel.type, 'panel')
  assert.match(text, /^AgentMon Live · Codex · 0\.166\.0 · gpt-6\.1-sol · medium\n/)
  assert.match(text, /Now\n◉ shell npm run lint\n/)
  assert.match(text, /Turn 2\n› run it again\n/)
  assert.match(text, /Files edited \(2\)\nsrc\/a\.ts\nsrc\/b\.ts\n/)
  assert.deepEqual(paneTree(foldRollout(entries, NOW + 20_000).snapshot), panel)
  assert.match(words(paneTree(undefined)), /No Codex chat/)
  assert.match(words(paneTree({ ...s, active: [{ tool: 'shell', what: 'echo x\nrm' }] })), /◉ shell echo x rm\n/)
  const busy = { ...s, trace: Array.from({ length: 500 }, (_, i) => ({ tool: 'shell', what: 'x'.repeat(500), at: s.now - i * 1000 })), checks: Array.from({ length: 50 }, () => ({ kind: 'test', result: 'failed', command: 'y'.repeat(500), at: NOW })), files: { ...s.files, edited: Array.from({ length: 50 }, (_, i) => `f${i}`.repeat(50)) } }
  assert.ok(JSON.stringify(paneTree(busy)).length <= 64 * 1024)
  const { contents: [c] } = answer({ method: 'resources/read', params: { uri: PANE_URI, _meta: { 'com.openai/codex-sidebar-state': { thread: { id: SID } } } } }, () => [['other', { ...s, turns: [{ startedAt: NOW }] }], [SID, s]])
  assert.deepEqual([c.mimeType, JSON.parse(c.text)], ['application/json', panel])
  assert.equal(answer({ method: 'tools/list' }, () => []).tools.find(t => t.name === 'pane')._meta['openai/ui'].entrypoints[0].type, 'sidebar')
})

test('an open item offers investigate and put-away keys, and put away it leaves the panel', () => {
  const s = foldRollout(entries, NOW).snapshot
  const failing = { ...s, checks: [{ kind: 'test', result: 'failed', command: 'npm test', at: s.turns.at(-1).startedAt + 1 }], files: { ...s.files, editedTimes: { 'src/a.ts': s.turns.at(-1).startedAt } } }
  const dismissed = new Set()
  const panel = paneTree(failing, dismissed)
  const actions = panel.children.filter(n => n.type === 'action')
  assert.deepEqual(actions.map(a => a.key), ['i', 'x'])
  assert.match(actions[0].prompt, /test failed: npm test/)
  assert.deepEqual(answer({ method: 'tools/call', params: { name: 'dismiss', arguments: actions[1].arguments } }, () => [], dismissed).content[0].text, 'Put away.')
  assert.ok(answer({ method: 'tools/call', params: { name: 'dismiss', arguments: {} } }, () => [], dismissed).isError)
  const after = paneTree(failing, dismissed)
  assert.equal(after.children.filter(n => n.type === 'action').length, 0)
  assert.match(words(after), /✓ nothing open/)
})

test('the chat on screen comes from either surface\'s state in the read', () => {
  assert.equal(threadOf({ 'com.openai/codex-statusline-state': { thread: { id: 'a' } } }), 'a')
  assert.equal(threadOf({ 'com.openai/codex-sidebar-state': { thread: { id: 'b' } } }), 'b')
  assert.equal(threadOf(undefined), undefined)
})
