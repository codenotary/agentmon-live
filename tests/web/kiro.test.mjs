import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import * as kiro from '../../server/kiro.mjs'
import { foldCrewLog, LABELS, readKiro, toolText } from '../../server/kiro.mjs'
import { SHAPE } from '../fixtures/snapshot-shape.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOG = join(HERE, '../fixtures/crew-log.jsonl')
const SID = '98c57baf-8d87-4311-b3db-02e5652916a2'
const entries = readFileSync(LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l))
const NOW = 1794295600000
const children = []
after(() => {
  for (const c of children) c.kill()
})

function home(text = readFileSync(LOG, 'utf8')) {
  const dir = mkdtempSync(join(tmpdir(), 'agentmon-kiro-'))
  mkdirSync(join(dir, 'crew-log/sessions', `${SID}-5dafb4d6`), { recursive: true })
  writeFileSync(join(dir, 'crew-log/sessions', `${SID}-5dafb4d6`, 'log.jsonl'), text)
  return dir
}
const open = () => readFileSync(LOG, 'utf8').split('\n').filter(l => l && !l.includes('"session/closed"')).join('\n') + '\n'

test('a crew log folds into a snapshot with every required key', () => {
  const { snapshot: s, isClosed, isLive } = foldCrewLog(entries, NOW)
  assert.equal(isClosed, true)
  assert.equal(isLive, false)
  const optional = new Set(['isPaneOpen', 'testReview', 'gate', 'steps', 'isStepsCut'])
  assert.deepEqual(SHAPE.top.filter(k => !(k in s) && !optional.has(k)), [])
  assert.deepEqual(Object.keys(s).filter(k => !SHAPE.top.includes(k)), [])
  assert.deepEqual([s.v, s.session.id, s.session.cwd, s.build, s.main.model], [1, SID, '/home/dev/github/demo', 'Kiro Crew · kirocrew', 'fable'])
  assert.equal(s.turnCount, 1)
  assert.deepEqual([s.turns[0].wallMs, s.turns[0].buckets.shell, s.turns[0].isLive, s.turns[0].prompt], [17292, 4064, undefined, 'how many lines of code?'])
  assert.deepEqual(s.trace, [{ id: 'toolu_014mx5RXWRkSGwzJQgXdAoef', at: 1794295529058, who: 'main session', tool: 'execute', what: '', ms: 4064 }])
  assert.deepEqual([s.usage.ctxTokens, s.usage.ctxWindow, s.usage.ctxPct], [116379, 1000000, 12])
  assert.deepEqual(s.insights.tokens, { mainIn: 4 + 126494 + 102676, mainOut: 828, mainCached: 126494, agentsIn: 0, agentsOut: 0 })
  assert.deepEqual(s.active, [])
})

test('a call, an approval and a subagent still open show as running', () => {
  const cutAt = entries.findIndex(e => e.type === 'tool/completed')
  const more = [
    { type: 'approval/requested', time: NOW - 5, data: { approval_id: 'ap1', tool: 'shell', reason: 'rm -rf build' } },
    { type: 'subagent/spawned', time: NOW - 4, data: { agent_id: 'sub1', agent: 'mate', task: 'look around' } },
    { type: 'subagent/spawned', time: NOW - 3, data: { agent_id: 'sub2' } },
    { type: 'subagent/failed', time: NOW - 2, data: { agent_id: 'sub2', outcome: 'failed', reason: 'Bedrock is throttling requests.' } },
    { type: 'plan/updated', time: NOW - 1, data: { items: [{ id: 1, text: 'count', state: 'done' }, { id: 2, text: 'report', state: 'open' }] } },
    { type: 'something/new', time: NOW, data: {} },
  ]
  const { snapshot: s, isLive } = foldCrewLog([...entries.slice(0, cutAt), ...more], NOW)
  assert.equal(isLive, true)
  assert.deepEqual([s.main.turnLive, s.turns[0].isLive, s.turnCount], [true, true, 0])
  // The approval holds the open call, so the call shows once, as asking; a running subagent shows beside it.
  assert.deepEqual(s.active.map(a => [a.id, a.tool, Boolean(a.isAsking)]), [['toolu_014mx5RXWRkSGwzJQgXdAoef', 'shell', true], ['sub1', 'subagent', false]])
  assert.deepEqual(s.focus.filter(f => f.isUrgent).map(f => [f.key, f.text]), [['ask:toolu_014mx5RXWRkSGwzJQgXdAoef', 'shell rm -rf build'], ['agent:sub2', 'subagent Bedrock is throttling requests.']])
  assert.equal(s.agents[1].testsWhy, 'Bedrock is throttling requests.')
  assert.equal(s.turns[0].buckets.you, 5)
  assert.deepEqual(s.agents.map(a => [a.id, a.type, a.status]), [['sub1', 'mate', 'running'], ['sub2', 'subagent', 'error']])
  assert.deepEqual(s.tasks.map(t => t.status), ['completed', 'pending'])
})

