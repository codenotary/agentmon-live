import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { kiroHost, startOf } from '../../server/kiro.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const dir = mkdtempSync(join(tmpdir(), 'agentmon-kiro-app-'))
const children = []
after(() => {
  for (const c of children) c.kill()
})
const get = (port, path) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path }, res => res.resume().on('end', () => resolve(res)))
  req.on('error', reject)
  req.end()
})
const until = async (isDone, tries = 80) => {
  for (let i = 0; i < tries; i += 1) {
    if (await isDone()) return true
    await new Promise(done => setTimeout(done, 50))
  }
  return false
}

test('the host file counts only for a live gateway, and only loopback pages may frame', () => {
  const file = join(dir, 'host.json')
  writeFileSync(file, JSON.stringify({ pid: process.pid, origins: ['http://127.0.0.1:5476', 'http://localhost:5476', 'https://evil.example', 'http://127.0.0.1:5476/x', "http://127.0.0.1:1 'unsafe'"] }))
  assert.deepEqual(kiroHost(file), { pid: process.pid, origins: ['http://127.0.0.1:5476', 'http://localhost:5476'] })
  const gone = spawnSync(process.execPath, ['-e', '']).pid
  writeFileSync(file, JSON.stringify({ pid: gone, origins: ['http://127.0.0.1:5476'] }))
  assert.equal(kiroHost(file), undefined)
  // Another process that got the gateway's pid started at another time.
  writeFileSync(file, JSON.stringify({ pid: process.pid, start: 1, origins: ['http://127.0.0.1:5476'] }))
  assert.equal(kiroHost(file), process.platform === 'linux' ? undefined : { pid: process.pid, origins: ['http://127.0.0.1:5476'] })
  writeFileSync(file, 'not json')
  assert.equal(kiroHost(file), undefined)
  assert.equal(kiroHost(join(dir, 'none.json')), undefined)
})

test('a server asked for by a gateway may be framed by it and outlives its sessions, until the gateway is gone', async () => {
  const file = join(dir, 'kiro.json')
  const gateway = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  children.push(gateway)
  writeFileSync(file, JSON.stringify({ pid: gateway.pid, origins: ['http://127.0.0.1:5476'] }))
  const port = 47480
  const server = spawn(process.execPath, [join(ROOT, 'server/web.mjs'), 'serve', String(port), '--open'], { env: { ...process.env, AGENTMON_KIRO_FILE: file, KIROCREW_HOME: join(dir, 'none'), AGENTMON_WEB_IDLE_MS: '200', AGENTMON_WEB_SWEEP_MS: '100' }, stdio: 'ignore' })
  children.push(server)
  let exited = false
  server.on('exit', () => (exited = true))
  assert.ok(await until(() => get(port, '/health').then(() => true, () => false)))
  assert.match((await get(port, '/')).headers['content-security-policy'], /frame-ancestors http:\/\/127\.0\.0\.1:5476;/)
  await new Promise(done => setTimeout(done, 700))
  assert.equal(exited, false, 'no sessions, but the gateway runs')
  gateway.kill()
  assert.ok(await until(() => exited), 'the gateway is gone, so the idle rule applies again')
})

test('without a gateway no page may frame this one', async () => {
  const port = 47481
  children.push(spawn(process.execPath, [join(ROOT, 'server/web.mjs'), 'serve', String(port), '--open'], { env: { ...process.env, AGENTMON_KIRO_FILE: join(dir, 'none.json'), KIROCREW_HOME: join(dir, 'none') }, stdio: 'ignore' }))
  assert.ok(await until(() => get(port, '/health').then(() => true, () => false)))
  assert.match((await get(port, '/')).headers['content-security-policy'], /frame-ancestors 'none'/)
})

test('the Kiro Crew app names files that exist and carries the plugin version', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'))
  assert.equal(app.version, JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).version)
  for (const hook of Object.values(app.backend.hooks)) assert.ok(existsSync(join(ROOT, `${hook.split(':')[0].replaceAll('.', '/')}.py`)), hook)
  for (const entry of [app.ui.entry, ...app.contributes.panelTabs.map(t => t.entry)]) assert.ok(existsSync(join(ROOT, 'ui', entry)), entry)
  // Kiro Crew's store and library show these from the repo; a path that moved leaves a blank card.
  for (const art of [app.iconPath, app.heroImage, ...app.screenshots]) assert.ok(existsSync(join(ROOT, art)), art)
})

test('the start hook writes the host file and the stop hook removes only its own', { skip: spawnSync('python3', ['--version']).status !== 0 }, () => {
  const file = join(dir, 'hook.json')
  const run = code => spawnSync('python3', ['-c', `import importlib.util, sys\nspec = importlib.util.spec_from_file_location('h', ${JSON.stringify(join(ROOT, 'kiro/hooks.py'))})\nh = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(h)\n${code}`], { env: { ...process.env, AGENTMON_KIRO_FILE: file }, encoding: 'utf8' })
  const wrote = run('import os\nh.write_state(os.getpid(), h.gateway_port(["gw", "--port", "6000"]))\nprint(os.getpid())')
  assert.equal(wrote.status, 0, wrote.stderr)
  const { start, ...state } = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(state, { pid: Number(wrote.stdout), origins: ['http://127.0.0.1:6000', 'http://localhost:6000'] })
  assert.equal(typeof start, process.platform === 'linux' ? 'number' : 'undefined')
  // The hook writes a start time and the server reads one: both must mean the same for one process.
  assert.equal(Number(run(`print(h.start_of(${process.pid}))`).stdout) || undefined, startOf(process.pid))
  assert.equal(run('h.on_shutdown()').status, 0)
  assert.ok(existsSync(file), 'another process wrote it')
  writeFileSync(file, 'not json')
  assert.equal(run('h.on_shutdown()').status, 0)
  rmSync(file)
})
