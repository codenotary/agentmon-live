import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionUsage } from 'claude-code'

import type { Active, Call, Card, Check, Files, Insights, Learned, LogLine, Main, Task, TestReview, TraceCall, TurnTime, WebFocus, WebSnapshot, WebTurn } from '../types'
import { debug } from './debuglog'
import type { Strings } from './i18n'
import type { Insight } from './insights'
import { bucketName, focusList, liveBuckets } from './insights'
import { learnedItems } from './learn'
import { droppedLines } from './testreview'
import { cfg, INIT, liveStatus, liveTurn, PANE, shapeInsights } from './state'

const main = atom({ plugin: 'agentmon-live', key: 'main' } as const, INIT.main)
const agents = atom({ plugin: 'agentmon-live', key: 'agents' } as const, INIT.agents)
const log = atom({ plugin: 'agentmon-live', key: 'log' } as const, INIT.log)
const stats = atom({ plugin: 'agentmon-live', key: 'stats' } as const, INIT.stats)
const calls = atom({ plugin: 'agentmon-live', key: 'calls' } as const, INIT.calls)
const trace = atom({ plugin: 'agentmon-live', key: 'trace' } as const, INIT.trace)
const testReview = atom({ plugin: 'agentmon-live', key: 'testReview' } as const, INIT.testReview)
const active = atom({ plugin: 'agentmon-live', key: 'active' } as const, INIT.active)
const checks = atom({ plugin: 'agentmon-live', key: 'checks' } as const, INIT.checks)
const files = atom({ plugin: 'agentmon-live', key: 'files' } as const, INIT.files)
const layout = atom({ plugin: 'agentmon-live', key: 'layout' } as const, INIT.layout)
const tasks = atom({ plugin: 'agentmon-live', key: 'tasks' } as const, INIT.tasks)
const insights = atom({ plugin: 'agentmon-live', key: 'insights' } as const, INIT.insights)
const learned = atom({ plugin: 'agentmon-live', key: 'learned' } as const, INIT.learned)

const PUBLISH_MS = 500
// Well inside the server's 90 s, so a quiet session is not taken for a crashed one.
const HEARTBEAT_MS = 30_000
const ENSURE_EVERY_MS = 60_000
const KEEP_TURNS = 50
const KEEP_FILES = 50
const KEEP_BENCH_ROWS = 10

export type SnapshotParts = {
  session: WebSnapshot['session']
  now: number
  main: Main
  usage: SessionUsage
  ins: Insights
  turnRing: WebTurn[]
  doing: Active[]
  calls: Call[]
  agents: Card[]
  checks: Check[]
  files: Files
  log: LogLine[]
  tasks: Task[]
  streak: number
  dismissed: string[]
  learned: Learned
  focus: Insight[]
  t: Strings
  lang: string
  isPaneOpen: boolean
  build: string
  testReview: TestReview
  trace: TraceCall[]
}

// The pane's list of what needs the person, in its order and with its keys, so a dismissal holds on both surfaces.
function urgentItems(p: SnapshotParts): WebFocus[] {
  const { t } = p
  const items: (WebFocus & { key: string })[] = [
    ...p.doing.filter(a => a.isAsking).map(a => ({ key: `ask:${a.id}`, tag: t.approval, text: `${a.tool} ${a.what}`, isUrgent: true })),
    ...(p.streak >= 3 ? [{ key: `streak:${p.main.turnAt ?? 0}`, tag: t.status.error, text: t.errorsInRow(p.streak), isUrgent: true }] : []),
    ...p.checks.filter(c => c.result === 'failed').map(c => ({ key: `check:${c.kind}:${c.at}`, tag: t.failed, text: `${t.check[c.kind]} ${c.command}`, isUrgent: true })),
    ...p.agents
      .filter(a => (a.tests === 'FAIL' || a.status === 'error') && (a.endedAt ?? 0) >= (p.main.turnAt ?? 0))
      .map(a => ({ key: `agent:${a.id}:${a.endedAt ?? 0}`, tag: a.tests === 'FAIL' ? 'FAIL' : t.status.error, text: `${a.type} ${a.testsWhy ?? a.task}`, isUrgent: true })),
  ]
  return items.filter(x => !p.dismissed.includes(x.key))
}