test('tool text comes from the chat transcript, and a missing or odd one gives none', () => {
  const dir = home()
  mkdirSync(join(dir, 'sessions'))
  writeFileSync(join(dir, 'sessions/dashboard_chat-7-1794295517.jsonl'), `${JSON.stringify({ _type: 'metadata' })}\n${JSON.stringify({ role: 'tool', content: 'Count', meta: { tool_call_id: 'toolu_014mx5RXWRkSGwzJQgXdAoef', input: '{"command":"tokei ."}' } })}\nnot json\n`)
  assert.deepEqual(toolText(dir, 'chat-7-1794295517').get('toolu_014mx5RXWRkSGwzJQgXdAoef'), { what: 'tokei .', path: undefined, tool: undefined })
  assert.equal(toolText(dir, 'chat-none').size, 0)
  assert.equal(toolText(dir, '../../etc/passwd').size, 0)
  const live = home(open())
  cpSync(join(dir, 'sessions'), join(live, 'sessions'), { recursive: true })
  assert.equal(readKiro(live, NOW, Infinity)[0][1].trace[0].what, 'tokei .')
})

test('closed chats, long idle ones and a missing folder list nothing; a half-written line is skipped', () => {
  assert.deepEqual(readKiro(home(), NOW, Infinity), [])
  assert.deepEqual(readKiro(join(tmpdir(), 'agentmon-no-such-kiro'), NOW, Infinity), [])
  const dir = home(`${open()}{"type":"turn/star`)
  const file = join(dir, 'crew-log/sessions', `${SID}-5dafb4d6`, 'log.jsonl')
  const cache = new Map()
  assert.deepEqual(readKiro(dir, Date.now(), 60_000, cache).map(([id]) => id), [SID])
  utimesSync(file, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000))
  assert.deepEqual(readKiro(dir, Date.now(), 60_000, cache), [])
  // A turn under way keeps a quiet chat listed: a long tool call writes nothing.
  appendFileSync(file, `\n${JSON.stringify({ type: 'turn/started', time: Date.now() - 120_000, data: { turn: 4 } })}\n`)
  utimesSync(file, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000))
  assert.equal(readKiro(dir, Date.now(), 60_000, cache)[0][1].main.turnLive, true)
  // Not for ever: a chat that crashed in its turn never ends it.
  utimesSync(file, new Date(Date.now() - 300_000), new Date(Date.now() - 300_000))
  assert.deepEqual(readKiro(dir, Date.now(), 60_000, cache), [])
  assert.deepEqual(readKiro(dir, Date.now(), 60_000), [])
  utimesSync(file, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000))
  // An idle chat's lines are let go, and a log already old is not read.
  assert.deepEqual([...cache.values()], [{ size: readFileSync(file).length, isDone: true, kept: new Map() }])
  // A chat whose folder is gone is forgotten.
  cache.set('gone/log.jsonl', {})
  readKiro(dir, Date.now(), 60_000, cache)
  assert.deepEqual([...cache.keys()], [file])
})

test('a turn that never reported its end is closed by the next one', () => {
  const at = t => ({ type: 'turn/started', time: t, data: {} })
  const { snapshot, isLive } = foldCrewLog([entries[0], at(1000), at(4000)], 9000)
  assert.deepEqual(snapshot.turns.map(t => [t.wallMs, Boolean(t.isLive)]), [[3000, false], [5000, true]])
  assert.equal(isLive, true)
})

test('a long chat sends its last turns only, and still counts them all', () => {
  const turns = Array.from({ length: 60 }, (_, i) => [{ type: 'turn/started', time: NOW + i, data: {} }, { type: 'turn/completed', time: NOW + i, data: { duration_ms: 1 } }]).flat()
  const { snapshot } = foldCrewLog([entries[0], ...turns], NOW + 100)
  assert.equal(snapshot.turns.length, 50)
  assert.equal(snapshot.turnCount, 60)
  assert.equal(snapshot.turns.at(-1).startedAt, NOW + 59)
})

test('a chat carries the words the page prints, as a mod session does in English', () => {
  const { page, ...labels } = JSON.parse(readFileSync(join(HERE, '../fixtures/snapshot.json'), 'utf8')).labels
  assert.deepEqual(LABELS, labels)
  assert.equal(foldCrewLog(entries, NOW).snapshot.labels, LABELS)
})

function events(port, isDone, pass = '') {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: `/events?p=${pass}` }, res => {
      let text = ''
      res.on('data', d => {
        text += d
        if (isDone(text)) {
          req.destroy()
          resolve(text)
        }
      })
    })
    req.on('error', e => (e.code === 'ECONNRESET' ? undefined : reject(e)))
    req.end()
  })
}
const post = (port, id, value, key) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path: `/state/${id}`, method: 'POST', headers: { 'content-type': 'application/json', 'x-agentmon-key': key } }, res => res.resume().on('end', () => resolve(res.statusCode)))
  req.on('error', reject)
  req.end(JSON.stringify(value))
})

