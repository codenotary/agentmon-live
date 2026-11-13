import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionUsage } from 'claude-code'

import type { Active, Call, Card, Check, Files, Insights, Learned, LogLine, Main, Note, Step, Task, TestReview, TraceCall, TurnTime, WebFocus, WebSnapshot, WebTurn } from '../types'
import { debug } from './debuglog'
import type { Strings } from './i18n'
import type { Insight } from './insights'
import { bucketName, focusList, liveBuckets, needsYou } from './insights'
import { learnedItems } from './learn'
import { droppedLines } from './testreview'
import { cfg, INIT, liveStatus, liveTurn, PANE, shapeInsights } from './state'
import { stepRows, turnSpan } from './steps'

const main = atom({ plugin: 'agentmon-live', key: 'main' } as const, INIT.main)
const agents = atom({ plugin: 'agentmon-live', key: 'agents' } as const, INIT.agents)
const log = atom({ plugin: 'agentmon-live', key: 'log' } as const, INIT.log)
const stats = atom({ plugin: 'agentmon-live', key: 'stats' } as const, INIT.stats)
const calls = atom({ plugin: 'agentmon-live', key: 'calls' } as const, INIT.calls)
const trace = atom({ plugin: 'agentmon-live', key: 'trace' } as const, INIT.trace)
const steps = atom({ plugin: 'agentmon-live', key: 'steps' } as const, INIT.steps)
const testReview = atom({ plugin: 'agentmon-live', key: 'testReview' } as const, INIT.testReview)
const active = atom({ plugin: 'agentmon-live', key: 'active' } as const, INIT.active)
const checks = atom({ plugin: 'agentmon-live', key: 'checks' } as const, INIT.checks)
const files = atom({ plugin: 'agentmon-live', key: 'files' } as const, INIT.files)
const layout = atom({ plugin: 'agentmon-live', key: 'layout' } as const, INIT.layout)
const tasks = atom({ plugin: 'agentmon-live', key: 'tasks' } as const, INIT.tasks)
const insights = atom({ plugin: 'agentmon-live', key: 'insights' } as const, INIT.insights)
const learned = atom({ plugin: 'agentmon-live', key: 'learned' } as const, INIT.learned)
const advisor = atom({ plugin: 'agentmon-live', key: 'advisor' } as const, INIT.advisor)

const PUBLISH_MS = 500
// With no tab open there is nothing to draw for: the loop only keeps the turn ring and looks for a tab.
const IDLE_MS = 5000
// Well inside the server's 90 s, so a quiet session is not taken for a crashed one.
const HEARTBEAT_MS = 30_000
const ENSURE_EVERY_MS = 60_000
const KEEP_TURNS = 50
const KEEP_FILES = 50
// A live turn's clock moves on every read: it alone posts this often, while anything else that changes posts on the next tick.
const CLOCK_MS = 3000
const KEEP_BENCH_ROWS = 10
const resetMs = (at: string | undefined) => (at && !Number.isNaN(Date.parse(at)) ? Date.parse(at) : undefined)
const KEEP_ASKED = 10

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
  steps: Step[]
  notes?: Note[]
}

// The pane's list of what needs the person, in its order and with its keys, so a dismissal holds on both surfaces.
export function urgentItems(p: SnapshotParts): WebFocus[] {
  const { t } = p
  const items = needsYou({ doing: p.doing, streak: p.streak, checks: p.checks, agents: p.agents, turnAt: p.main.turnAt }).map((u): WebFocus => {
    const base = { key: u.key, isUrgent: true }
    if (u.kind === 'ask') return { ...base, tag: t.approval, text: `${u.call.tool} ${u.call.label ? `${u.call.label} · ` : ''}${u.call.what}` }
    if (u.kind === 'streak') return { ...base, tag: t.status.error, text: t.errorsInRow(u.n) }
    if (u.kind === 'check') return { ...base, tag: t.failed, text: `${t.check[u.check.kind]} ${u.check.command}` }
    if (u.kind === 'agent') return { ...base, tag: u.agent.tests === 'FAIL' ? 'FAIL' : t.status.error, text: `${u.agent.type} ${u.agent.testsWhy ?? u.agent.task}` }
    return { ...base, tag: t.status.waiting, text: `${u.agent.type} ${u.agent.task}` }
  })
  return items.filter(x => !p.dismissed.includes(x.key))
}

function lastGate(notes: readonly Note[]): WebSnapshot['gate'] {
  const note = notes.filter(n => n.kind === 'done').at(-1)
  return note ? { ok: note.ok ?? false, text: note.text, isSent: note.isSent ?? false, at: note.at ?? 0 } : null
}

