import { spawn, spawnSync } from 'node:child_process'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, get, request } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NAME = 'agentmon-live'
// A snapshot at the publisher's caps is about 700 KB of characters; in Chinese or Japanese each takes three bytes.
const MAX_BODY = 4 * 1024 * 1024
const MAX_BACKLOG = 16 * 1024 * 1024
const PORT_TRIES = 20
const TOKEN = /^[0-9a-f]{64}$/
// How long the address a session hands out for the browser stays good.
const TICKET_MS = 5 * 60_000
const KEEP_TICKETS = 20
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
  'content-security-policy': '',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
}

// Which server is newer: file times, because a rebuild keeps the version and a total order stops two sessions replacing each other in turn.
function stampOfFiles() {
  return Math.max(statSync(join(HERE, 'app.html')).mtimeMs, statSync(fileURLToPath(import.meta.url)).mtimeMs)
}

// One secret per account, in a file only that account reads: another account's process on this machine can reach the port, not the sessions.
// It never leaves this file and the processes that read it: `ensure` and the server prove to each other that they hold it, and what a session or a tab sends is made for one server run or cannot be turned back into it.
// The same file whatever CLAUDE_CONFIG_DIR says, so sessions with different ones still share a server.
function readToken() {
  const path = process.env.AGENTMON_WEB_TOKEN_FILE || join(homedir(), '.claude', 'agentmon-live', 'web.token')
  const read = () => {
    try {
      return readFileSync(path, 'utf8').trim()
    } catch {
      return ''
    }
  }
  if (!TOKEN.test(read())) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    // Put in place whole: of two servers starting together, the second reads the first one's, never a half-written one.
    const draft = `${path}.${process.pid}`
    writeFileSync(draft, randomBytes(32).toString('hex'), { mode: 0o600 })
    try {
      linkSync(draft, path)
    } catch {
      if (!TOKEN.test(read())) renameSync(draft, path)
    }
    rmSync(draft, { force: true })
  }
  return read()
}

function isSame(given, token) {
  const [a, b] = [Buffer.from(String(given ?? '')), Buffer.from(token)]
  return a.length === b.length && timingSafeEqual(a, b)
}

const sign = (token, text) => createHmac('sha256', token).update(text).digest('hex')

// The account that holds the other end of a local connection, as the kernel lists it; undefined where it cannot be told (not Linux, or /proc closed).
// It is what lets a browser of the same account in with nothing to type or carry, also through an SSH port forward, whose end here is that account's sshd.
function peerUid(socket) {
  if (process.platform !== 'linux' || process.env.AGENTMON_WEB_NO_UID) return undefined
  const hex = n => n.toString(16).toUpperCase().padStart(4, '0')
  const ends = [hex(socket.remotePort), hex(socket.localPort)]
  try {
    for (const line of readFileSync('/proc/net/tcp', 'utf8').split('\n')) {
      const f = line.trim().split(/\s+/)
      // 127.0.0.1, as a little- or a big-endian machine prints it.
      if (/^(0100007F|7F000001):/.test(f[1] ?? '') && f[1].slice(9) === ends[0] && (f[2] ?? '').slice(9) === ends[1]) return Number(f[7])
    }
  } catch {
    return undefined
  }
  return undefined
}

function envMs(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function reply(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...HEADERS, ...extra, ...(type ? { 'content-type': type } : {}) })
  res.end(body)
}

const forbid = res => reply(res, 403, 'text/plain', 'forbidden')

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

