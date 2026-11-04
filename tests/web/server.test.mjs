import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { SHAPE } from '../fixtures/snapshot-shape.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../server/web.mjs')
const children = []

after(() => {
  for (const c of children) c.kill()
})

function startServer(port, env = {}) {
  const child = spawn(process.execPath, [WEB, 'serve', String(port)], { env: { ...process.env, ...env }, stdio: 'ignore' })
  children.push(child)
  return child
}

function call(port, path, { method = 'GET', headers = {}, body } = {}) {
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
function readEvents(port, isDone) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/events' }, res => {
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

test('fonts come from a fixed list, nothing else on disk', async () => {
  startServer(47412)
  await waitUp(47412)
  const font = await call(47412, '/fonts/dm-sans-latin-400-normal.woff2')
  assert.equal(font.status, 200)
  assert.equal(font.headers['content-type'], 'font/woff2')
  assert.equal((await call(47412, '/fonts/..%2Fweb.mjs')).status, 404)
  assert.equal((await call(47412, '/fonts/OFL-manrope.txt')).status, 404)
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

test('a snapshot over 1 MB is refused and not kept', async () => {
  startServer(47414)
  await waitUp(47414)
  assert.equal((await post(47414, 'big', { x: 'a'.repeat(1024 * 1024 + 1) })).status, 413)
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
  assert.deepEqual(JSON.parse(first.stdout), { port: 47430 })
  const second = spawnSync(process.execPath, [WEB, 'ensure', '47430'], { env, encoding: 'utf8', timeout: 8000 })
  assert.deepEqual(JSON.parse(second.stdout), { port: 47430 })
  assert.equal((await waitUp(47430)).status, 200)
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
  assert.deepEqual(JSON.parse(out), { port: 47441 })
})

test('open takes only a loopback address', () => {
  const r = spawnSync(process.execPath, [WEB, 'open', 'https://evil.example/'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
})

test('the page puts no tool text through HTML', () => {
  const page = readFileSync(join(dirname(WEB), 'app.html'), 'utf8')
  assert.doesNotMatch(page, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
})

test('the fixture the page is drawn from keeps the snapshot shape', () => {
  const fixture = JSON.parse(readFileSync(join(dirname(WEB), '../tests/fixtures/snapshot.json'), 'utf8'))
  const keys = o => Object.keys(o).sort()
  assert.deepEqual(keys(fixture), [...SHAPE.top].sort())
  for (const part of ['session', 'usage', 'insights', 'learned', 'labels']) assert.deepEqual(keys(fixture[part]), [...SHAPE[part]].sort())
  assert.deepEqual(keys(fixture.labels.page), [...SHAPE.page].sort())
})