test('the server lists a live chat, leaves a posted session of the same id alone, and drops the chat once closed', async () => {
  const dir = home(open())
  const port = 47470
  const WEB = join(HERE, '../../server/web.mjs')
  const token = 'c'.repeat(64)
  writeFileSync(join(dir, 'web.token'), token)
  const env = { ...process.env, KIROCREW_HOME: dir, CODEX_HOME: dir, AGENTMON_KIRO_FILE: join(dir, 'kiro.json'), AGENTMON_KIRO_POLL_MS: '50', AGENTMON_WEB_TOKEN_FILE: join(dir, 'web.token') }
  children.push(spawn(process.execPath, [WEB, 'serve', String(port)], { env, stdio: 'ignore' }))
  const health = p => new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port: p, path: '/health' }, res => {
      let text = ''
      res.on('data', d => (text += d)).on('end', () => resolve(JSON.parse(text)))
    })
    req.on('error', () => resolve(undefined))
    req.end()
  })
  const up = async p => {
    for (let i = 0; i < 60; i += 1) {
      const found = await health(p)
      if (found) return found
      await new Promise(done => setTimeout(done, 50))
    }
    throw new Error('no server')
  }
  const { boot } = await up(port)
  const pass = createHmac('sha256', token).update(`browser:${port}:${boot}`).digest('hex')
  const { key } = JSON.parse(spawnSync(process.execPath, [WEB, 'ensure', String(port)], { env, encoding: 'utf8', timeout: 8000 }).stdout)
  const first = await events(port, t => t.includes('Kiro Crew'), pass)
  assert.match(first, new RegExp(`"id":"${SID}"`))

  assert.equal(await post(port, SID, { v: 1, session: { id: SID, cwd: '/x' }, build: 'from the mod' }, key), 204)
  await new Promise(done => setTimeout(done, 200))
  const replay = await events(port, t => t.includes('event: snapshot'), pass)
  assert.match(replay, /from the mod/)
  assert.doesNotMatch(replay, /Kiro Crew/)

  // A server with the lock off shows a session that chose so, never a Kiro Crew chat.
  children.push(spawn(process.execPath, [WEB, 'serve', String(port + 1), '--open'], { env, stdio: 'ignore' }))
  await up(port + 1)
  await new Promise(done => setTimeout(done, 300))
  assert.doesNotMatch(await events(port + 1, t => t.includes('event: sessions')), /Kiro Crew/)

  const other = SID.replace('98c5', 'aaaa')
  mkdirSync(join(dir, 'crew-log/sessions', `${other}-1`))
  writeFileSync(join(dir, 'crew-log/sessions', `${other}-1`, 'log.jsonl'), open().replaceAll(SID, other))
  await events(port, t => t.includes(`"id":"${other}"`), pass)
  appendFileSync(join(dir, 'crew-log/sessions', `${other}-1`, 'log.jsonl'), `${JSON.stringify({ type: 'session/closed', time: Date.now(), data: {} })}\n`)
  await events(port, t => t.includes('event: removed') && t.includes(other), pass)
})

test('edits and reads fill the files, and credits show in the label', () => {
  const text = new Map([['e1', { what: '/w/a.py', path: '/w/a.py' }], ['e2', { what: '/w/b.py', path: '/w/b.py' }], ['r1', { what: '/w/c.md', path: '/w/c.md' }]])
  const call = (id, kind, extra = {}) => [{ type: 'tool/called', time: NOW - 9, data: { call_id: id, name: '', kind } }, { type: 'tool/completed', time: NOW - 8, data: { call_id: id, elapsed_ms: 5, ...extra } }]
  const log = [entries[0], { type: 'turn/started', time: NOW - 10, data: {} }, ...call('e1', 'edit'), ...call('e1', 'edit'), ...call('e2', 'edit', { is_error: true }), ...call('r1', 'read'), { type: 'turn/completed', time: NOW, data: { duration_ms: 10, credits: 0.5378, model: 'auto' } }]
  const { snapshot: s } = foldCrewLog(log, NOW, text)
  assert.deepEqual(s.files, { read: ['/w/c.md'], edited: ['/w/a.py'], editedAt: NOW - 8, editedTimes: { '/w/a.py': NOW - 8 } })
  assert.equal(s.usage.credits, 0.5378)
  assert.deepEqual(s.insights.tokens, { mainIn: 0, mainOut: 0, mainCached: 0, agentsIn: 0, agentsOut: 0 })
  const dir = home()
  mkdirSync(join(dir, 'sessions'))
  writeFileSync(join(dir, 'sessions/dashboard_chat-9.jsonl'), `${JSON.stringify({ role: 'tool', content: 'x', meta: { tool_call_id: 'e1', kind: 'edit', input: '--- /w/a.py\n+++ /w/a.py\n@@ -0,0 +1 @@\n+print(1)' } })}\n`)
  assert.deepEqual(toolText(dir, 'chat-9').get('e1'), { what: '/w/a.py', path: '/w/a.py', tool: undefined })
})

