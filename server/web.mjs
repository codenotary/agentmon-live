// shortcut: a server left from an older plugin version serves its old page until it idles out; add a version handshake when the contract changes often.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { get, createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NAME = 'agentmon-live'
const MAX_BODY = 1024 * 1024
const PORT_TRIES = 20
const FONTS = [
  'dm-sans-latin-400-normal.woff2',
  'dm-sans-latin-700-normal.woff2',
  'manrope-latin-700-normal.woff2',
  'jetbrains-mono-latin-400-normal.woff2',
]
const HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
}

function envMs(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function reply(res, status, type, body) {
  res.writeHead(status, { ...HEADERS, ...(type ? { 'content-type': type } : {}) })
  res.end(body)
}

// A session and a browser tab each reach the server by these names only: a rebound domain carries its own.
function isOurHost(host, port) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

// A browser sends Origin on every POST and DELETE, and JSON from another site needs a preflight this server never answers.
function isWriteAllowed(req) {
  return req.headers.origin === undefined && (req.headers['content-type'] ?? '').split(';')[0].trim() === 'application/json'
}

function serve(port, fixture) {
  // In memory, so a plugin update that removes this folder leaves a running server whole.
  const page = readFileSync(join(HERE, 'app.html'))
  const fonts = new Map(FONTS.map(f => [f, readFileSync(join(HERE, 'fonts', f))]))
  const sessions = new Map()
  const clients = new Set()
  const ttlMs = envMs('AGENTMON_WEB_TTL_MS', 90_000)
  const idleMs = envMs('AGENTMON_WEB_IDLE_MS', 60_000)
  let idleSince = Date.now()

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`)
  const broadcast = (event, data) => {
    for (const res of clients) send(res, event, data)
  }
  const packed = (id, json) => `{"id":${JSON.stringify(id)},"snapshot":${json}}`
  const drop = id => {
    sessions.delete(id)
    if (sessions.size === 0) idleSince = Date.now()
    broadcast('removed', JSON.stringify({ id }))
  }

  if (fixture) sessions.set('fixture', { json: JSON.stringify(JSON.parse(readFileSync(fixture, 'utf8'))), at: Infinity })

  const server = createServer((req, res) => {
    if (!isOurHost(req.headers.host, port)) return reply(res, 403, 'text/plain', 'forbidden')
    const path = (req.url ?? '/').split('?')[0]

    if (req.method === 'GET') {
      if (path === '/') return reply(res, 200, 'text/html; charset=utf-8', page)
      if (path === '/health') return reply(res, 200, 'application/json', JSON.stringify({ name: NAME, pid: process.pid, sessions: sessions.size }))
      if (path.startsWith('/fonts/')) {
        const font = fonts.get(path.slice('/fonts/'.length))
        return font ? reply(res, 200, 'font/woff2', font) : reply(res, 404, 'text/plain', 'not found')
      }
      if (path === '/events') {
        res.writeHead(200, { ...HEADERS, 'content-type': 'text/event-stream' })
        for (const [id, s] of sessions) send(res, 'snapshot', packed(id, s.json))
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return undefined
      }
      return reply(res, 404, 'text/plain', 'not found')
    }

    const match = /^\/state\/([\w-]{1,80})$/.exec(path)
    if (req.method !== 'POST' && req.method !== 'DELETE') return reply(res, 405, 'text/plain', 'method not allowed')
    if (!isWriteAllowed(req)) return reply(res, 403, 'text/plain', 'forbidden')
    if (!match) return reply(res, 400, 'text/plain', 'bad session id')
    const id = match[1]

    if (req.method === 'DELETE') {
      drop(id)
      return reply(res, 204)
    }

    let size = 0
    const parts = []
    req.on('data', chunk => {
      size += chunk.length
      if (size <= MAX_BODY) parts.push(chunk)
    })
    req.on('end', () => {
      if (size > MAX_BODY) return reply(res, 413, 'text/plain', 'too large')
      let json
      try {
        json = JSON.stringify(JSON.parse(Buffer.concat(parts).toString('utf8')))
      } catch {
        return reply(res, 400, 'text/plain', 'bad json')
      }
      sessions.set(id, { json, at: Date.now() })
      broadcast('snapshot', packed(id, json))
      return reply(res, 204)
    })
    return undefined
  })

  // A crashed session sends no DELETE, so a silent one leaves by itself; the last one leaving ends the server.
  setInterval(() => {
    const now = Date.now()
    for (const [id, s] of sessions) if (now - s.at > ttlMs) drop(id)
    if (sessions.size === 0 && now - idleSince > idleMs) process.exit(0)
  }, envMs('AGENTMON_WEB_SWEEP_MS', 5000))
  setInterval(() => {
    for (const res of clients) res.write(': keep-alive\n\n')
  }, 15_000)

  server.on('error', () => process.exit(1))
  server.listen(port, '127.0.0.1')
}

function probe(port) {
  return new Promise(resolve => {
    const req = get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, res => {
      let text = ''
      res.on('data', d => (text += d))
      res.on('end', () => {
        try {
          resolve(JSON.parse(text).name === NAME ? 'ours' : 'other')
        } catch {
          resolve('other')
        }
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', e => resolve(e.code === 'ECONNREFUSED' ? 'free' : 'other'))
  })
}

// Detached with no pipes: the mod's `$.process.run` waits for this process's output to close, and the server outlives the session.
async function ensure(startPort) {
  for (let port = startPort; port < startPort + PORT_TRIES; port += 1) {
    let state = await probe(port)
    if (state === 'free') {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', String(port)], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      // Two sessions starting together: the loser's server exits on the taken port, and this probe finds the winner's.
      for (let i = 0; i < 60 && state === 'free'; i += 1) {
        await new Promise(done => setTimeout(done, 50))
        state = await probe(port)
      }
    }
    if (state === 'ours') {
      process.stdout.write(`${JSON.stringify({ port })}\n`)
      return 0
    }
  }
  return 1
}

// shortcut: success means the opener started, not that a browser appeared; wait for its exit if people report silent failures over SSH.
// The regex is what makes `cmd /c` safe here: it leaves no character the Windows shell would act on.
function open(url) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(url ?? '')) return Promise.resolve(2)
  const argv = process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : [process.platform === 'darwin' ? 'open' : 'xdg-open', url]
  return new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => resolve(1))
    child.on('spawn', () => {
      child.unref()
      resolve(0)
    })
  })
}

const [mode, arg, flag, fixture] = process.argv.slice(2)
if (mode === 'serve') serve(Number(arg), flag === '--fixture' ? fixture : undefined)
else if (mode === 'ensure') process.exit(await ensure(Number(arg)))
else if (mode === 'open') process.exit(await open(arg))
else process.exit(2)