const STEPS_SENT = 50

// Pure, and the one place that knows both shapes: the test holds its keys to the fixture the page is drawn from.
export function toSnapshot(p: SnapshotParts): WebSnapshot {
  const { ins, t } = p
  const span = turnSpan(ins)
  const live: WebTurn[] = ins.turn ? [{ startedAt: ins.turn.startedAt, wallMs: p.now - ins.turn.startedAt, buckets: liveBuckets(ins.turn, p.now), isLive: true, ...(ins.turn.prompt === undefined ? {} : { prompt: ins.turn.prompt }) }] : []
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
    focus: [...urgentItems(p), ...p.focus.filter(x => !p.dismissed.includes(x.key)).map(x => ({ key: x.key, tag: x.tag, text: x.text, isUrgent: x.key.startsWith('secret:') && x.color === 'red', ...(x.isGlobal ? { scope: t.ins.environment } : {}) }))],
    steps: (span ? stepRows({ trace: p.trace, steps: p.steps, active: p.doing }, span) : []).slice(0, STEPS_SENT).map(r => ({ ...r, actor: t.actor[r.actor] })),
    usage: {
      ctxPct: p.usage.context.percent,
      ctxTokens: p.usage.context.tokens,
      ctxWindow: p.usage.context.window,
      rate: p.usage.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: resetMs(r.resetsAt) })),
      usd: p.usage.cost?.usd ?? 0,
    },
    turns,
    turnCount: ins.turns,
    active: p.doing,
    calls: p.calls,
    trace: p.trace,
    agents: p.agents,
    checks: p.checks,
    files: { ...p.files, read: p.files.read.slice(-KEEP_FILES), edited: p.files.edited },
    log: p.log,
    tasks: p.tasks,
    insights: {
      slow: ins.slow,
      big: ins.big,
      tokens: ins.tokens,
      reads: ins.reads,
      edits: ins.edits,
      sizes: ins.sizes,
      breakdown: ins.breakdown ?? [],
      mcpTokens: ins.mcpTokens ?? 0,
      memoryTokens: ins.memoryTokens ?? 0,
      session: ins.session,
      sessionWall: ins.sessionWall,
      askedAll: Object.fromEntries(Object.entries(ins.askedAll ?? {}).sort((a, b) => b[1] - a[1]).slice(0, KEEP_ASKED)),
    },
    gate: lastGate(p.notes ?? []),
    learned: { bench: p.learned.bench.slice(-KEEP_BENCH_ROWS) },
  }
}

export function pushTurn(ring: WebTurn[], last: TurnTime | undefined): WebTurn[] {
  if (!last || ring.at(-1)?.startedAt === last.startedAt) return ring
  return [...ring, { startedAt: last.startedAt, wallMs: last.wallMs, buckets: last.buckets, ...(last.prompt === undefined ? {} : { prompt: last.prompt }), ...(last.answer === undefined ? {} : { answer: last.answer }) }].slice(-KEEP_TURNS)
}

// shortcut: the turn ring restarts on a module reload, keep it in the store when people ask for history across reloads.
let turnRing: WebTurn[] = []
let isLooping = false
// `/clear` ends a session with no new session.start: the loop goes on, under the new id, and only the ended id goes quiet.
let endedId: string | undefined
// A folder the host's server reads, for a session that cannot reach it: one in a VM or a container.
let spool: string | undefined
// The last write to the folder: the ended mark waits for it, so a snapshot under way cannot land on top.
let written: Promise<void> = Promise.resolve()
// Where a VM or a container has the host's folder: one mount is the whole setup, with no variable to set.
const SPOOL_DIR = '/var/lib/agentmon-live/spool'
const spoolFile = (id: string) => `${spool}/${id}.json`
// A turn from before this time belongs to an ended session.
let ringFrom = 0
let lastJson = ''
let lastPostAt = -Infinity
let lastEnsureAt = -Infinity
let cwd = ''
// shortcut: the branch is read at session start, so a checkout shows on the next start; read it per post if people switch mid-session.
let branch: string | undefined

function serverScript($: EngineInterface): string {
  return `${$.plugin.root}/server/web.mjs`
}