test('a subagent is tied to the call that started it, its credits count, and its report is not your prompt', () => {
  const dir = home()
  mkdirSync(join(dir, 'sessions'))
  const row = (id, content, input) => JSON.stringify({ role: 'tool', content, meta: { tool_call_id: id, input: JSON.stringify(input) } })
  writeFileSync(join(dir, 'sessions/dashboard_chat-9.jsonl'), `${row('s1', 'Running: @kirocrew-core/spawn_run', { __tool_use_purpose: 'Spawn a helper', tasks: [] })}\n${row('r1', 'Reading a.py:1', { operations: [{ mode: 'Line', path: '/w/a.py' }] })}\n`)
  const text = toolText(dir, 'chat-9')
  assert.deepEqual(text.get('s1'), { what: 'Spawn a helper', path: undefined, tool: '@kirocrew-core/spawn_run' })
  assert.deepEqual(text.get('r1'), { what: '/w/a.py', path: '/w/a.py', tool: undefined })
  const log = [
    entries[0],
    { type: 'message/received', time: NOW - 30, data: { text: 'add ETH' } },
    { type: 'turn/started', time: NOW - 30, data: { actor: 'user' } },
    { type: 'tool/called', time: NOW - 29, data: { call_id: 's1', name: '', kind: 'unknown' } },
    { type: 'subagent/spawned', time: NOW - 28, data: { agent_id: 'sub1', agent: 'kirocrew', task: 'rewrite it' } },
    { type: 'tool/completed', time: NOW - 27, data: { call_id: 's1', elapsed_ms: 2 } },
    { type: 'turn/completed', time: NOW - 26, data: { duration_ms: 4, credits: 0.3 } },
    { type: 'subagent/completed', time: NOW - 10, data: { agent_id: 'sub1', ms: 18, credits: 0.65 } },
    { type: 'message/received', time: NOW - 9, data: { text: '[Subagent completion event]' } },
    { type: 'turn/started', time: NOW - 9, data: { actor: 'subagent' } },
  ]
  const { snapshot: s } = foldCrewLog(log, NOW, text)
  assert.deepEqual([s.trace[0].tool, s.trace[0].what], ['@kirocrew-core/spawn_run', 'Spawn a helper'])
  assert.deepEqual([s.agents[0].callId, s.agents[0].status, s.agents[0].prompt, s.agents[0].endedAt], ['s1', 'done', 'rewrite it', NOW - 10])
  assert.deepEqual(s.log.map(l => [l.result, l.agentId]), [['started', 'sub1'], ['done', 'sub1']])
  assert.equal(s.usage.credits, 0.3 + 0.65)
  assert.deepEqual(s.turns.map(t => t.prompt), ['add ETH', undefined])
})

test('approval time goes to you, slow and big calls and repeated approvals show, and the turn that waited is an event', () => {
  const log = [
    entries[0],
    { type: 'turn/started', time: NOW - 200_000, data: {} },
    { type: 'tool/called', time: NOW - 199_000, data: { call_id: 'c1', kind: 'execute' } },
    { type: 'approval/requested', time: NOW - 199_000, data: { approval_id: 'a1', reason: 'Running: make' } },
    { type: 'approval/decided', time: NOW - 159_000, data: { approval_id: 'a1' } },
    { type: 'tool/completed', time: NOW - 89_000, data: { call_id: 'c1', elapsed_ms: 110_000, result_bytes: 80_000 } },
    { type: 'tool/called', time: NOW - 88_000, data: { call_id: 'c2', kind: 'execute' } },
    { type: 'approval/requested', time: NOW - 88_000, data: { approval_id: 'a2', reason: 'Running: make' } },
    { type: 'approval/decided', time: NOW - 87_000, data: { approval_id: 'a2' } },
    { type: 'tool/completed', time: NOW - 87_000, data: { call_id: 'c2', elapsed_ms: 1000 } },
    { type: 'turn/completed', time: NOW - 80_000, data: { duration_ms: 120_000 } },
  ]
  const { snapshot: s } = foldCrewLog(log, NOW)
  assert.deepEqual([s.turns[0].buckets.you, s.turns[0].buckets.shell, s.turns[0].buckets.model], [41_000, 70_000, 9000])
  assert.deepEqual([s.insights.session.you, s.insights.sessionWall], [41_000, 120_000])
  assert.deepEqual(s.insights.slow.map(c => [c.tool, c.ms]), [['execute', 70_000]])
  assert.deepEqual(s.insights.big.map(c => c.tokens), [20_000])
  assert.deepEqual(s.insights.askedAll, { 'Running: make': 2 })
  assert.deepEqual(s.focus.map(f => [f.key, f.isUrgent]), [[`wait:${NOW - 200_000}`, false]])
})

test("a subagent's files come from kiro-cli's transcript of its chat, and stay once its folder is gone", () => {
  const dir = home(open())
  const crew = join(dir, 'crew')
  cpSync(join(dir, 'crew-log'), join(crew, 'crew-log'), { recursive: true })
  mkdirSync(join(crew, 'subagents/sub1'), { recursive: true })
  writeFileSync(join(crew, 'subagents/sub1/state.json'), JSON.stringify({ session_id: 'cli1' }))
  mkdirSync(join(dir, 'sessions/cli'), { recursive: true })
  const row = (id, status, path) => JSON.stringify({ kind: 'ToolResults', data: { content: [{ kind: 'toolResult', data: { toolUseId: id, status } }], results: { [id]: { tool: { kind: { BuiltIn: { FileWrite: { path } } } } } } } })
  writeFileSync(join(dir, 'sessions/cli/cli1.jsonl'), [JSON.stringify({ kind: 'Prompt', data: { meta: { timestamp: 1794295590 } } }), row('t1', 'error', '/w/no.js'), row('t2', 'success', '/w/ui.js')].join('\n') + '\n')
  const log = join(crew, 'crew-log/sessions', `${SID}-5dafb4d6`, 'log.jsonl')
  appendFileSync(log, `${JSON.stringify({ type: 'subagent/spawned', time: NOW - 5, data: { agent_id: 'sub1', task: 'ui' } })}\n`)
  const cache = new Map()
  const first = readKiro(crew, NOW, 60_000, cache)[0][1]
  assert.deepEqual([first.files.edited, first.files.editedTimes['/w/ui.js'], first.agents[0].files], [['/w/ui.js'], 1794295590000, 1])
  appendFileSync(log, `${JSON.stringify({ type: 'subagent/completed', time: NOW - 1, data: { agent_id: 'sub1' } })}\n`)
  readKiro(crew, NOW, 60_000, cache)
  // The chat idles out of the list, its subagent's folder goes, then the chat goes on.
  assert.deepEqual(readKiro(crew, Date.now() + 120_000, 60_000, cache), [])
  writeFileSync(join(crew, 'subagents/sub1/state.json'), '')
  appendFileSync(log, '\n')
  assert.deepEqual(readKiro(crew, NOW, 60_000, cache)[0][1].files.edited, ['/w/ui.js'])
})

