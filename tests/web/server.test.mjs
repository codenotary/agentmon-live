import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { connect } from 'node:net'
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { SHAPE } from '../fixtures/snapshot-shape.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../server/web.mjs')
const children = []
// Every server and `ensure` these tests start reads this secret, not the account's own.
const TOKEN = 'ab'.repeat(32)
process.env.AGENTMON_WEB_TOKEN_FILE = join(mkdtempSync(join(tmpdir(), 'agentmon-token-')), 'web.token')
writeFileSync(process.env.AGENTMON_WEB_TOKEN_FILE, TOKEN)
// No server these tests start lists the Kiro Crew chats of whoever runs them.
process.env.KIROCREW_HOME = join(mkdtempSync(join(tmpdir(), 'agentmon-kiro-')), 'none')
process.env.AGENTMON_KIRO_FILE = join(process.env.KIROCREW_HOME, 'kiro.json')
const sign = text => createHmac('sha256', TOKEN).update(text).digest('hex')
// What a tab of this account holds: made for one port and one server run.
const passFor = (port, boot) => sign(`browser:${port}:${boot}`)
const runs = new Map()

function raw(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let text = ''
      res.on('data', d => (text += d))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

// A server run's key and mark, by the handshake `ensure` makes; none from a server that asks for no proof or is not ours.
async function runOf(port) {
  const { boot } = JSON.parse((await raw(port, '/health')).text)
  if (runs.get(port)?.boot === boot) return runs.get(port)
  const nonce = '12'.repeat(16)
  const r = await raw(port, '/key', { headers: { 'x-agentmon-nonce': nonce, 'x-agentmon-proof': sign(`client:${port}:${boot}:${nonce}`) } })
  const run = { boot, ...(r.status === 200 ? JSON.parse(r.text) : {}) }
  runs.set(port, run)
  return run
}

after(() => {
  for (const c of children) c.kill()
})

function startServer(port, env = {}) {
  const child = spawn(process.execPath, [WEB, 'serve', String(port)], { env: { ...process.env, ...env }, stdio: 'ignore' })
  children.push(child)
  return child
}

// As a session and a tab of this account would ask; a test that wants less passes empty headers over these.
async function call(port, path, { method = 'GET', headers = {}, body } = {}) {
  const run = path === '/health' ? {} : await runOf(port).catch(() => ({}))
  return raw(port, path, { method, headers: { 'x-agentmon-key': run.key ?? '', 'x-agentmon-pass': run.boot ? passFor(port, run.boot) : '', ...headers }, body })
}

async function waitUp(port) {
  for (let i = 0; i < 60; i += 1) {
    const r = await call(port, '/health').catch(() => undefined)
    if (r) return r
    await new Promise(done => setTimeout(done, 50))
  }
  throw new Error(`no server on ${port}`)
}

const post = (port, id, value, headers = {}) =>
  call(port, `/state/${id}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) })

// Reads an SSE stream until `isDone` holds for what came so far.
async function readEvents(port, isDone) {
  const pass = passFor(port, (await runOf(port)).boot)
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

test('health names the server and / serves the page with a strict policy', async () => {
  startServer(47411)
  const health = await waitUp(47411)
  assert.equal(JSON.parse(health.text).name, 'agentmon-live')
  const page = await call(47411, '/')
  assert.equal(page.status, 200)
  assert.match(page.headers['content-security-policy'], /default-src 'self'/)
  assert.equal(page.headers['x-content-type-options'], 'nosniff')
  assert.equal(page.headers['access-control-allow-origin'], undefined)
})

test('the page\'s files come from a fixed list, with a policy that lets them run', async () => {
  startServer(47500)
  await waitUp(47500)
  const policy = (await call(47500, '/')).headers['content-security-policy']
  assert.match(policy, /script-src 'self' 'sha256-[A-Za-z0-9+\/=]+';/)
  assert.match(policy, /frame-ancestors 'none'/)
  assert.match(policy, /style-src 'self'/)
  for (const [path, type] of [['/app.js', 'text/javascript'], ['/vendor.js', 'text/javascript'], ['/app.css', 'text/css']]) {
    const r = await call(47500, path)
    assert.equal(r.status, 200, path)
    assert.ok(r.headers['content-type'].startsWith(type), path)
  }
  assert.equal((await call(47500, '/web.mjs')).status, 404)
  assert.equal((await call(47500, '/app.html')).status, 404)
})

test('a client that stops reading is dropped, one that reads stays', async () => {
  startServer(47501)
  await waitUp(47501)
  const pass = passFor(47501, (await runOf(47501)).boot)
  const stuck = connect(47501, '127.0.0.1')
  stuck.write(`GET /events?p=${pass} HTTP/1.1\r\nHost: 127.0.0.1:47501\r\n\r\n`)
  stuck.pause()
  let isReaderClosed = false
  let last = ''
  const reader = request({ host: '127.0.0.1', port: 47501, path: `/events?p=${pass}` }, res => {
    res.on('data', d => (last = String(d).slice(-40)))
    res.on('close', () => (isReaderClosed = true))
  })
  reader.on('error', () => undefined)
  reader.end()
  await new Promise(done => setTimeout(done, 100))
  // Past what the kernel's socket buffers hold, and past the server's limit.
  const big = { fill: 'x'.repeat(900_000) }
  for (let i = 0; i < 40; i += 1) assert.equal((await post(47501, 'big', { ...big, i })).status, 204)
  const closed = new Promise(done => stuck.on('close', () => done(true)))
  stuck.on('error', () => undefined)
  stuck.resume()
  const isStuckClosed = await Promise.race([closed, new Promise(done => setTimeout(() => done(false), 3000))])
  stuck.destroy()
  assert.equal(isStuckClosed, true)
  assert.equal(isReaderClosed, false)
  await new Promise(done => setTimeout(done, 100))
  assert.match(last, /"i":39/)
  reader.destroy()
})

test('fonts come from a fixed list, nothing else on disk', async () => {
  startServer(47412)
  await waitUp(47412)
  const font = await call(47412, '/fonts/dm-sans-latin-400-normal.woff2')
  assert.equal(font.status, 200)
  assert.equal(font.headers['content-type'], 'font/woff2')
  assert.equal((await call(47412, '/fonts/..%2Fweb.mjs')).status, 404)
  assert.equal((await call(47412, '/fonts/OFL-manrope.txt')).status, 404)
})

test('a session that went silent is named so when it leaves', async () => {
  startServer(47503, { AGENTMON_WEB_TTL_MS: '150', AGENTMON_WEB_SWEEP_MS: '50' })
  await waitUp(47503)
  const seen = readEvents(47503, t => t.includes('event: removed'))
  await new Promise(done => setTimeout(done, 50))
  await post(47503, 's1', { v: 1 })
  assert.match(await seen, /event: removed\ndata: {"id":"s1","isSilent":true}/)
})

test('a replay says how old the snapshot is, a new post does not', async () => {
  startServer(47504)
  await waitUp(47504)
  await post(47504, 's1', { v: 1, n: 1 })
  await new Promise(done => setTimeout(done, 60))
  const seen = readEvents(47504, t => t.includes('"n":2'))
  await new Promise(done => setTimeout(done, 60))
  await post(47504, 's1', { v: 1, n: 2 })
  const text = await seen
  assert.ok(Number(/"n":1},"age":(\d+)}/.exec(text)?.[1]) >= 50)
  assert.match(text, /"n":2}}\n/)
})

test('the stream carries a ping the page can see, with data so that it dispatches', async () => {
  startServer(47502, { AGENTMON_WEB_PING_MS: '50' })
  await waitUp(47502)
  assert.match(await readEvents(47502, t => t.includes('event: ping')), /event: ping\ndata: 1\n\n/)
})

test('a posted snapshot replays on /events, a later one follows, DELETE says removed', async () => {
  startServer(47413)
  await waitUp(47413)
  assert.equal((await post(47413, 's1', { v: 1, n: 1 })).status, 204)
  const seen = readEvents(47413, text => text.includes('event: removed'))
  await new Promise(done => setTimeout(done, 100))
  await post(47413, 's1', { v: 1, n: 2 })
  assert.equal((await call(47413, '/state/s1', { method: 'DELETE', headers: { 'content-type': 'application/json' } })).status, 204)
  const text = await seen
  assert.match(text, /"n":1/)
  assert.match(text, /"n":2/)
  assert.match(text, /event: removed\ndata: {"id":"s1"}/)
})

test('a snapshot over 4 MB is refused and not kept', async () => {
  startServer(47414)
  await waitUp(47414)
  assert.equal((await post(47414, 'big', { x: 'a'.repeat(4 * 1024 * 1024 + 1) })).status, 413)
  assert.equal((await post(47414, 'ok', { v: 1 })).status, 204)
  const text = await readEvents(47414, t => t.includes('"ok"'))
  assert.doesNotMatch(text, /"big"/)
})

test('another Host is refused, on every route', async () => {
  startServer(47415)
  await waitUp(47415)
  assert.equal((await call(47415, '/', { headers: { host: 'evil.example' } })).status, 403)
  assert.equal((await call(47415, '/events', { headers: { host: 'evil.example:47415' } })).status, 403)
  assert.equal((await call(47415, '/health', { headers: { host: 'localhost:47415' } })).status, 200)
})

test('a web page cannot write: Origin or the wrong type is refused', async () => {
  startServer(47416)
  await waitUp(47416)
  assert.equal((await post(47416, 's', { v: 1 }, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await call(47416, '/state/s', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 403)
  assert.equal((await call(47416, '/state/s', { method: 'DELETE', headers: { 'content-type': 'application/json', origin: 'null' } })).status, 403)
})

test('the page asks for the pane, another site cannot, and the session takes it once', async () => {
  startServer(47419)
  await waitUp(47419)
  await post(47419, 's', { v: 1 })
  const ask = (path, origin) => call(47419, path, { method: 'POST', headers: origin ? { origin } : {} })
  const take = (headers = {}) => call(47419, '/pane/s', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })
  assert.equal((await ask('/pane/s/close', 'https://evil.example')).status, 403)
  assert.equal((await ask('/pane/s/close', 'null')).status, 403)
  assert.equal((await ask('/pane/s/close')).status, 403)
  assert.equal((await take()).status, 204)
  assert.equal((await take()).headers['x-clients'], '0')
  assert.equal((await call(47419, '/pane/unknown', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404)
  assert.equal((await ask('/pane/gone/close', 'http://127.0.0.1:47419')).status, 404)
  assert.equal((await ask('/pane/s/close', 'http://127.0.0.1:47419')).status, 204)
  assert.equal((await take({ origin: 'http://127.0.0.1:47419' })).status, 403)
  const r = await take()
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(r.text), { isOpen: false })
  assert.equal((await take()).status, 204)
})

test('a bad id or body is refused', async () => {
  startServer(47417)
  await waitUp(47417)
  assert.equal((await post(47417, 'a%2Fb', { v: 1 })).status, 400)
  assert.equal((await call(47417, '/state/s', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' })).status, 400)
  assert.equal((await post(47417, '__proto__', { v: 1 })).status, 204)
  const text = await readEvents(47417, t => t.includes('__proto__'))
  assert.match(text, /__proto__/)
})

test('a silent session drops and the idle server exits', async () => {
  const child = startServer(47418, { AGENTMON_WEB_TTL_MS: '150', AGENTMON_WEB_IDLE_MS: '150', AGENTMON_WEB_SWEEP_MS: '50' })
  await waitUp(47418)
  await post(47418, 's', { v: 1 })
  const code = await new Promise(done => child.on('exit', done))
  assert.equal(code, 0)
})

test('ensure starts one detached server; a second ensure finds it', async () => {
  const env = { ...process.env, AGENTMON_WEB_TTL_MS: '500', AGENTMON_WEB_IDLE_MS: '500', AGENTMON_WEB_SWEEP_MS: '100' }
  const first = spawnSync(process.execPath, [WEB, 'ensure', '47430'], { env, encoding: 'utf8', timeout: 8000 })
  assert.equal(first.status, 0)
  assert.equal(JSON.parse(first.stdout).port, 47430)
  const second = spawnSync(process.execPath, [WEB, 'ensure', '47430'], { env, encoding: 'utf8', timeout: 8000 })
  assert.equal(JSON.parse(second.stdout).port, 47430)
  assert.equal((await waitUp(47430)).status, 200)
})

test('three sessions starting at once share one server on one port', async () => {
  const env = { ...process.env, AGENTMON_WEB_TTL_MS: '500', AGENTMON_WEB_IDLE_MS: '500', AGENTMON_WEB_SWEEP_MS: '100' }
  const run = () => new Promise(done => {
    const child = spawn(process.execPath, [WEB, 'ensure', '47460'], { env, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.on('exit', code => done({ code, out }))
  })
  const all = await Promise.all([run(), run(), run()])
  assert.deepEqual(all.map(r => [r.code, JSON.parse(r.out).port]), [[0, 47460], [0, 47460], [0, 47460]])
  assert.equal(await call(47461, '/health').then(() => 'up', () => 'down'), 'down')
})

test('ensure moves past a port someone else holds', async () => {
  const foreign = createServer((_, res) => res.end('not ours'))
  await new Promise(done => foreign.listen(47440, '127.0.0.1', done))
  const env = { ...process.env, AGENTMON_WEB_TTL_MS: '500', AGENTMON_WEB_IDLE_MS: '500', AGENTMON_WEB_SWEEP_MS: '100' }
  // Not spawnSync: that would block this process, and the foreign server with it.
  const child = spawn(process.execPath, [WEB, 'ensure', '47440'], { env, stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  child.stdout.on('data', d => (out += d))
  const code = await new Promise(done => child.on('exit', done))
  foreign.close()
  assert.equal(code, 0)
  assert.equal(JSON.parse(out).port, 47441)
})

// The server folder with files from long ago, so the real one counts as newer.
function olderCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'agentmon-old-'))
  cpSync(dirname(WEB), dir, { recursive: true })
  const then = new Date('2020-01-01')
  for (const f of ['web.mjs', 'kiro.mjs', 'app.html']) utimesSync(join(dir, f), then, then)
  return join(dir, 'web.mjs')
}
const SHORT = { AGENTMON_WEB_TTL_MS: '500', AGENTMON_WEB_IDLE_MS: '500', AGENTMON_WEB_SWEEP_MS: '100' }

test('ensure from newer files replaces an older server, on the same port', async () => {
  const old = olderCopy()
  const child = spawn(process.execPath, [old, 'serve', '47450'], { stdio: 'ignore' })
  children.push(child)
  const before = JSON.parse((await waitUp(47450)).text)
  const gone = new Promise(done => child.on('exit', done))
  const r = spawnSync(process.execPath, [WEB, 'ensure', '47450'], { env: { ...process.env, ...SHORT }, encoding: 'utf8', timeout: 8000 })
  assert.equal(JSON.parse(r.stdout).port, 47450)
  assert.equal(await gone, 0)
  const after = JSON.parse((await waitUp(47450)).text)
  assert.notEqual(after.pid, before.pid)
  assert.ok(after.stamp > before.stamp)
  const text = await readEvents(47450, t => t.includes('event: build'))
  assert.match(text, new RegExp(`event: build\\ndata: ${after.stamp}`))
})

test('ensure from older files leaves a newer server alone', async () => {
  startServer(47451)
  const before = JSON.parse((await waitUp(47451)).text)
  const r = spawnSync(process.execPath, [olderCopy(), 'ensure', '47451'], { env: { ...process.env, ...SHORT }, encoding: 'utf8', timeout: 8000 })
  assert.equal(JSON.parse(r.stdout).port, 47451)
  assert.equal(JSON.parse((await waitUp(47451)).text).pid, before.pid)
})

test('a server from before the stamp keeps its port; ensure moves on', async () => {
  const legacy = createServer((_, res) => res.end(JSON.stringify({ name: 'agentmon-live', pid: 1, sessions: 0 })))
  await new Promise(done => legacy.listen(47452, '127.0.0.1', done))
  const child = spawn(process.execPath, [WEB, 'ensure', '47452'], { env: { ...process.env, ...SHORT }, stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  child.stdout.on('data', d => (out += d))
  const code = await new Promise(done => child.on('exit', done))
  legacy.close()
  assert.equal(code, 0)
  assert.equal(JSON.parse(out).port, 47453)
})

test('a web page cannot make the server quit', async () => {
  startServer(47454)
  await waitUp(47454)
  assert.equal((await call(47454, '/quit', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status, 403)
  assert.equal((await call(47454, '/quit', { method: 'POST', headers: { 'content-type': 'text/plain' } })).status, 403)
  assert.equal((await waitUp(47454)).status, 200)
})

test('open takes only a loopback address', () => {
  const r = spawnSync(process.execPath, [WEB, 'open', 'https://evil.example/'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
})

test('the page puts no tool text through HTML', () => {
  // The source, not the built page: react-dom's own code names these, and React escapes what the source hands it.
  const dir = join(dirname(WEB), '../web/src')
  const files = readdirSync(dir, { recursive: true }).filter(f => /\.tsx?$/.test(f))
  assert.ok(files.length > 0)
  for (const f of files) assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/i, f)
})

test('the fixture the page is drawn from keeps the snapshot shape', () => {
  const fixture = JSON.parse(readFileSync(join(dirname(WEB), '../tests/fixtures/snapshot.json'), 'utf8'))
  const keys = o => Object.keys(o).sort()
  assert.deepEqual(keys(fixture), [...SHAPE.top].sort())
  for (const part of ['session', 'usage', 'insights', 'learned', 'labels']) assert.deepEqual(keys(fixture[part]), [...SHAPE[part]].sort())
  assert.deepEqual(keys(fixture.labels.page), [...SHAPE.page].sort())
})

// Stand-ins on the PATH, so the test opens no real browser: `xdg-open` records the display it was given.
function fakeOpener(xdgBody, systemdOut) {
  const dir = mkdtempSync(join(tmpdir(), 'agentmon-open-'))
  const write = (name, body) => writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  write('xdg-open', xdgBody.replace('$OUT', join(dir, 'out')))
  write('systemctl', `printf '${systemdOut}'`)
  const { DISPLAY, WAYLAND_DISPLAY, ...env } = process.env
  return { dir, env: { ...env, PATH: dir } }
}

test('over SSH, open finds the desktop session\'s display', { skip: process.platform !== 'linux' }, () => {
  const { dir, env } = fakeOpener('echo "$DISPLAY" > $OUT', 'HOME=/x\\nDISPLAY=:77\\n')
  const r = spawnSync(process.execPath, [WEB, 'open', 'http://127.0.0.1:47311/'], { env, encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(readFileSync(join(dir, 'out'), 'utf8').trim(), ':77')
})

test('an opener that fails is reported, not taken for success', { skip: process.platform !== 'linux' }, () => {
  const { env } = fakeOpener('exit 3', '')
  const r = spawnSync(process.execPath, [WEB, 'open', 'http://127.0.0.1:47311/'], { env, encoding: 'utf8' })
  assert.equal(r.status, 1)
})

test('an opener that stays running counts as opened', { skip: process.platform !== 'linux' }, () => {
  const { env } = fakeOpener('/bin/sleep 5', '')
  const r = spawnSync(process.execPath, [WEB, 'open', 'http://127.0.0.1:47311/'], { env, encoding: 'utf8' })
  assert.equal(r.status, 0)
})

test('a new reader hears who is live before their snapshots', async () => {
  startServer(47423)
  await waitUp(47423)
  await post(47423, 'one', { v: 1 })
  const text = await readEvents(47423, t => t.includes('event: snapshot'))
  assert.ok(text.indexOf('event: sessions\ndata: ["one"]') >= 0)
  assert.ok(text.indexOf('event: sessions') < text.indexOf('event: snapshot'))
})

const NONE = { 'x-agentmon-key': '', 'x-agentmon-pass': '' }
const OWN = port => ({ origin: `http://127.0.0.1:${port}` })

test('without this run\'s key nobody posts or stops the server, and without the pass nobody reads', async () => {
  startServer(47424)
  await waitUp(47424)
  assert.equal((await post(47424, 's', { v: 1 }, NONE)).status, 403)
  assert.equal((await post(47424, 's', { v: 1 }, { 'x-agentmon-key': TOKEN })).status, 403)
  assert.equal((await call(47424, '/events', { headers: NONE })).status, 403)
  assert.equal((await call(47424, '/events?p=' + 'cd'.repeat(32), { headers: NONE })).status, 403)
  // A pass made for another port, and one from another run, as a program that took the port earlier would have caught it.
  const { boot } = await runOf(47424)
  assert.equal((await raw(47424, `/events?p=${passFor(47423, boot)}`)).status, 403)
  assert.equal((await raw(47424, `/events?p=${passFor(47424, '0'.repeat(32))}`)).status, 403)
  assert.equal((await call(47424, '/quit', { method: 'POST', headers: { 'content-type': 'application/json', ...NONE } })).status, 403)
  assert.equal((await call(47424, '/state/s', { method: 'DELETE', headers: { 'content-type': 'application/json', ...NONE } })).status, 403)
  assert.equal((await call(47424, '/pane/s/open', { method: 'POST', headers: { ...OWN(47424), 'x-agentmon-pass': '' } })).status, 403)
  // The page itself holds nothing to guard.
  assert.equal((await call(47424, '/', { headers: NONE })).status, 200)
  const taken = await post(47424, 's', { v: 1 })
  assert.equal(taken.status, 204)
  assert.equal(taken.headers['x-agentmon-mark'], (await runOf(47424)).mark)
  assert.equal((await post(47424, 's', { v: 1 }, NONE)).headers['x-agentmon-mark'], undefined)
})

test('the key goes only to who proves the secret, for this port and this run', async () => {
  startServer(47427)
  const { boot } = JSON.parse((await waitUp(47427)).text)
  const nonce = '34'.repeat(16)
  const ask = proof => raw(47427, '/key', { headers: { 'x-agentmon-nonce': nonce, 'x-agentmon-proof': proof } })
  assert.equal((await ask('')).status, 403)
  // A proof made for another port, as one relayed through a fake server would be, and one from another run.
  assert.equal((await ask(sign(`client:47428:${boot}:${nonce}`))).status, 403)
  assert.equal((await ask(sign(`client:47427:${'0'.repeat(32)}:${nonce}`))).status, 403)
  const r = await ask(sign(`client:47427:${boot}:${nonce}`))
  assert.equal(r.status, 200)
  const { key, mark, proof } = JSON.parse(r.text)
  assert.equal(proof, sign(`server:47427:${boot}:${nonce}:${key}:${mark}`))
  assert.doesNotMatch(r.text, new RegExp(TOKEN))
})

test('a tab of another account gets its pass only for a one-time code; one of this account needs none', async () => {
  startServer(47429, { AGENTMON_WEB_NO_UID: '1' })
  await waitUp(47429)
  const enter = (port, code) => call(port, '/enter', { method: 'POST', headers: { ...OWN(port), ...NONE, ...(code ? { 'x-agentmon-code': code } : {}) } })
  assert.equal((await enter(47429)).status, 403)
  assert.equal((await enter(47429, 'ab'.repeat(16))).status, 403)
  assert.equal((await call(47429, '/ticket', { method: 'POST', headers: { 'content-type': 'application/json', ...NONE }, body: '{}' })).status, 403)
  const { code } = JSON.parse((await call(47429, '/ticket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).text)
  assert.match(code, /^[0-9a-f]{32}$/)
  assert.equal((await call(47429, '/enter', { method: 'POST', headers: { ...NONE, 'x-agentmon-code': code } })).status, 403)
  const first = await enter(47429, code)
  assert.equal(first.status, 200)
  assert.equal(JSON.parse(first.text).pass, passFor(47429, (await runOf(47429)).boot))
  assert.equal((await enter(47429, code)).status, 403)
  if (process.platform !== 'linux') return
  startServer(47431)
  await waitUp(47431)
  assert.equal(JSON.parse((await enter(47431)).text).pass, passFor(47431, (await runOf(47431)).boot))
  assert.equal((await call(47431, '/ticket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).text, '{}')
})

test('ensure answers the run\'s key, not the secret, which it keeps in a file only the account reads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentmon-token-'))
  const file = join(dir, 'made', 'web.token')
  const r = spawnSync(process.execPath, [WEB, 'ensure', '47425'], { env: { ...process.env, AGENTMON_WEB_TOKEN_FILE: file, AGENTMON_WEB_IDLE_MS: '300', AGENTMON_WEB_SWEEP_MS: '50' }, encoding: 'utf8' })
  const { port, key, mark } = JSON.parse(r.stdout)
  const secret = readFileSync(file, 'utf8')
  assert.equal(port, 47425)
  assert.match(secret, /^[0-9a-f]{64}$/)
  assert.match(key, /^[0-9a-f]{64}$/)
  assert.match(mark, /^[0-9a-f]{64}$/)
  assert.doesNotMatch(r.stdout, new RegExp(secret))
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)
})

test('ensure moves past a server that calls itself ours but cannot prove the secret', async () => {
  const fake = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(req.url === '/health' ? JSON.stringify({ name: 'agentmon-live', stamp: 9e15, isLocked: true, boot: 'f'.repeat(32) }) : JSON.stringify({ key: 'a'.repeat(64), mark: 'b'.repeat(64), proof: 'c'.repeat(64) }))
  })
  await new Promise(done => fake.listen(47432, '127.0.0.1', done))
  const r = spawnSync(process.execPath, [WEB, 'ensure', '47432'], { env: { ...process.env, AGENTMON_WEB_IDLE_MS: '300', AGENTMON_WEB_SWEEP_MS: '50' }, encoding: 'utf8' })
  fake.close()
  fake.closeAllConnections()
  assert.equal(JSON.parse(r.stdout).port, 47433)
})

test('webToken off: the server asks for no proof and ensure needs no secret file; an ensure that wants proof replaces it, and one with off uses that server', async () => {
  const env = { ...process.env, AGENTMON_WEB_IDLE_MS: '2000', AGENTMON_WEB_SWEEP_MS: '50' }
  // A folder that cannot hold the file, as a home that cannot be written.
  const open = spawnSync(process.execPath, [WEB, 'ensure', '47426', '--open'], { env: { ...env, AGENTMON_WEB_TOKEN_FILE: '/dev/null/web.token' }, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(open.stdout), { port: 47426 })
  assert.equal(JSON.parse((await waitUp(47426)).text).isLocked, false)
  assert.equal((await post(47426, 's', { v: 1 }, NONE)).status, 204)
  assert.match(await readEvents(47426, t => t.includes('event: snapshot')), /"v":1/)
  assert.equal(spawnSync(process.execPath, [WEB, 'ensure', '47426'], { env, encoding: 'utf8' }).status, 0)
  const { isLocked, boot } = JSON.parse((await waitUp(47426)).text)
  assert.equal(isLocked, true)
  assert.equal((await post(47426, 's', { v: 1 }, NONE)).status, 403)
  // Replacing it back would make two sessions with different settings take turns at it.
  const off = JSON.parse(spawnSync(process.execPath, [WEB, 'ensure', '47426', '--open'], { env, encoding: 'utf8' }).stdout)
  assert.equal(off.port, 47426)
  assert.match(off.key, /^[0-9a-f]{64}$/)
  assert.equal(JSON.parse((await waitUp(47426)).text).boot, boot)
})

test('only an object is a snapshot, and one posted over several lines still arrives whole', async () => {
  startServer(47434)
  await waitUp(47434)
  const send = body => call(47434, '/state/s', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  for (const body of ['null', '[]', '1', '"x"']) assert.equal((await send(body)).status, 400, body)
  assert.equal((await send('{\n  "v": 1,\n\n  "n": 7\n}')).status, 204)
  const text = await readEvents(47434, t => t.includes('event: snapshot') && t.endsWith('\n\n'))
  assert.match(text, /data: {"id":"s","snapshot":{"v":1,"n":7},"age":\d+}\n\n$/)
})

test('on macOS the peer of a connection is the process lsof lists holding it from the other end', async () => {
  const { uidFromLsof } = await import('../../server/web.mjs')
  const pair = '127.0.0.1:52000->127.0.0.1:47311'
  const lsof = (...rows) => rows.map(([p, u, n]) => `p${p}\nu${u}\nf12\nn${n}\n`).join('')
  const server = [100, 501, '127.0.0.1:47311->127.0.0.1:52000']
  assert.equal(uidFromLsof(lsof(server, [200, 501, pair]), 100, pair), 501)
  assert.equal(uidFromLsof(lsof([200, 502, pair], server), 100, pair), 502)
  // Another account's browser is not listed to us: only this server shows, and that is no peer.
  assert.equal(uidFromLsof(lsof(server), 100, pair), undefined)
  // A process of ours on the same port but another connection (another account's listener it dialled) is no peer.
  assert.equal(uidFromLsof(lsof(server, [300, 501, '127.0.0.1:47999->127.0.0.1:52000']), 100, pair), undefined)
  assert.equal(uidFromLsof('lsof: status error\n', 100, pair), undefined)
  assert.equal(uidFromLsof('', 100, pair), undefined)
})
