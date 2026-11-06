// Draws the README's web view pictures from a made-up session, one per section of the page's navigation: `node scripts/readme-shots.mjs` (setup as for web-shot.mjs, in docs/develop.md).
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs/web')
const PORT = '47392'
const url = `http://127.0.0.1:${PORT}/`
const raw = readFileSync(join(ROOT, 'tests/fixtures/snapshot.json'), 'utf8')
const base = JSON.parse(raw.replaceAll('agent-radar', 'shop-api').replaceAll('parser.test', 'coupon.test').replaceAll('parse(', 'round(').replaceAll('web.test', 'payment.test'))
const { version } = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
const NOW = base.now
const ago = seconds => NOW - seconds * 1000
const repo = name => `/home/dev/github/shop-api/${name}`

const TOOLS = [['Read', 'src/checkout/coupon.ts'], ['Grep', 'applyCoupon'], ['Read', 'src/checkout/total.ts'], ['Bash', 'npm test -- coupon'], ['Edit', 'src/checkout/coupon.ts'], ['Read', 'tests/coupon.test.ts']]
const AGENTS = [
  { id: 'map', type: 'Explore', model: 'haiku', task: 'Map the checkout', from: 108, to: 74, every: 4 },
  { id: 'callers', type: 'Explore', model: 'haiku', task: 'Find the callers', from: 106, to: 66, every: 6 },
  { id: 'review', type: 'reviewer', model: 'sonnet', task: 'Review the change', from: 62, to: 26, every: 5 },
  { id: 'tests', type: 'tester', model: 'sonnet', task: 'Run the tests', from: 60, to: 32, every: 4, failAt: 2, tests: 'FAIL', testsWhy: '2 failing: coupon rounds half down' },
  { id: 'fix', type: 'coder', model: 'opus', task: 'Fix the rounding bug', from: 30, every: 3 },
  { id: 'rerun', type: 'tester', model: 'sonnet', task: 'Run the tests again', from: 14, every: 3 },
]

const trace = []
const log = []
const MAIN = 'main session'
for (const [at, tool, what, ms, isFailed] of [[110, 'Read', 'README.md', 90], [109, 'Grep', 'coupon', 240], [72, 'Read', 'src/checkout/coupon.ts', 80], [70, 'Edit', 'src/checkout/coupon.ts', 310], [68, 'Bash', 'npx tsc --noEmit', 9000], [44, 'Read', 'tests/coupon.test.ts', 70], [24, 'Bash', 'git diff --stat', 200], [6, 'Read', 'src/checkout/total.ts', 90]]) {
  trace.push({ id: `m${at}`, at: ago(at), who: MAIN, tool, what, ms, ...(isFailed ? { isFailed } : {}) })
}
const agents = AGENTS.map((a, index) => {
  const end = a.to ?? 0
  const count = Math.floor((a.from - end) / a.every)
  trace.push({ id: `start-${a.id}`, at: ago(a.from + 1), who: MAIN, tool: 'Agent', what: a.task, ms: 800 })
  for (let i = 0; i < count; i += 1) {
    const [tool, what] = TOOLS[(i + index) % TOOLS.length]
    const isFailed = i === a.failAt
    const isLast = a.to === undefined && i === count - 1
    trace.push({ id: `${a.id}-${i}`, at: ago(a.from - i * a.every - 1), who: a.type, agentId: a.id, tool: isFailed ? 'Bash' : tool, what: isFailed ? 'npm test -- payment' : what, ...(isLast ? {} : { ms: 1500 + (i % 3) * 900 }), ...(isFailed ? { isFailed, error: 'exit 1' } : {}) })
  }
  log.push({ at: ago(a.from), who: a.type, what: a.task, result: 'started', agentId: a.id })
  if (a.tests) log.push({ at: ago(end + 1), who: a.type, what: 'Tests failed', result: `${a.tests} (reported)`, agentId: a.id })
  if (a.to !== undefined) log.push({ at: ago(a.to), who: a.type, what: 'done', result: `${index + 1} files · ${count} tools`, agentId: a.id })
  return {
    id: a.id, type: a.type, model: a.model, effort: '', task: a.task, status: a.to === undefined ? 'running' : 'done', files: a.to === undefined ? 1 : index + 1, tools: count,
    input: 42_000 + index * 31_000, output: 1800 + index * 700, cached: 30_000 + index * 20_000, usd: 0.08 + index * 0.21, startedAt: ago(a.from), callId: `start-${a.id}`, prompt: `${a.task}. Report what you find, with file and line.`,
    ...(a.to === undefined ? {} : { endedAt: ago(a.to) }), ...(a.tests ? { tests: a.tests, testsWhy: a.testsWhy, errors: 1 } : {}),
  }
})
trace.sort((x, y) => x.at - y.at)
const running = trace.filter(c => c.ms === undefined).map(c => ({ id: c.id, who: c.who, tool: c.tool, what: c.what, startedAt: c.at, agentId: c.agentId }))
const edited = { 'src/checkout/coupon.ts': [12, 4], 'tests/coupon.test.ts': [20, 2], 'src/checkout/total.ts': [130, 3], 'src/checkout/index.ts': [150, 1] }
const reads = { 'src/checkout/cart.ts': 5, 'README.md': 1, 'src/money.ts': 2, 'package.json': 1 }
const fromEntries = (list, f) => Object.fromEntries(Object.entries(list).map(([path, v]) => [repo(path), f(v)]))