test('an approval left open when its call ends counts once, and with two calls open it holds neither', () => {
  const log = [
    entries[0],
    { type: 'turn/started', time: NOW - 100_000, data: {} },
    { type: 'tool/called', time: NOW - 100_000, data: { call_id: 'c1', kind: 'execute' } },
    { type: 'approval/requested', time: NOW - 100_000, data: { approval_id: 'a1', reason: 'Running: make' } },
    { type: 'tool/completed', time: NOW - 60_000, data: { call_id: 'c1', elapsed_ms: 40_000, status: 'failed' } },
    { type: 'tool/called', time: NOW - 50_000, data: { call_id: 'c2', kind: 'execute' } },
    { type: 'tool/called', time: NOW - 50_000, data: { call_id: 'c3', kind: 'read' } },
    { type: 'approval/requested', time: NOW - 50_000, data: { approval_id: 'a2', reason: 'Running: ls' } },
  ]
  const { snapshot: s } = foldCrewLog(log, NOW)
  assert.deepEqual([s.turns[0].buckets.shell, s.turns[0].buckets.you], [0, 40_000 + 50_000])
  assert.deepEqual(s.active.map(a => [a.id, Boolean(a.isAsking)]), [['c2', false], ['c3', false], ['a2', true]])
})

test("a subagent whose folder is not written yet when it ends is read again on the next poll", () => {
  const dir = home(open())
  const crew = join(dir, 'crew')
  cpSync(join(dir, 'crew-log'), join(crew, 'crew-log'), { recursive: true })
  const log = join(crew, 'crew-log/sessions', `${SID}-5dafb4d6`, 'log.jsonl')
  appendFileSync(log, [{ type: 'subagent/spawned', time: NOW - 5, data: { agent_id: 'sub1', task: 'ui' } }, { type: 'subagent/completed', time: NOW - 1, data: { agent_id: 'sub1' } }].map(e => `${JSON.stringify(e)}\n`).join(''))
  const cache = new Map()
  assert.deepEqual(readKiro(crew, NOW, 60_000, cache)[0][1].files.edited, [])
  mkdirSync(join(crew, 'subagents/sub1'), { recursive: true })
  writeFileSync(join(crew, 'subagents/sub1/state.json'), JSON.stringify({ session_id: 'cli1' }))
  mkdirSync(join(dir, 'sessions/cli'), { recursive: true })
  writeFileSync(join(dir, 'sessions/cli/cli1.jsonl'), `${JSON.stringify({ kind: 'ToolResults', data: { content: [{ data: { toolUseId: 't', status: 'success' } }], results: { t: { tool: { kind: { BuiltIn: { FileWrite: { path: '/w/ui.js' } } } } } } } })}\n`)
  assert.deepEqual(readKiro(crew, NOW, 60_000, cache)[0][1].files.edited, ['/w/ui.js'])
})

test('a chat\'s test, lint, typecheck and build commands fill Verification', () => {
  const text = new Map([['t1', { what: 'npm test' }], ['t2', { what: 'timeout 60 npm test' }], ['t3', { what: 'npm test | tail -5' }], ['c1', { what: 'npm run lint && npx tsc --noEmit' }], ['l1', { what: 'ls tests' }]])
  const call = (id, time, extra = {}) => [{ type: 'tool/called', time, data: { call_id: id, name: '', kind: 'execute' } }, { type: 'tool/completed', time: time + 1, data: { call_id: id, elapsed_ms: 1, ...extra } }]
  const checks = log => foldCrewLog([entries[0], { type: 'turn/started', time: NOW - 100, data: {} }, ...log], NOW, text).snapshot.checks
  assert.deepEqual(checks([...call('l1', NOW - 90), ...call('t1', NOW - 80)]), [{ kind: 'test', command: 'npm test', who: 'main session', at: NOW - 80, result: 'ok' }])
  // A failed run keeps when the tests last passed, for "edited since the last passing run".
  assert.deepEqual(checks([...call('t1', NOW - 80), ...call('t2', NOW - 70, { is_error: true })]), [{ kind: 'test', command: 'timeout 60 npm test', who: 'main session', at: NOW - 70, result: 'failed', greenAt: NOW - 80 }])
  assert.deepEqual(checks(call('t3', NOW - 60)).map(c => c.result), ['unknown'])
  assert.deepEqual(checks(call('c1', NOW - 50, { status: 'failed' })).map(c => [c.kind, c.result, c.command]), [['lint', 'unknown', 'npm run lint'], ['typecheck', 'failed', 'npx tsc --noEmit']])
  assert.deepEqual(checks(call('l1', NOW - 40)), [])
  // Past `;` the shell reports the last line: only its check is known.
  text.set('s1', { what: 'npm test; npm run build' }).set('s2', { what: 'npm test; echo done' }).set('long', { what: `npm test ${'x'.repeat(292)}` })
  assert.deepEqual(checks(call('s1', NOW - 30)).map(c => [c.kind, c.result]), [['test', 'unknown'], ['build', 'ok']])
  assert.deepEqual(checks(call('s2', NOW - 20)).map(c => c.result), ['unknown'])
  // A command cut at 300 characters may hide a pipe past the cut.
  assert.deepEqual(checks(call('long', NOW - 10)).map(c => c.result), ['unknown'])
})