function serve(port, fixture, isOpen) {
  const stamp = stampOfFiles()
  // The fixture is no one's session, and `webToken: off` asks for no proof.
  const isLocked = !fixture && !isOpen
  const token = isLocked ? readToken() : ''
  // Made for this run: `boot` names it in the proofs, a session sends `key` and expects `mark` back, so a server that took the port later gets no snapshot.
  const [boot, key, mark] = [16, 32, 32].map(n => randomBytes(n).toString('hex'))
  // What a tab keeps: good for this port and this run only, so a pass a tab sends to a program that took the port later opens no other run; no way back to the secret.
  const pass = isLocked ? sign(token, `browser:${port}:${boot}`) : ''
  const tickets = new Map()
  const isSession = (req, res) => {
    if (!isLocked) return true
    if (!isSame(req.headers['x-agentmon-key'], key)) return false
    res.setHeader('x-agentmon-mark', mark)
    return true
  }
  const isSessionWrite = (req, res) => isWriteAllowed(req) && isSession(req, res)
  const isReader = (req, query = '') => !isLocked || isSame(req.headers['x-agentmon-pass'] ?? new URLSearchParams(query).get('p'), pass)
  const isSameUser = req => {
    const uid = peerUid(req.socket)
    return uid !== undefined && uid === process.getuid()
  }
  // In memory, so a plugin update that removes this folder leaves a running server whole.
  const page = readFileSync(join(HERE, 'app.html'))
  // The page's own inline script (the theme, set before the first paint) runs by its hash; any other inline script does not.
  const inline = [...page.toString('utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`)
  HEADERS['content-security-policy'] = `default-src 'self'; script-src ${["'self'", ...inline].join(' ')}; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
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
  const packed = (id, json, age) => `{"id":${JSON.stringify(id)},"snapshot":${json}${age === undefined ? '' : `,"age":${age}`}}`
  const drop = (id, isSilent = false) => {
    sessions.delete(id)
    paneRequests.delete(id)
    if (sessions.size === 0) idleSince = Date.now()
    broadcast('removed', JSON.stringify(isSilent ? { id, isSilent } : { id }))
  }

  if (fixture) sessions.set('fixture', { json: JSON.stringify(JSON.parse(readFileSync(fixture, 'utf8'))), at: Infinity })

  const server = createServer((req, res) => {
    if (!isOurHost(req.headers.host, port)) return forbid(res)
    const [path, query = ''] = (req.url ?? '/').split('?')

    if (req.method === 'GET') {
      if (path === '/') return reply(res, 200, 'text/html; charset=utf-8', page)
      if (path === '/health') return reply(res, 200, 'application/json', JSON.stringify({ name: NAME, pid: process.pid, sessions: sessions.size, stamp, isLocked, boot }))
      // `ensure` proves it holds the secret and gets this run's key, with a proof that the server holds it too. The port and the run are in both proofs: one caught on another port, or from another run, is no use here.
      if (path === '/key') {
        const nonce = String(req.headers['x-agentmon-nonce'] ?? '')
        if (!isLocked || !/^[0-9a-f]{32}$/.test(nonce) || !isSame(req.headers['x-agentmon-proof'], sign(token, `client:${port}:${boot}:${nonce}`))) return forbid(res)
        return reply(res, 200, 'application/json', JSON.stringify({ key, mark, proof: sign(token, `server:${port}:${boot}:${nonce}:${key}:${mark}`) }))
      }
      const asset = assets.get(path)
      if (asset) return reply(res, 200, asset.type, asset.body)
      if (path.startsWith('/fonts/')) {
        const font = fonts.get(path.slice('/fonts/'.length))
        return font ? reply(res, 200, 'font/woff2', font) : reply(res, 404, 'text/plain', 'not found')
      }
      if (path === '/events') {
        if (!isReader(req, query)) return forbid(res)
        res.writeHead(200, { ...HEADERS, 'content-type': 'text/event-stream' })
        send(res, 'build', String(stamp))
        send(res, 'sessions', JSON.stringify([...sessions.keys()]))
        // A replay says how old it is: a dead session must not read as fresh to a tab that just connected. A fixture never ages.
        for (const [id, s] of sessions) send(res, 'snapshot', packed(id, s.json, s.at === Infinity ? undefined : Date.now() - s.at))
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return undefined
      }
      return reply(res, 404, 'text/plain', 'not found')
    }

    if (path === '/quit' && req.method === 'POST') {
      if (!isWriteAllowed(req) || (isLocked && !isSame(req.headers['x-agentmon-proof'], sign(token, `quit:${port}:${boot}`)))) return forbid(res)
      res.on('finish', () => process.exit(0))
      return reply(res, 204)
    }

    // A tab asks for its pass: given to a browser of this account, or for the one-time code in the address a session handed out.
    if (path === '/enter' && req.method === 'POST') {
      if (!isOwnPage(req, port)) return forbid(res)
      const code = String(req.headers['x-agentmon-code'] ?? '')
      const isInvited = tickets.get(code) > Date.now()
      tickets.delete(code)
      if (isLocked && !isInvited && !isSameUser(req)) return forbid(res)
      return reply(res, 200, 'application/json', JSON.stringify({ pass }))
    }
    // A session asks what the browser must open. Where the kernel names the account behind a connection, the plain address does; elsewhere it carries a code.
    // shortcut: that code shows in the opener's arguments, which other accounts can list, and whoever uses it first gets the pass; hand it over in a file if macOS or Windows machines are shared.
    if (path === '/ticket' && req.method === 'POST') {
      if (!isSessionWrite(req, res)) return forbid(res)
      if (!isLocked || isSameUser(req)) return reply(res, 200, 'application/json', '{}')
      const now = Date.now()
      for (const [c, until] of tickets) if (until <= now || tickets.size >= KEEP_TICKETS) tickets.delete(c)
      const code = randomBytes(16).toString('hex')
      tickets.set(code, now + TICKET_MS)
      return reply(res, 200, 'application/json', JSON.stringify({ code }))
    }

    const asked = path.match(/^\/pane\/([\w-]{1,80})\/(open|close)$/)
    if (asked && req.method === 'POST') {
      if (!isOwnPage(req, port) || !isReader(req, query)) return forbid(res)
      if (!sessions.has(asked[1])) return reply(res, 404, 'text/plain', 'not found')
      paneRequests.set(asked[1], asked[2] === 'open')
      return reply(res, 204)
    }
    const taken = path.match(/^\/pane\/([\w-]{1,80})$/)
    if (taken && req.method === 'POST') {
      if (!isSessionWrite(req, res)) return forbid(res)
      if (!sessions.has(taken[1])) return reply(res, 404)
      const isPaneOpen = paneRequests.get(taken[1])
      paneRequests.delete(taken[1])
      // The count lets a session with no tab to draw for spare its work. A header, because an older session takes any 200 for a pane request.
      const seen = { 'x-clients': String(clients.size) }
      return isPaneOpen === undefined ? reply(res, 204, undefined, undefined, seen) : reply(res, 200, 'application/json', JSON.stringify({ isOpen: isPaneOpen }), seen)
    }

    const match = /^\/state\/([\w-]{1,80})$/.exec(path)
    if (req.method !== 'POST' && req.method !== 'DELETE') return reply(res, 405, 'text/plain', 'method not allowed')
    if (!isSessionWrite(req, res)) return forbid(res)
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
        const value = JSON.parse(Buffer.concat(parts).toString('utf8'))
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('no snapshot')
        // Written again: a line break in what was posted would end the event it is sent in.
        json = JSON.stringify(value)
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
    for (const [id, s] of sessions) if (now - s.at > ttlMs) drop(id, true)
    if (sessions.size === 0 && now - idleSince > idleMs) process.exit(0)
  }, envMs('AGENTMON_WEB_SWEEP_MS', 5000))
  // A named event, not an SSE comment: the page must see it to notice a connection that hangs without closing. Empty data would not dispatch.
  setInterval(() => broadcast('ping', '1'), envMs('AGENTMON_WEB_PING_MS', 15_000))

  server.on('error', () => process.exit(1))
  server.listen(port, '127.0.0.1')
}

// A local JSON GET with a size cap: the port may be held by anything. `code` is why nothing answered.
// No shared agent: a kept-alive socket to a server that just quit would read as a port someone else holds.
function getJson(port, path, headers = {}) {
  return new Promise(resolve => {
    const req = get({ host: '127.0.0.1', port, path, headers, timeout: 1000, agent: false }, res => {
      let text = ''
      res.on('data', d => {
        text += d
        if (text.length > 65_536) req.destroy()
      })
      res.on('end', () => {
        try {
          resolve({ json: JSON.parse(text) })
        } catch {
          resolve({})
        }
      })
      res.on('close', () => resolve({}))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', e => resolve({ code: e.code }))
  })
}

async function probe(port) {
  const { json, code } = await getJson(port, '/health')
  const { name, stamp, isLocked, boot } = json ?? {}
  // A server from before the stamp cannot be told to quit: leave it to idle out, on its port.
  if (name === NAME && typeof stamp === 'number') return { state: 'ours', stamp, isLocked, boot: String(boot ?? '') }
  return { state: code === 'ECONNREFUSED' ? 'free' : 'other' }
}

// This run's key and mark, from a server that proved it holds the account's secret; undefined from any other.
async function handshake(port, boot, token) {
  const nonce = randomBytes(16).toString('hex')
  const { json } = await getJson(port, '/key', { 'x-agentmon-nonce': nonce, 'x-agentmon-proof': sign(token, `client:${port}:${boot}:${nonce}`) })
  const { key, mark, proof } = json ?? {}
  return TOKEN.test(key) && TOKEN.test(mark) && isSame(proof, sign(token, `server:${port}:${boot}:${nonce}:${key}:${mark}`)) ? { key, mark } : undefined
}

function askToQuit(port, boot, token) {
  return new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port, path: '/quit', method: 'POST', headers: { 'content-type': 'application/json', 'x-agentmon-proof': sign(token, `quit:${port}:${boot}`) }, timeout: 1000, agent: false }, res => {
      res.resume()
      res.on('end', resolve)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', resolve)
    req.end('{}')
  })
}

// Detached with no pipes: the mod's `$.process.run` waits for this process's output to close, and the server outlives the session.
async function ensure(startPort, isOpen) {
  const mine = stampOfFiles()
  // Read only when a server asks for proof: `webToken: off` works in a home that cannot be written.
  let token
  const secret = () => {
    try {
      return (token ??= readToken())
    } catch (error) {
      process.stderr.write(`agentmon-live: no secret for the web view (${error.message}); set webToken to off, or make ~/.claude/agentmon-live writable\n`)
      return ''
    }
  }
  // Older files, or these files serving with no checks to a session that wants them; a session with `webToken: off` uses a checking server, so two settings never take turns replacing it.
  const isOlder = found => found.state === 'ours' && (found.stamp < mine || (found.stamp === mine && !found.isLocked && !isOpen))
  for (let port = startPort; port < startPort + PORT_TRIES; port += 1) {
    let found = await probe(port)
    // shortcut: an older session that finds the port free in this gap can win it; the next ensure from a newer session replaces that server.
    if (isOlder(found)) {
      await askToQuit(port, found.boot, secret())
      for (let i = 0; i < 60 && isOlder(found); i += 1) {
        await new Promise(done => setTimeout(done, 50))
        found = await probe(port)
      }
    }
    if (found.state === 'free') {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', String(port), ...(isOpen ? ['--open'] : [])], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      // Two sessions starting together: the loser's server exits on the taken port, and this probe finds the winner's.
      for (let i = 0; i < 60 && found.state === 'free'; i += 1) {
        await new Promise(done => setTimeout(done, 50))
        found = await probe(port)
      }
      // Still free: our server is slow to start, not refused. Trying the next port would start a second one beside it; the session retries.
      if (found.state === 'free') return 1
    }
    if (found.state === 'ours') {
      // A server that asks for no proof when one is wanted, or cannot give its own, is someone else's, whatever it calls itself: the next port.
      if (!isOpen && !found.isLocked) continue
      const run = found.isLocked ? secret() && (await handshake(port, found.boot, secret())) : {}
      if (!run) continue
      process.stdout.write(`${JSON.stringify({ port, ...run })}\n`)
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
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/?(\?c=[0-9a-f]{32})?$/.test(url ?? '')) return Promise.resolve(2)
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

const [mode, arg, ...flags] = process.argv.slice(2)
const isOpen = flags.includes('--open')
if (mode === 'serve') serve(Number(arg), flags[0] === '--fixture' ? flags[1] : undefined, isOpen)
else if (mode === 'ensure') process.exit(await ensure(Number(arg), isOpen))
else if (mode === 'open') process.exit(await open(arg))
else process.exit(2)