async function ensureServer($: EngineInterface): Promise<void> {
  const r = await $.process.run(['node', serverScript($), 'ensure', String(cfg.webPort), ...(cfg.isWebLocked ? [] : ['--open'])], { timeoutMs: 10_000 })
  const { port, key, mark } = r.exitCode === 0 ? (JSON.parse(r.stdout) as { port?: unknown; key?: unknown; mark?: unknown }) : {}
  if (typeof port !== 'number') throw new Error(`ensure answered ${r.exitCode}`)
  cfg.webUrl = `http://127.0.0.1:${port}/`
  // This server run's key and mark, from a server `ensure` saw prove it holds the account's secret; none from a server that asks for no proof.
  cfg.webSecret = typeof key === 'string' ? key : undefined
  cfg.webMark = typeof mark === 'string' ? mark : undefined
}

// The server takes a session's posts only with its run's key.
const jsonHeaders = () => ({ 'content-type': 'application/json', ...(cfg.webSecret ? { 'x-agentmon-key': cfg.webSecret } : {}) })

// Only our server knows the mark: anything else on the port (ours quit, another program took it) gets no snapshot.
function isOurs(r: { headers: Record<string, string> }): boolean {
  return cfg.webMark === undefined || r.headers['x-agentmon-mark'] === cfg.webMark
}

// What a browser must open: the plain address where the server can tell the browser's account, else one with a one-time code.
export async function openLink($: EngineInterface): Promise<string> {
  if (!cfg.webUrl || !cfg.webSecret) return cfg.webUrl ?? ''
  const r = await $.http.fetch(`${cfg.webUrl}ticket`, { method: 'POST', headers: jsonHeaders(), body: '{}' }).catch(() => undefined)
  const code = r?.ok && isOurs(r) ? (JSON.parse(r.text) as { code?: unknown }).code : undefined
  return typeof code === 'string' ? `${cfg.webUrl}?c=${code}` : cfg.webUrl
}

// `/agentmon clear`: the page's turns go with the session's history.
export function forgetTurns(): void {
  turnRing = []
}

// The flag keeps a pane the person hid closed when a module reload runs session.start again.
export async function setPane($: EngineInterface, isOpen: boolean): Promise<void> {
  await update($, layout, l => ({ ...l, isPaneHidden: !isOpen }))
  if (isOpen) await $.ui.open({ id: PANE, title: 'AgentMon Live' })
  else await $.ui.close({ id: PANE })
}

// What the page's button asked for; the server hands it over once. Answers whether a tab may be watching: only a server that says none counts as none.
async function takePaneRequest($: EngineInterface, id: string): Promise<boolean> {
  const r = await $.http.fetch(`${cfg.webUrl}pane/${encodeURIComponent(id)}`, { method: 'POST', headers: jsonHeaders(), body: '{}' })
  if (!isOurs(r)) throw new Error('not our server')
  // A server that does not know this session started after it (a newer session replaced it): post now, not at the next heartbeat.
  if (r.status === 404) lastJson = ''
  if (r.status === 200) await setPane($, (JSON.parse(r.text) as { isOpen: boolean }).isOpen)
  return r.headers['x-clients'] !== '0'
}

// What says a post is due: all of the snapshot but the clocks.
export function changeKey(snapshot: WebSnapshot): string {
  return JSON.stringify({ ...snapshot, now: 0, turns: snapshot.turns.map(x => (x.isLive ? { startedAt: x.startedAt, prompt: x.prompt } : x)) })
}