test('a call whose approval was rejected ran nothing: no check, no edit', () => {
  const text = new Map([['t1', { what: 'npm test' }], ['e1', { what: '/w/a.py', path: '/w/a.py' }]])
  const asked = (id, kind, time, decision) => [
    { type: 'tool/called', time, data: { call_id: id, name: '', kind } },
    { type: 'approval/requested', time: time + 1, data: { approval_id: `a-${id}`, reason: 'Running' } },
    { type: 'approval/decided', time: time + 2, data: { approval_id: `a-${id}`, decision } },
    { type: 'tool/completed', time: time + 3, data: { call_id: id, status: 'completed' } },
  ]
  const fold = decision => foldCrewLog([entries[0], { type: 'turn/started', time: NOW - 100, data: {} }, ...asked('t1', 'execute', NOW - 90, decision), ...asked('e1', 'edit', NOW - 80, decision)], NOW, text).snapshot
  assert.deepEqual([fold('rejected').checks, fold('rejected').files.edited], [[], []])
  assert.deepEqual([fold('approved').checks.map(c => c.result), fold('approved').files.edited], [['ok'], ['/w/a.py']])
  // Two calls open: the log does not say which one was rejected, so the check is unknown.
  const both = [
    { type: 'tool/called', time: NOW - 60, data: { call_id: 't1', name: '', kind: 'execute' } },
    { type: 'tool/called', time: NOW - 59, data: { call_id: 'e1', name: '', kind: 'edit' } },
    { type: 'approval/requested', time: NOW - 58, data: { approval_id: 'a', reason: 'Running' } },
    { type: 'approval/decided', time: NOW - 57, data: { approval_id: 'a', decision: 'rejected' } },
    { type: 'tool/completed', time: NOW - 56, data: { call_id: 't1', status: 'completed' } },
    { type: 'tool/completed', time: NOW - 55, data: { call_id: 'e1', status: 'completed' } },
  ]
  assert.deepEqual(foldCrewLog([entries[0], { type: 'turn/started', time: NOW - 100, data: {} }, ...both], NOW, text).snapshot.checks.map(c => c.result), ['unknown'])
})