const snapshot = {
  ...base,
  session: { id: 'readme', cwd: '/home/dev/github/shop-api', branch: 'fix-coupon-rounding' },
  build: version,
  focus: [
    { key: 'agent:tests:1', tag: 'FAIL', text: 'tester 2 failing: coupon rounds half down', isUrgent: true },
    { key: 'context:7', tag: 'context', text: 'Context is 38% full, and your sessions here compact near 70%.', isUrgent: false },
  ],
  usage: { ctxPct: 38, ctxTokens: 380_000, ctxWindow: 1_000_000, rate: [{ kind: 'five_hour', pct: 18, resetsAt: NOW + 3 * 3_600_000 }, { kind: 'seven_day', pct: 41, resetsAt: NOW + 4 * 86_400_000 }], usd: 3.12 },
  turns: [...base.turns.filter(t => !t.isLive), { startedAt: ago(112), wallMs: 112_000, buckets: { model: 46_000, agents: 52_000, shell: 9000, edit: 5000 }, isLive: true, prompt: 'Coupons round the wrong way at checkout, find out why and fix it' }],
  main: { ...base.main, turnAt: ago(112) },
  turnCount: 12,
  active: running,
  calls: [],
  trace,
  agents,
  checks: [{ kind: 'test', command: 'npm test', who: MAIN, at: ago(95), result: 'ok', ran: 214 }, { kind: 'typecheck', command: 'npx tsc --noEmit', who: MAIN, at: ago(68), result: 'ok' }, { kind: 'lint', command: 'npm run lint', who: MAIN, at: ago(300), result: 'ok' }],
  files: { read: Object.keys(reads).map(repo), edited: Object.keys(edited).map(repo), editedAt: ago(12), editedTimes: fromEntries(edited, ([at]) => ago(at)) },
  log: log.sort((x, y) => x.at - y.at),
  tasks: [{ id: '1', subject: 'Find why coupons round down', status: 'completed' }, { id: '2', subject: 'Fix the rounding', status: 'in_progress' }, { id: '3', subject: 'Run the payment tests', status: 'pending' }],
  insights: {
    ...base.insights,
    slow: [{ tool: 'Bash', what: 'npx tsc --noEmit', who: MAIN, ms: 9000, at: ago(68) }],
    big: [{ tool: 'Read', what: 'src/checkout/cart.ts', tokens: 14_000, at: ago(100) }],
    tokens: { mainIn: 2_400_000, mainOut: 41_000, mainCached: 2_230_000, agentsIn: 610_000, agentsOut: 18_000 },
    reads: fromEntries(reads, n => n),
    edits: fromEntries(edited, ([, n]) => n),
    sizes: { [repo('tests/coupon.test.ts')]: { now: 1800 }, [repo('src/checkout/coupon.ts')]: { first: 2600, now: 2750 } },
  },
}

const server = spawn(process.execPath, [join(ROOT, 'server/web.mjs'), 'serve', PORT], { stdio: 'inherit' })
process.on('exit', () => server.kill())
await new Promise(done => setTimeout(done, 500))
await fetch(`${url}state/readme`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot) })

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ colorScheme: 'dark', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
await page.goto(url)
await page.waitForSelector('[data-testid=instruments]')
// In a picture of one section, the bar that stays on top while scrolling would cover it.
await page.addStyleTag({ content: 'header { position: static !important; }' })
await page.waitForTimeout(800)
const problems = []
const shots = { band: '[data-testid=instruments]', flow: '#flow', overview: '.grid:has(#running)', calls: '#section-calls', verification: '#section-verification', agents: '#section-agents', files: '#section-files', log: '#section-log' }
for (const [name, selector] of Object.entries(shots)) {
  const where = page.locator(selector).first()
  if (await where.count() === 0) problems.push(`no ${selector}`)
  else await where.screenshot({ path: join(OUT, `${name}.png`) })
}
await browser.close()
server.kill()
console.log(problems.length ? problems.join('\n') : `drawn in ${OUT}`)
process.exitCode = problems.length ? 1 : 0
