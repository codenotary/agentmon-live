// Dev only: serves the page and posts two changing sessions, to watch live motion without running Claude Code: `node scripts/web-demo.mjs [port]`.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.argv[2] ?? '47391'
const STEP_MS = 500
const CALL_EVERY = 5
const server = spawn(process.execPath, [join(ROOT, 'server/web.mjs'), 'serve', PORT], { stdio: 'inherit' })
process.on('SIGINT', () => {
  server.kill()
  process.exit(0)
})
await new Promise(done => setTimeout(done, 500))

const base = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/snapshot.json'), 'utf8'))
const COMMANDS = ['npm test', 'git status', 'npm run lint', 'tsc --noEmit', 'git diff --stat', 'npm run build']
const started = Date.now()
// Fixture times move with the clock, so the session looks as if it runs now.
const shift = started - base.now
const moved = at => at + shift
const session = (id, cwd, branch, costRate) => {
  const calls = base.calls.map(c => ({ ...c, at: moved(c.at) }))
  const usage = { ...base.usage }
  const trace = base.trace.map(c => ({ ...c, at: moved(c.at) }))
  return step => {
    const now = Date.now()
    if (step % CALL_EVERY === 0) {
      const isFail = step % (CALL_EVERY * 9) === 0
      trace.push({ id: `t${step}`, at: now, who: step % 3 ? 'main session' : 'tester', tool: 'Bash', what: COMMANDS[step % COMMANDS.length], ms: 200 + (step % 7) * 900, ...(isFail ? { isFailed: true, error: '1 failing' } : {}) })
      calls.push({ id: `c${step}`, at: now, who: step % 3 ? 'main session' : 'tester', view: 'shell', what: COMMANDS[step % COMMANDS.length], result: isFail ? 'failed' : 'ok', ...(isFail ? { error: '1 failing' } : {}) })
    }
    usage.usd += costRate
    usage.ctxPct = Math.min(99, 40 + Math.floor(step / 8))
    const focus = base.focus.filter(f => !f.isUrgent)
    if (step % (CALL_EVERY * 9) < CALL_EVERY * 4 && step > 0) focus.unshift({ key: `check:test:${Math.floor(step / (CALL_EVERY * 9))}`, tag: 'failed', text: 'tests npm test', isUrgent: true })
    return {
      ...base,
      session: { id, cwd, branch },
      now,
      focus,
      usage: { ...usage },
      calls: calls.slice(-60),
      trace: trace.slice(-200),
      main: { ...base.main, turnAt: moved(base.main.turnAt) },
      turns: base.turns.map(t => ({ ...t, startedAt: moved(t.startedAt), wallMs: t.isLive ? now - moved(t.startedAt) : t.wallMs })),
      active: base.active.map(a => ({ ...a, startedAt: moved(a.startedAt) })),
      agents: base.agents.map(a => ({ ...a, startedAt: moved(a.startedAt), ...(a.endedAt ? { endedAt: moved(a.endedAt) } : {}) })),
      checks: base.checks.map(c => ({ ...c, at: moved(c.at) })),
      log: [...base.log.map(x => ({ ...x, at: moved(x.at) })), ...calls.slice(-30).map(c => ({ at: c.at, who: c.who, what: c.what, result: c.result }))].slice(-50),
    }
  }
}
const sessions = [['demo-a', session('demo-a', '/home/dev/github/agent-radar', 'browser-screen', 0.01)], ['demo-b', session('demo-b', '/home/dev/github/other-project', 'main', 0.004)]]

let step = 0
setInterval(async () => {
  step += 1
  for (const [id, next] of sessions) {
    await fetch(`http://127.0.0.1:${PORT}/state/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next(step)) }).catch(() => {})
  }
}, STEP_MS)
console.log(`http://127.0.0.1:${PORT}/`)