test('the check patterns are the pane\'s, in hooks/format.ts', () => {
  const patterns = file => readFileSync(join(HERE, file), 'utf8').split('\n').filter(l => /^const RUN = |^  \['(?:typecheck|lint|test|build)', new RegExp\(/.test(l))
  assert.equal(patterns('../../server/kiro.mjs').length, 5)
  assert.deepEqual(patterns('../../server/kiro.mjs'), patterns('../../hooks/format.ts'))
  const wrappers = /^const WRAPPERS = \/\^(.+)\/$/m.exec(readFileSync(join(HERE, '../../server/kiro.mjs'), 'utf8'))?.[1]
  assert.ok(wrappers && readFileSync(join(HERE, '../../hooks/format.ts'), 'utf8').includes(wrappers), 'the wrappers skipped before a command differ from hooks/format.ts')
})

test("a chat's text is masked as the pane's, with the patterns of hooks/format.ts", () => {
  const lines = file => {
    const src = readFileSync(join(HERE, file), 'utf8').split('\n')
    const start = src.findIndex(l => /^export function mask\(/.test(l))
    return [...src.filter(l => /^const (?:SECRET_NAME|PREFIXED_SECRET|URL_CREDENTIALS|URL_TOKEN|SECRET_SHAPE|FLAG_SECRET|BARE_BEARER|PRIVATE_KEY) = \//.test(l)), ...src.slice(start + 1, src.indexOf('}', start))]
  }
  assert.equal(lines('../../server/kiro.mjs').length, 17)
  assert.deepEqual(lines('../../server/kiro.mjs'), lines('../../hooks/format.ts'))
  // Fake values, joined here so the source holds nothing a secret scanner takes for a key.
  const bearer = ['Bea', 'rer abc123', 'def456ghi789'].join('')
  const dir = home()
  mkdirSync(join(dir, 'sessions'))
  writeFileSync(join(dir, 'sessions/dashboard_chat-m.jsonl'), `${JSON.stringify({ role: 'tool', content: 'x', meta: { tool_call_id: 't1', input: JSON.stringify({ command: `curl -H "Authorization: ${bearer}" https://example.com && npm test` }) } })}\n`)
  const text = toolText(dir, 'chat-m')
  const log = [entries[0], { type: 'turn/started', time: NOW - 100, data: {} }, { type: 'tool/called', time: NOW - 90, data: { call_id: 't1', name: '', kind: 'execute' } }, { type: 'tool/completed', time: NOW - 89, data: { call_id: 't1' } }]
  const s = foldCrewLog(log, NOW, text).snapshot
  assert.equal(s.trace[0].what, 'curl -H "Authorization: Bearer ***" https://example.com && npm test')
  assert.deepEqual(s.checks.map(c => [c.kind, c.command]), [['test', 'npm test']])
  // An answer whose secret straddles the cut, and a subagent's task, are masked whole.
  const more = [
    { type: 'turn/started', time: NOW - 80, data: {} },
    { type: 'message/sent', time: NOW - 79, data: { text: `${'x'.repeat(3985)} Authorization: ${bearer}` } },
    { type: 'subagent/spawned', time: NOW - 78, data: { agent_id: 'sub1', agent: 'mate', task: `call it with Authorization: ${bearer}` } },
  ]
  const t = foldCrewLog([entries[0], ...more], NOW).snapshot
  assert.ok(!JSON.stringify(t).includes('abc123'), 'a secret reached the snapshot')
  assert.equal(t.turns.at(-1).answer.length, 4000)
})

test("a chat's thresholds are the pane's, in hooks/insights.ts", () => {
  const src = readFileSync(join(HERE, '../../hooks/insights.ts'), 'utf8')
  for (const name of ['LONG_CALL_MS', 'BIG_RESULT_TOKENS', 'WAIT_MIN_MS', 'WAIT_SHARE']) assert.equal(kiro[name], Number(new RegExp(`export const ${name} = ([\\d_.]+)`).exec(src)?.[1].replaceAll('_', '')), name)
})

test("a subagent read that fails after an earlier one keeps that one's files and is tried again", () => {
  const dir = home(open())
  const crew = join(dir, 'crew')
  cpSync(join(dir, 'crew-log'), join(crew, 'crew-log'), { recursive: true })
  mkdirSync(join(crew, 'subagents/sub1'), { recursive: true })
  writeFileSync(join(crew, 'subagents/sub1/state.json'), JSON.stringify({ session_id: 'cli1' }))
  mkdirSync(join(dir, 'sessions/cli'), { recursive: true })
  const wrote = path => `${JSON.stringify({ kind: 'ToolResults', data: { content: [{ data: { toolUseId: path, status: 'success' } }], results: { [path]: { tool: { kind: { BuiltIn: { FileWrite: { path } } } } } } } })}\n`
  writeFileSync(join(dir, 'sessions/cli/cli1.jsonl'), wrote('/w/a.js'))
  const log = join(crew, 'crew-log/sessions', `${SID}-5dafb4d6`, 'log.jsonl')
  appendFileSync(log, `${JSON.stringify({ type: 'subagent/spawned', time: NOW - 5, data: { agent_id: 'sub1', task: 'ui' } })}\n`)
  const cache = new Map()
  assert.deepEqual(readKiro(crew, NOW, 60_000, cache)[0][1].files.edited, ['/w/a.js'])
  // It ends while its state file is half written; its last write lands meanwhile.
  appendFileSync(join(dir, 'sessions/cli/cli1.jsonl'), wrote('/w/b.js'))
  writeFileSync(join(crew, 'subagents/sub1/state.json'), '{"session_')
  appendFileSync(log, `${JSON.stringify({ type: 'subagent/completed', time: NOW - 1, data: { agent_id: 'sub1' } })}\n`)
  assert.deepEqual(readKiro(crew, NOW, 60_000, cache)[0][1].files.edited, ['/w/a.js'])
  writeFileSync(join(crew, 'subagents/sub1/state.json'), JSON.stringify({ session_id: 'cli1' }))
  assert.deepEqual(readKiro(crew, NOW, 60_000, cache)[0][1].files.edited, ['/w/a.js', '/w/b.js'])
})

test('an approval asked with two calls open takes its wait off both, and counts it once', () => {
  const log = [
    entries[0],
    { type: 'turn/started', time: NOW - 100_000, data: {} },
    { type: 'tool/called', time: NOW - 100_000, data: { call_id: 'c1', kind: 'execute' } },
    { type: 'tool/called', time: NOW - 100_000, data: { call_id: 'c2', kind: 'read' } },
    { type: 'approval/requested', time: NOW - 100_000, data: { approval_id: 'a1', reason: 'Running: make' } },
    { type: 'approval/decided', time: NOW - 70_000, data: { approval_id: 'a1' } },
    { type: 'tool/completed', time: NOW - 65_000, data: { call_id: 'c1', elapsed_ms: 35_000 } },
    { type: 'tool/completed', time: NOW - 65_000, data: { call_id: 'c2', elapsed_ms: 35_000 } },
    { type: 'turn/completed', time: NOW - 60_000, data: { duration_ms: 40_000 } },
  ]
  const b = foldCrewLog(log, NOW).snapshot.turns[0].buckets
  assert.deepEqual([b.you, b.shell, b.read], [30_000, 5000, 5000])
})

test('a tool row whose input is not text keeps the rows after it', () => {
  const dir = home()
  mkdirSync(join(dir, 'sessions'))
  const rows = [{ role: 'tool', content: 'x', meta: { tool_call_id: 'o1', input: ['--- /w/a.py'] } }, { role: 'tool', content: 'y', meta: { tool_call_id: 'o2', input: '--- /w/b.py\n+++ /w/b.py' } }]
  writeFileSync(join(dir, 'sessions/dashboard_chat-9.jsonl'), rows.map(r => `${JSON.stringify(r)}\n`).join(''))
  assert.equal(toolText(dir, 'chat-9').get('o2')?.path, '/w/b.py')
})

test('a Kiro snapshot names the chat slot its crew log was opened for, and none when the log has none', () => {
  const withSlot = [{ ...entries[0], slot: 'chat-3-1794408878' }, ...entries.slice(1)]
  assert.equal(foldCrewLog(withSlot, NOW).snapshot.session.slot, 'chat-3-1794408878')
  const noSlot = [{ ...entries[0], slot: undefined }, ...entries.slice(1)]
  assert.equal('slot' in foldCrewLog(noSlot, NOW).snapshot.session, false)
})

test('a running subagent transcript is read from where the last read stopped, a half line waits, a rewrite starts over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentmon-kiro-'))
  const crew = join(dir, 'crew')
  mkdirSync(join(crew, 'subagents/sub1'), { recursive: true })
  writeFileSync(join(crew, 'subagents/sub1/state.json'), JSON.stringify({ session_id: 'cli1' }))
  mkdirSync(join(dir, 'sessions/cli'), { recursive: true })
  const file = join(dir, 'sessions/cli/cli1.jsonl')
  const wrote = path => `${JSON.stringify({ kind: 'ToolResults', data: { content: [{ data: { toolUseId: path, status: 'success' } }], results: { [path]: { tool: { kind: { BuiltIn: { FileWrite: { path } } } } } } } })}\n`
  const paths = got => got.edits.map(e => e.path)
  writeFileSync(file, wrote('/w/a.js') + wrote('/w/b.js').slice(0, 20))
  let got = kiro.subagentEdits(crew, 'sub1')
  assert.deepEqual(paths(got), ['/w/a.js'])
  appendFileSync(file, wrote('/w/b.js').slice(20))
  got = kiro.subagentEdits(crew, 'sub1', got)
  assert.deepEqual(paths(got), ['/w/a.js', '/w/b.js'])
  writeFileSync(file, wrote('/w/c.js'))
  assert.deepEqual(paths(kiro.subagentEdits(crew, 'sub1', got)), ['/w/c.js'])
})

test('the chat a tab sits beside is read even when closed: its newest log, and none for an unknown slot', () => {
  const dir = home()
  const slot = entries[0].slot
  const newer = 'aaaaaaaa-0000-4000-8000-000000000000'
  mkdirSync(join(dir, 'crew-log/sessions', `${newer}-1`), { recursive: true })
  writeFileSync(join(dir, 'crew-log/sessions', `${newer}-1`, 'log.jsonl'), `${JSON.stringify({ ...entries[0], id: newer, createdAt: entries[0].createdAt + 1 })}\n${JSON.stringify({ type: 'session/closed', time: NOW, data: { reason: 'reset' } })}\n`)
  assert.equal(readKiro(dir, NOW, 60_000).length, 0)
  const cache = new Map()
  const [id, snapshot] = kiro.readKiroSlot(dir, slot, NOW, cache)
  assert.deepEqual([id, snapshot.session.slot], [newer, slot])
  assert.equal(kiro.readKiroSlot(dir, 'chat-0-0', NOW, cache), undefined)
})

test('a closed chat a tab asks for is listed while the ask holds, and only to the page that may read', async () => {
  const dir = home()
  const port = 47472
  const token = 'd'.repeat(64)
  writeFileSync(join(dir, 'web.token'), token)
  const env = { ...process.env, KIROCREW_HOME: dir, CODEX_HOME: dir, AGENTMON_KIRO_FILE: join(dir, 'kiro.json'), AGENTMON_KIRO_POLL_MS: '50', AGENTMON_WEB_TOKEN_FILE: join(dir, 'web.token') }
  children.push(spawn(process.execPath, [join(HERE, '../../server/web.mjs'), 'serve', String(port)], { env, stdio: 'ignore' }))
  const ask = pass => new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port, path: `/kiro/${entries[0].slot}`, method: 'POST', headers: { origin: `http://127.0.0.1:${port}`, 'x-agentmon-pass': pass } }, res => res.resume().on('end', () => resolve(res.statusCode)))
    req.on('error', () => resolve(0))
    req.end()
  })
  let boot
  for (let i = 0; i < 60 && !boot; i += 1) {
    boot = await new Promise(resolve => request({ host: '127.0.0.1', port, path: '/health' }, res => {
      let text = ''
      res.on('data', d => (text += d)).on('end', () => resolve(JSON.parse(text).boot))
    }).on('error', () => setTimeout(() => resolve(undefined), 50)).end())
  }
  const pass = createHmac('sha256', token).update(`browser:${port}:${boot}`).digest('hex')
  assert.equal(await ask('wrong'), 403)
  assert.equal(await ask(pass), 204)
  const text = await events(port, t => t.includes(`"id":"${SID}"`), pass)
  assert.match(text, new RegExp(`"slot":"${entries[0].slot}"`))
})