// Answers how long the loop waits for its next round.
async function publish($: EngineInterface): Promise<number> {
  const [id, now] = await Promise.all([$.session.id(), $.clock.now()])
  if (id === endedId) return PUBLISH_MS
  // Nothing says whether a tab watches the folder: write as if one does.
  const hasTab = spool ? true : await takePaneRequest($, id)
  // Every tick, tab or none: the ring takes a finished turn only as it goes by.
  const insStored = await read($, insights)
  const ins = { ...shapeInsights(insStored), turn: liveTurn.read ? liveTurn.read() : insStored?.turn }
  turnRing = pushTurn(turnRing, ins.last && ins.last.startedAt >= ringFrom ? ins.last : undefined)
  // A live turn keeps the short round: its end must go by before the next one's does.
  const wait = hasTab || ins.turn ? PUBLISH_MS : IDLE_MS
  if (!hasTab && now - lastPostAt < HEARTBEAT_MS) return wait
  const [usage, m, list, live, lines, st, recent, doing, checked, touched, lay, planned, learnt, panes, traced, reviewed, adv, stepped] = await Promise.all([
    $.session.usage(),
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
    read($, learned),
    $.ui.panes().catch(() => []),
    read($, trace),
    read($, testReview),
    read($, advisor),
    read($, steps),
  ])
  const statusOf = new Map(live.map(a => [a.id, liveStatus(a.status)]))
  const cards = list.map(a => ({ ...a, status: statusOf.get(a.id) ?? a.status }))
  const c = usage.context
  const learnedFocus = learnedItems(learnt, { percent: c.percent, window: c.window, model: m.model, effort: m.effort, calls: ins.turnCalls })
  const focus = focusList({ ins, doing, agents: cards, percent: c.percent, window: c.window, tokens: c.tokens, now, learned: learnedFocus, base: cfg.base, edited: touched.edited, testReview: reviewed, leaks: cfg.leaks })
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
    isPaneOpen: panes.some(x => x.id === PANE && x.isPlaced),
    build: cfg.build,
    testReview: reviewed,
    trace: traced,
    steps: stepped,
    notes: adv.notes,
  })
  const json = changeKey(snapshot)
  const dueEvery = snapshot.turns.at(-1)?.isLive ? CLOCK_MS : HEARTBEAT_MS
  if (json === lastJson && now - lastPostAt < dueEvery) return wait
  if (spool) {
    if (id === endedId) return wait
    written = $.fs.write(spoolFile(id), JSON.stringify(snapshot))
    await written
  } else {
    const r = await $.http.fetch(`${cfg.webUrl}state/${encodeURIComponent(id)}`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(snapshot) })
    // Something else may hold the port now: throw, so the loop's retry looks for our server.
    if (!r.ok) throw new Error(`post answered ${r.status}`)
  }
  lastPostAt = now
  lastJson = json
  return wait
}

function publishLoop($: EngineInterface, wait = PUBLISH_MS): void {
  $.clock.after(wait, async () => {
    let next = PUBLISH_MS
    if (cfg.webOn) {
      try {
        // No address means the first start failed: this retry is the way back.
        if (!spool && !cfg.webUrl) throw new Error('no server')
        next = await publish($)
      } catch (error) {
        const now = await $.clock.now()
        if (now - lastEnsureAt >= ENSURE_EVERY_MS) {
          lastEnsureAt = now
          void debug($, 'web.down', { message: String(error) })
          // A folder has no server to look for: the next write is the retry.
          if (spool) return publishLoop($, next)
          // A server that idled out or was killed: the next post reaches the new one, and the page's EventSource finds it too.
          await ensureServer($).then(async () => {
            $.ui.invalidate('ui.render')
            if (cfg.webOpenOnStart) await openOnce($)
          }).catch(() => undefined)
        }
      }
    }
    publishLoop($, next)
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
  // `web` applies at session start, as the guide says: the option can change at any prompt.
  cfg.webOn = cfg.web
  if (!cfg.web) return
  cwd = dir
  endedId = undefined
  // The loop's retry waits while this first start is still under way.
  lastEnsureAt = await $.clock.now()
  const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).catch(() => undefined)
  branch = head?.exitCode === 0 ? head.stdout.trim() : undefined
  spool = (await $.env.get('AGENTMON_SPOOL')) || ((await $.fs.exists(SPOOL_DIR).catch(() => false)) ? SPOOL_DIR : undefined)
  if (!isLooping) {
    isLooping = true
    publishLoop($)
  }
  if (spool) return
  try {
    await ensureServer($)
    lastEnsureAt = -Infinity
  } catch (error) {
    cfg.webUrl = undefined
    void debug($, 'web.start', { message: String(error) })
    $.ui.toast(cfg.t.web.failed)
    return
  }
  $.ui.invalidate('ui.render')
  if (cfg.webOpenOnStart) await openOnce($).catch(() => undefined)
}

// Best effort: the server drops a silent session by itself.
export async function stopWeb($: EngineInterface, sessionId: string): Promise<void> {
  endedId = sessionId
  turnRing = []
  lastJson = ''
  ringFrom = await $.clock.now()
  // The engine has no call to remove a file: the server does, on this mark.
  if (spool) {
    await written.catch(() => undefined)
    return $.fs.write(spoolFile(sessionId), '{"ended":true}')
  }
  if (!cfg.webUrl) return
  await $.http.fetch(`${cfg.webUrl}state/${encodeURIComponent(sessionId)}`, { method: 'DELETE', headers: jsonHeaders() })
}

// With the link it tried, for the person to open by hand when no browser came up.
export async function openBrowser($: EngineInterface): Promise<{ isOpen: boolean; link: string }> {
  if (!cfg.webUrl) return { isOpen: false, link: '' }
  const link = await openLink($)
  const r = await $.process.run(['node', serverScript($), 'open', link], { timeoutMs: 10_000 }).catch(() => undefined)
  return { isOpen: r?.exitCode === 0, link }
}
