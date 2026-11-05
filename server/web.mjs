import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { createServer, get, request } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NAME = 'agentmon-live'
const MAX_BODY = 1024 * 1024
const MAX_BACKLOG = 8 * 1024 * 1024
const PORT_TRIES = 20
const FONTS = [
  'dm-sans-latin-400-normal.woff2',
  'dm-sans-latin-500-normal.woff2',
  'dm-sans-latin-600-normal.woff2',
  'dm-sans-latin-700-normal.woff2',
  'manrope-latin-700-normal.woff2',
  'jetbrains-mono-latin-400-normal.woff2',
]
// shortcut: a reload during a server takeover can leave a blank tab, add a load-error retry if people hit it.
const ASSETS = {
  '/app.js': 'text/javascript; charset=utf-8',
  '/vendor.js': 'text/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
}
const HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
}

// Which server is newer: file times, because a rebuild keeps the version and a total order stops two sessions replacing each other in turn.
function stampOfFiles() {
  return Math.max(statSync(join(HERE, 'app.html')).mtimeMs, statSync(fileURLToPath(import.meta.url)).mtimeMs)
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

// The page's own button: a browser always sends Origin on a POST, and another site's is not one of these.
function isOwnPage(req, port) {
  return req.headers.origin === `http://127.0.0.1:${port}` || req.headers.origin === `http://localhost:${port}`
}

function serve(port, fixture) {
  const stamp = stampOfFiles()
  // In memory, so a plugin update that removes this folder leaves a running server whole.
  const page = readFileSync(join(HERE, 'app.html'))
  const assets = new Map(Object.entries(ASSETS).map(([path, type]) => [path, { type, body: readFileSync(join(HERE, path)) }]))
  const fonts = new Map(FONTS.map(f => [f, readFileSync(join(HERE, 'fonts', f))]))
  const sessions = new Map()
  const paneRequests = new Map()
  const clients = new Set()
  const ttlMs = envMs('AGENTMON_WEB_TTL_MS', 90_000)
  const idleMs = envMs('AGENTMON_WEB_IDLE_MS', 60_000)
  let idleSince = Date.now()

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`)
  const broadcast = (event, data) => {
    for (const res of clients) {
      // A tab that stopped reading would make this queue grow without end. Dropped, its EventSource reconnects once it wakes and gets every session again.
      if (res.writableLength > MAX_BACKLOG) res.destroy()
      else send(res, event, data)
    }
  }
  const packed = (id, json) => `{"id":${JSON.stringify(id)},"snapshot":${json}}`
  const drop = id => {
    sessions.delete(id)
    paneRequests.delete(id)
    if (sessions.size === 0) idleSince = Date.now()
    broadcast('removed', JSON.stringify({ id }))
  }

  if (fixture) sessions.set('fixture', { json: JSON.stringify(JSON.parse(readFileSync(fixture, 'utf8'))), at: Infinity })

  const server = createServer((req, res) => {
    if (!isOurHost(req.headers.host, port)) return reply(res, 403, 'text/plain', 'forbidden')
    const path = (req.url ?? '/').split('?')[0]

    if (req.method === 'GET') {
      if (path === '/') return reply(res, 200, 'text/html; charset=utf-8', page)
      if (path === '/health') return reply(res, 200, 'application/json', JSON.stringify({ name: NAME, pid: process.pid, sessions: sessions.size, stamp }))
      const asset = assets.get(path)
      if (asset) return reply(res, 200, asset.type, asset.body)
      if (path.startsWith('/fonts/')) {
        const font = fonts.get(path.slice('/fonts/'.length))
        return font ? reply(res, 200, 'font/woff2', font) : reply(res, 404, 'text/plain', 'not found')
      }
      if (path === '/events') {
        res.writeHead(200, { ...HEADERS, 'content-type': 'text/event-stream' })
        send(res, 'build', String(stamp))
        for (const [id, s] of sessions) send(res, 'snapshot', packed(id, s.json))
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return undefined
      }
      return reply(res, 404, 'text/plain', 'not found')
    }

    if (path === '/quit' && req.method === 'POST') {
      if (!isWriteAllowed(req)) return reply(res, 403, 'text/plain', 'forbidden')
      res.on('finish', () => process.exit(0))
      return reply(res, 204)
    }

    const asked = path.match(/^\/pane\/([\w-]{1,80})\/(open|close)$/)
    if (asked && req.method === 'POST') {
      if (!isOwnPage(req, port)) return reply(res, 403, 'text/plain', 'forbidden')
      if (!sessions.has(asked[1])) return reply(res, 404, 'text/plain', 'not found')
      paneRequests.set(asked[1], asked[2] === 'open')
      return reply(res, 204)
    }
    const taken = path.match(/^\/pane\/([\w-]{1,80})$/)
    if (taken && req.method === 'POST') {
      if (!isWriteAllowed(req)) return reply(res, 403, 'text/plain', 'forbidden')
      const isOpen = paneRequests.get(taken[1])
      paneRequests.delete(taken[1])
      return isOpen === undefined ? reply(res, 204) : reply(res, 200, 'application/json', JSON.stringify({ isOpen }))
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

// No shared agent: a kept-alive socket to a server that just quit would read as a port someone else holds.
function probe(port) {
  return new Promise(resolve => {
    const req = get({ host: '127.0.0.1', port, path: '/health', timeout: 1000, agent: false }, res => {
      let text = ''
      res.on('data', d => (text += d))
      res.on('end', () => {
        try {
          const { name, stamp } = JSON.parse(text)
          // A server from before the stamp cannot be told to quit: leave it to idle out, on its port.
          resolve(name === NAME && typeof stamp === 'number' ? { state: 'ours', stamp } : { state: 'other' })
        } catch {
          resolve({ state: 'other' })
        }
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', e => resolve({ state: e.code === 'ECONNREFUSED' ? 'free' : 'other' }))
  })
}

function askToQuit(port) {
  return new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port, path: '/quit', method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 1000, agent: false }, res => {
      res.resume()
      res.on('end', resolve)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', resolve)
    req.end('{}')
  })
}

// Detached with no pipes: the mod's `$.process.run` waits for this process's output to close, and the server outlives the session.
async function ensure(startPort) {
  const mine = stampOfFiles()
  const isOlder = found => found.state === 'ours' && found.stamp < mine
  for (let port = startPort; port < startPort + PORT_TRIES; port += 1) {
    let found = await probe(port)
    // shortcut: an older session that finds the port free in this gap can win it; the next ensure from a newer session replaces that server.
    if (isOlder(found)) {
      await askToQuit(port)
      for (let i = 0; i < 60 && isOlder(found); i += 1) {
        await new Promise(done => setTimeout(done, 50))
        found = await probe(port)
      }
    }
    if (found.state === 'free') {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', String(port)], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      // Two sessions starting together: the loser's server exits on the taken port, and this probe finds the winner's.
      for (let i = 0; i < 60 && found.state === 'free'; i += 1) {
        await new Promise(done => setTimeout(done, 50))
        found = await probe(port)
      }
    }
    if (found.state === 'ours') {
      process.stdout.write(`${JSON.stringify({ port })}\n`)
      return 0
    }
  }
  return 1
}

// An SSH shell has no DISPLAY even when the person has a desktop session on this machine; systemd knows that session's.
function desktopEnv() {
  if (process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return process.env
  const { stdout } = spawnSync('systemctl', ['--user', 'show-environment'], { encoding: 'utf8', timeout: 2000 })
  const found = (stdout ?? '').split('\n').map(line => /^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY)=(.*)$/.exec(line)).filter(Boolean)
  return { ...process.env, ...Object.fromEntries(found.map(m => [m[1], m[2]])) }
}

// The regex is what makes `cmd /c` safe here: it leaves no character the Windows shell would act on.
function open(url) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(url ?? '')) return Promise.resolve(2)
  const argv = process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : [process.platform === 'darwin' ? 'open' : 'xdg-open', url]
  return new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: true, env: desktopEnv() })
    child.on('error', () => resolve(1))
    child.on('exit', code => resolve(code === 0 ? 0 : 1))
    child.unref()
    // An opener that starts the browser itself stays until the browser closes; one that failed has exited by now.
    setTimeout(() => resolve(0), 2000)
  })
}

const [mode, arg, flag, fixture] = process.argv.slice(2)
if (mode === 'serve') serve(Number(arg), flag === '--fixture' ? fixture : undefined)
else if (mode === 'ensure') process.exit(await ensure(Number(arg)))
else if (mode === 'open') process.exit(await open(arg))
else process.exit(2)