// Pure, and the one place that knows both shapes: the test holds its keys to the fixture the page is drawn from.
export function toSnapshot(p: SnapshotParts): WebSnapshot {
  const { ins, t } = p
  const live: WebTurn[] = ins.turn ? [{ startedAt: ins.turn.startedAt, wallMs: p.now - ins.turn.startedAt, buckets: liveBuckets(ins.turn, p.now), isLive: true }] : []
  const turns = [...p.turnRing, ...live]
  const buckets = Object.fromEntries([...new Set(turns.flatMap(x => Object.keys(x.buckets)))].map(k => [k, bucketName(k)]))
  return {
    v: 1,
    session: p.session,
    now: p.now,
    lang: p.lang,
    labels: { page: t.web.page, main: t.mainSession, status: t.status, check: t.check, cat: t.cat, buckets, result: { ok: t.ok, failed: t.failed, unknown: t.unknown, running: t.status.running } },
    main: p.main,
    isPaneOpen: p.isPaneOpen,
    build: p.build,
    testReview: { files: p.testReview.files, dropped: droppedLines(t, p.testReview), isGreen: p.testReview.isGreen },
    focus: [...urgentItems(p), ...p.focus.filter(x => !p.dismissed.includes(x.key)).map(x => ({ key: x.key, tag: x.tag, text: x.text, isUrgent: false }))],
    usage: {
      ctxPct: p.usage.context.percent,
      rate: p.usage.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed })),
      usd: p.usage.cost?.usd ?? 0,
    },
    turns,
    turnCount: ins.turns,
    active: p.doing,
    calls: p.calls,
    trace: p.trace,
    agents: p.agents,
    checks: p.checks,
    files: { ...p.files, read: p.files.read.slice(-KEEP_FILES), edited: p.files.edited.slice(-KEEP_FILES) },
    log: p.log,
    tasks: p.tasks,
    insights: { slow: ins.slow, big: ins.big, tokens: ins.tokens, cacheRead: ins.cacheRead, cacheTotal: ins.cacheTotal },
    learned: { sessions: p.learned.sessions.length, bench: p.learned.bench.slice(-KEEP_BENCH_ROWS) },
  }
}

export function pushTurn(ring: WebTurn[], last: TurnTime | undefined): WebTurn[] {
  if (!last || ring.at(-1)?.startedAt === last.startedAt) return ring
  return [...ring, { startedAt: last.startedAt, wallMs: last.wallMs, buckets: last.buckets }].slice(-KEEP_TURNS)
}

// shortcut: the turn ring restarts on a module reload, keep it in the store when people ask for history across reloads.
let turnRing: WebTurn[] = []
let isLooping = false
// `/clear` ends a session with no new session.start: the loop goes on, under the new id, and only the ended id goes quiet.
let endedId: string | undefined
// A turn from before this time belongs to an ended session.
let ringFrom = 0
let lastJson = ''
let lastPostAt = 0
let lastEnsureAt = -Infinity
let cwd = ''
// shortcut: the branch is read when the server is reached, so a checkout shows on the next start; read it per post if people switch mid-session.
let branch: string | undefined

function serverScript($: EngineInterface): string {
  return `${$.plugin.root}/server/web.mjs`
}

async function ensureServer($: EngineInterface): Promise<void> {
  const r = await $.process.run(['node', serverScript($), 'ensure', String(cfg.webPort)], { timeoutMs: 10_000 })
  const port = r.exitCode === 0 ? (JSON.parse(r.stdout) as { port?: unknown }).port : undefined
  if (typeof port !== 'number') throw new Error(`ensure answered ${r.exitCode}`)
  cfg.webUrl = `http://127.0.0.1:${port}/`
}

// The flag keeps a pane the person hid closed when a module reload runs session.start again.
export async function setPane($: EngineInterface, isOpen: boolean): Promise<void> {
  await update($, layout, l => ({ ...l, isPaneHidden: !isOpen }))
  if (isOpen) await $.ui.open({ id: PANE, title: 'AgentMon Live' })
  else await $.ui.close({ id: PANE })
}

