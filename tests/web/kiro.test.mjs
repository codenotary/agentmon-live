import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

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
  const optional = new Set(['isPaneOpen', 'testReview', 'gate'])
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
    { type: 'subagent/failed', time: NOW - 2, data: { agent_id: 'sub2', outcome: 'failed' } },
    { type: 'plan/updated', time: NOW - 1, data: { items: [{ id: 1, text: 'count', state: 'done' }, { id: 2, text: 'report', state: 'open' }] } },
    { type: 'something/new', time: NOW, data: {} },
  ]
  const { snapshot: s, isLive } = foldCrewLog([...entries.slice(0, cutAt), ...more], NOW)
  assert.equal(isLive, true)
  assert.deepEqual([s.main.turnLive, s.turns[0].isLive, s.turnCount], [true, true, 0])
  assert.deepEqual(s.active.map(a => [a.tool, Boolean(a.isAsking)]), [['execute', false], ['shell', true]])
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
  assert.deepEqual([...cache.values()], [{ size: readFileSync(file).length, isDone: true }])
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
  const env = { ...process.env, KIROCREW_HOME: dir, AGENTMON_KIRO_FILE: join(dir, 'kiro.json'), AGENTMON_KIRO_POLL_MS: '50', AGENTMON_WEB_TOKEN_FILE: join(dir, 'web.token') }
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