// What the page's button asked for; the server hands it over once.
async function takePaneRequest($: EngineInterface, id: string): Promise<void> {
  const r = await $.http.fetch(`${cfg.webUrl}pane/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  if (r.status === 200) await setPane($, (JSON.parse(r.text) as { isOpen: boolean }).isOpen)
}

async function publish($: EngineInterface): Promise<void> {
  const [id, usage, now, m, list, live, lines, st, recent, doing, checked, touched, lay, planned, insStored, learnt, panes, traced, reviewed] = await Promise.all([
    $.session.id(),
    $.session.usage(),
    $.clock.now(),
    read($, main),
    read($, agents),
    $.agent.list().catch(() => []),
    read($, log),
    read($, stats),
    read($, calls),
    read($, active),
    read($, checks),
    read($, files),
    read($, layout),
    read($, tasks),
    read($, insights),
    read($, learned),
    $.ui.panes().catch(() => []),
    read($, trace),
    read($, testReview),
  ])
  if (id === endedId) return
  await takePaneRequest($, id)
  const ins = { ...shapeInsights(insStored), turn: liveTurn.read ? liveTurn.read() : insStored?.turn }
  turnRing = pushTurn(turnRing, ins.last && ins.last.startedAt >= ringFrom ? ins.last : undefined)
  const statusOf = new Map(live.map(a => [a.id, liveStatus(a.status)]))
  const cards = list.map(a => ({ ...a, status: statusOf.get(a.id) ?? a.status }))
  const c = usage.context
  const learnedFocus = learnedItems(learnt, { percent: c.percent, window: c.window, model: m.model, effort: m.effort, calls: ins.turnCalls })
  const focus = focusList({ ins, doing, agents: cards, percent: c.percent, window: c.window, tokens: c.tokens, now, learned: learnedFocus, base: cfg.base, edited: touched.edited, testReview: reviewed })
  const snapshot = toSnapshot({
    session: { id, cwd, branch },
    now,
    main: m,
    usage,
    ins,
    turnRing,
    doing,
    calls: recent,
    agents: cards,
    checks: checked,
    files: touched,
    log: lines,
    tasks: planned,
    streak: st.streak ?? 0,
    dismissed: lay.dismissed ?? [],
    learned: learnt,
    focus,
    t: cfg.t,
    lang: cfg.lang,
    isPaneOpen: panes.some(x => x.id === PANE),
    build: cfg.build,
    testReview: reviewed,
    trace: traced,
  })
  // `now` moves on every read; the rest says whether anything changed.
  const json = JSON.stringify({ ...snapshot, now: 0 })
  if (json === lastJson && now - lastPostAt < HEARTBEAT_MS) return
  const r = await $.http.fetch(`${cfg.webUrl}state/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot) })
  // Something else may hold the port now: throw, so the loop's retry looks for our server.
  if (!r.ok) throw new Error(`post answered ${r.status}`)
  lastPostAt = now
  lastJson = json
}

function publishLoop($: EngineInterface): void {
  $.clock.after(PUBLISH_MS, async () => {
    if (cfg.web && cfg.webUrl) {
      try {
        await publish($)
      } catch (error) {
        const now = await $.clock.now()
        if (now - lastEnsureAt >= ENSURE_EVERY_MS) {
          lastEnsureAt = now
          void debug($, 'web.down', { message: String(error) })
          // A server that idled out or was killed: the next post reaches the new one, and the page's EventSource finds it too.
          await ensureServer($).catch(() => undefined)
        }
      }
    }
    publishLoop($)
  })
}

// One tab per session: the store remembers it across a module reload, which runs session.start again.
async function openOnce($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  if ((await $.store.get('webOpened')) === id) return
  await $.store.set('webOpened', id)
  await openBrowser($)
}

export async function startWeb($: EngineInterface, dir: string): Promise<void> {
  if (!cfg.web) return
  cwd = dir
  endedId = undefined
  lastEnsureAt = -Infinity
  try {
    await ensureServer($)
    const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).catch(() => undefined)
    branch = head?.exitCode === 0 ? head.stdout.trim() : undefined
  } catch (error) {
    cfg.webUrl = undefined
    void debug($, 'web.start', { message: String(error) })
    $.ui.toast(cfg.t.web.failed)
    return
  }
  $.ui.invalidate('ui.render')
  if (!isLooping) {
    isLooping = true
    publishLoop($)
  }
  if (cfg.webOpenOnStart) await openOnce($).catch(() => undefined)
}

// Best effort: the server drops a silent session by itself.
export async function stopWeb($: EngineInterface, sessionId: string): Promise<void> {
  endedId = sessionId
  turnRing = []
  lastJson = ''
  ringFrom = await $.clock.now()
  if (!cfg.webUrl) return
  await $.http.fetch(`${cfg.webUrl}state/${encodeURIComponent(sessionId)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } })
}

export async function openBrowser($: EngineInterface): Promise<boolean> {
  if (!cfg.webUrl) return false
  const r = await $.process.run(['node', serverScript($), 'open', cfg.webUrl], { timeoutMs: 10_000 }).catch(() => undefined)
  return r?.exitCode === 0
}
