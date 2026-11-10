import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { Card, Check, CheckKind, Files, LogLine, Task, TurnTime } from '../types'
import { addNote } from './advisor'
import { isDoc, parseTestRules, testCfg } from './gate'
import { book, newClock, snapshot } from './clock'
import { priceUsd } from './bench'
import { benchPrompt, checkNow, MIN_TOOLS_FOR_DONE_CHECK, noteShellEdit, noteTestEdit, noteTestRun, noteWorkAtStart, openGaps, resetTurn } from './done'
import { isTestPath, NOTHING, weakeningOf } from './testreview'
import type { Turn } from './done'
import { debug, debugPath, openDebugLog, saveDebugLog } from './debuglog'
import { build, checkRelease, refreshBase, watchBase } from './release'
import { errSig } from './learn'
import { benchCommand, isMemoryPath, learnCommand, memoryCommand, newPrompt, noteCall, noteCompact, noteGaps, queueMemoryCheck, saveTurn, startLearning } from './learning'
import { brief, describe, failLine, findChecks, gitCommand, hidesExit, mask, outcomeOf, testCounts, testScope, testsOf, took } from './format'
import { LANGUAGES } from './i18n'
import type { Category } from './i18n'
import { areaOf, bump, CACHE_TTL_MS, estTokens, isCorrection, isNewTask, pathOf, pushDuration } from './insights'
import { configureSize, forgetSizes, noteSizeBefore, parseExceptions, recordSize, relPath, watched } from './sizeguard'
import { drawBand, drawPane } from './render'
import { cfg, EMPTY_INSIGHTS, INIT, isLive, listening, liveTurn, reconcile, PANE, shapeInsights, trimAgents, VIEWS } from './state'
import { applyOptions, loadOptions } from './options'
import { forgetTurns, openBrowser, openLink, setPane, startWeb, stopWeb } from './web'
import type { View } from '../types'


const main = atom({ plugin: 'agentmon-live', key: 'main' } as const, INIT.main)
const tools = atom({ plugin: 'agentmon-live', key: 'tools' } as const, INIT.tools)
const agents = atom({ plugin: 'agentmon-live', key: 'agents' } as const, INIT.agents)
const log = atom({ plugin: 'agentmon-live', key: 'log' } as const, INIT.log)
const testReview = atom({ plugin: 'agentmon-live', key: 'testReview' } as const, INIT.testReview)
const advisor = atom({ plugin: 'agentmon-live', key: 'advisor' } as const, INIT.advisor)
const stats = atom({ plugin: 'agentmon-live', key: 'stats' } as const, INIT.stats)
const calls = atom({ plugin: 'agentmon-live', key: 'calls' } as const, INIT.calls)
const trace = atom({ plugin: 'agentmon-live', key: 'trace' } as const, INIT.trace)
const KEEP_TRACE = 500
const TRACE_TEXT = 300
const AGENT_PROMPT = 500
// Enough for the answer's gist in the web view's log; 50 turns of it keep the snapshot small.
const ANSWER_TEXT = 1500
const NAME_TEXT = 60
const TURN_PROMPT = 120
// A failed call's output can be megabytes; what is kept of it is far shorter, so only its head is masked.
const ERROR_HEAD = 8000
const EDIT_TOOLS = /^(Edit|MultiEdit|Write|NotebookEdit)$/
const view = atom({ plugin: 'agentmon-live', key: 'view' } as const, INIT.view)
const active = atom({ plugin: 'agentmon-live', key: 'active' } as const, INIT.active)
const checks = atom({ plugin: 'agentmon-live', key: 'checks' } as const, INIT.checks)
const files = atom({ plugin: 'agentmon-live', key: 'files' } as const, INIT.files)
const lastCall = atom({ plugin: 'agentmon-live', key: 'lastCall' } as const, INIT.lastCall)
const tasks = atom({ plugin: 'agentmon-live', key: 'tasks' } as const, INIT.tasks)
const skills = atom({ plugin: 'agentmon-live', key: 'skills' } as const, INIT.skills)
const flow = atom({ plugin: 'agentmon-live', key: 'flow' } as const, INIT.flow)
const insights = atom({ plugin: 'agentmon-live', key: 'insights' } as const, INIT.insights)
const layout = atom({ plugin: 'agentmon-live', key: 'layout' } as const, INIT.layout)

// A call slower than this joins the slowest list; a result bigger than this the biggest.
const SLOW_MIN_MS = 5000
const BIG_MIN_TOKENS = 2000
// Areas of the project remembered as worked in, to tell a turn in new ones.
const KEEP_AREAS = 50

const CLEAR_ARGS = Object.values(LANGUAGES).map(l => l.argClear)
let statusQueued = false
let rateQueued = false
let isTicking = false
let isPulsing = false
let reconciledAt = 0
// One base poll per process, however often the session starts.
let isBaseWatched = false
// How often the redraw loop asks the engine which agents still run.
const RECONCILE_MS = 5000

// A new run replaces its check: the pass before it stays known until this one ends.
function greenOf(all: readonly Check[], kind: Check['kind']): { greenAt?: number } {
  const old = all.find(c => c.kind === kind)
  const at = old?.result === 'ok' ? old.at : old?.greenAt
  return at === undefined ? {} : { greenAt: at }
}

function editedFiles(f: Files, path: string, at: number): Files {
  const edited = [...f.edited.filter(p => p !== path), path].slice(-200)
  const times = { ...f.editedTimes, [path]: at }
  return { ...f, edited, editedAt: at, editedTimes: Object.fromEntries(edited.flatMap(p => (times[p] === undefined ? [] : [[p, times[p]]]))) }
}

function category(tool: string, call: object): Category {
  if (tool === 'Bash' && gitCommand(String((call as { command?: unknown }).command ?? ''))) return 'git'
  if (/^(Read|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Grep|Glob|LSP|ToolSearch)$/.test(tool)) return 'search'
  if (/^Web(Fetch|Search)$|fetch_and_index/.test(tool)) return 'web'
  if (/^(Bash|Monitor|TaskStop)$/.test(tool)) return 'shell'
  if (EDIT_TOOLS.test(tool)) return 'edit'
  if (/^(Agent|SendMessage|Workflow|ListAgents)$/.test(tool)) return 'agents'
  if (/^Skill$/.test(tool)) return 'skills'
  if (/playwright|browser|chrome/i.test(tool)) return 'browser'
  if (/computer/i.test(tool)) return 'computer'
  if (/^mcp__/.test(tool)) return 'mcp'
  return 'other'
}

// Which detail tab lists a call, if any. MCP wins over the category, so a browser MCP tool shows there too.
function viewOf(tool: string, cat: Category): View | undefined {
  if (cat === 'git') return 'git'
  if (/^mcp__/.test(tool)) return 'mcp'
  if (cat === 'shell') return 'shell'
  return undefined
}

async function addLog($: EngineInterface, line: Omit<LogLine, 'at'>) {
  const at = await $.clock.now()
  await update($, log, list => [...list, { ...line, at }].slice(-50))
}

async function refreshStatus($: EngineInterface) {
  const [m, counts, list, adv] = await Promise.all([read($, main), read($, tools), read($, agents), read($, advisor)])
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const running = list.filter(isLive).length
  $.ui.status(cfg.t.statusLine(m.effort || '?', running, list.length, listening(adv.isOn), total, counts.git ?? 0))
}

// The spinner and elapsed seconds under Running now move on their own: redraw while a call or a subagent runs, twice a second in classic, where the seconds show.
function tick($: EngineInterface) {
  if (isTicking) return
  isTicking = true
  $.clock.after(cfg.isClassic ? 500 : 1000, async () => {
    isTicking = false
    const [doing, list, now] = await Promise.all([read($, active), read($, agents), $.clock.now()])
    // A waiting or idle teammate changes nothing on screen; only running work keeps the redraw going.
    if (doing.length === 0 && !list.some(a => a.status === 'running')) return
    // A card whose turn.complete never came would keep this loop running; the engine's list settles it.
    if (list.some(isLive) && now - reconciledAt >= RECONCILE_MS) {
      reconciledAt = now
      const live = await $.agent.list().catch(() => undefined)
      if (live) await update($, agents, all => reconcile(all, live))
    }
    $.ui.invalidate('ui.render')
    tick($)
  })
}

// With a refresh rate the pane keeps its frame within a period; this draws the next one on each boundary,
// the one drawPane's key counts, even when nothing writes. Like tick, it stops once nothing runs, after that last frame;
// tool.call, turn.start and agent.spawn start it again.
function pulse($: EngineInterface) {
  if (isPulsing || cfg.refreshMs <= 0) return
  isPulsing = true
  void $.clock.now().then(now =>
    $.clock.after(cfg.refreshMs - (now % cfg.refreshMs), async () => {
      isPulsing = false
      $.ui.invalidate('ui.render')
      const [doing, list] = await Promise.all([read($, active), read($, agents)])
      if (doing.length > 0 || list.some(a => a.status === 'running')) pulse($)
    }),
  )
}

// Tool calls come in bursts; redraw the status line at most twice a second.
function queueStatus($: EngineInterface) {
  if (statusQueued) return
  statusQueued = true
  $.clock.after(500, async () => {
    statusQueued = false
    await refreshStatus($)
  })
}

// The session's task list as its own calls change it; `deleted` removes a task.
async function trackTasks($: EngineInterface, call: { tool: string }, result: unknown) {
  const e = call as { tool: string; todos?: { content: string; status: Task['status']; activeForm: string }[]; subject?: string; activeForm?: string; taskId?: string; status?: Task['status'] | 'deleted' }
  // A TaskUpdate can answer without an error and still say it changed nothing.
  if ((result as { success?: unknown } | undefined)?.success === false) return
  const at = await $.clock.now()
  // Task text can quote a command with its token; it is drawn and sent to the advisor.
  const hide = (v: string | undefined) => (v === undefined ? undefined : mask(v))
  if (e.tool === 'TodoWrite' && e.todos) {
    const todos = e.todos
    // Prefixed so TodoWrite rows never collide with TaskCreate's ids ("1", "2"…).
    await update($, tasks, () => todos.map((d, i) => ({ id: `todo-${i}`, subject: mask(d.content), activeForm: hide(d.activeForm), status: d.status, at })).slice(-50))
  } else if (e.tool === 'TaskCreate') {
    const id = (result as { task?: { id?: string } } | undefined)?.task?.id
    if (id) await update($, tasks, list => [...list, { id, subject: mask(e.subject ?? ''), activeForm: hide(e.activeForm), status: 'pending' as const, at }].slice(-50))
  } else if (e.tool === 'TaskUpdate' && e.taskId) {
    const { taskId, status, subject, activeForm } = e
    await update($, tasks, list =>
      status === 'deleted'
        ? list.filter(k => k.id !== taskId)
        : list.map(k => (k.id === taskId ? { ...k, status: status ?? k.status, subject: hide(subject) ?? k.subject, activeForm: hide(activeForm) ?? k.activeForm, at } : k)),
    )
  }
}

let clk = newClock(0, false)
liveTurn.read = () => (clk.inTurn ? snapshot(clk) : undefined)


// A hook that fails lets the event go ahead: radar only watches, so it never holds up the session.
function logFailure($: EngineInterface, event: string, error: { kind: string; message?: string }) {
  $.ui.log(`agentmon-live: the ${event} hook failed, so the event went ahead (${error.kind}: ${error.message ?? 'unknown'})`, { to: 'debug' })
  void debug($, 'hook.fail', { event, kind: error.kind, message: mask(error.message ?? '') })
}
function failOpen<T>($: EngineInterface, event: string, error: { kind: string; message?: string }, proceed: () => T): T {
  logFailure($, event, error)
  return proceed()
}

function paneName($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Text } = $.ui.resolve(e)
  return <Text>AgentMon Live</Text>
}

// Redraw when the prompt cache of a session last active at `at` expires: an idle pane draws nothing on its own.
async function watchCache($: EngineInterface, at: number) {
  $.clock.after(Math.max(0, at + CACHE_TTL_MS - (await $.clock.now())), async () => $.ui.invalidate('ui.render'))
}

// The main turn ended: its time joins the session's, and the window is broken down once, locally.
async function finishTurn($: EngineInterface, durationMs: number, isContinued: boolean, docs?: string[], answer?: string) {
  if (!clk.inTurn) return
  const endedAt = await $.clock.now()
  book(clk, endedAt)
  const done: TurnTime = { ...snapshot(clk), mode: undefined, since: undefined }
  // The engine's figure for the turn's length, when it has one, over the clock's.
  done.wallMs = Math.max(done.wallMs, durationMs || 0)
  if (docs?.length) done.docs = docs
  if (answer) done.answer = answer
  clk.inTurn = false
  const ended = await update($, insights, v => {
    const session = { ...v.session }
    for (const [k, ms] of Object.entries(done.buckets)) session[k] = (session[k] ?? 0) + ms
    const here = Object.keys(v.turnAreas)
    const past = v.pastAreas ?? []
    const last = isNewTask(here, past, done.ctxStart) ? { ...done, isNewTask: true } : done
    const pastAreas = [...new Set([...past, ...here])].slice(-KEEP_AREAS)
    return { ...v, turn: undefined, last, session, sessionWall: v.sessionWall + done.wallMs, turns: v.turns + (isContinued ? 0 : 1), lastActive: endedAt, pastAreas }
  })
  // Kept in the store too: a resumed session starts a new process, and the transcript's time is rewritten on resume.
  // shortcut: one key per session, never pruned; prune by age if the store grows.
  const tokens = ended.ctx.at(-1)
  void $.session.id().then(id => $.store.set(`active:${id}`, { at: endedAt, tokens })).catch(() => undefined)
  await watchCache($, endedAt)
  $.clock.after(0, async () => {
    const u = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
    const b = u?.context.breakdown
    if (b) {
      const breakdown = b.categories
        .filter(c => c.kind === 'used' && c.tokens > 0)
        .sort((x, y) => y.tokens - x.tokens)
        .slice(0, 6)
        .map(c => ({ name: c.name, tokens: c.tokens }))
      const mcpTokens = b.mcpTools.filter(m => m.isLoaded).reduce((n, m) => n + m.tokens, 0)
      const memoryTokens = b.memoryFiles.reduce((n, m) => n + m.tokens, 0)
      await update($, insights, v => ({ ...v, breakdown, mcpTokens, memoryTokens }))
    }
    // The turn is learned from even when the engine gives no usage: the tallies and gaps are the session's own.
    const m = await read($, main)
    const fable = (await read($, advisor)).calls
    await saveTurn($, { tokens: u?.context.tokens, window: u?.context.window, mcpTools: b?.mcpTools, model: m.model, effort: m.effort, outTokens: ended.tokens.mainOut, fable, usd: ended.usd > 0 ? ended.usd : undefined, totalUsd: u?.cost?.usd, isContinued })
  })
}

// What the main loop did this turn, so Fable judges the work and not only the answer.
export const register: Register = on => {
  applyOptions({}, undefined)
  let t = cfg.t
  // Module variables reset on reload; the atoms above keep the shown state.
  const effortByCall = new Map<string, string>()
  const filesByAgent = new Map<string, Set<string>>()
  const seenStep = new Map<string, string>()
  let callCount = 0
  // Who runs each Skill call under way, for the `skill.prompt` it raises; none matches when the person typed the command.
  const skillRuns: { skill: string; who: string }[] = []
  // Files in `edited` were edited successfully this turn, by the main loop or its subagents.
  const turn: Turn = { prompt: '', startedAt: 0, tools: 0, delegated: 0, trail: [], edited: new Set(), edits: new Map(), docs: new Set(), before: [], tests: [], testEdits: new Set(), root: '' }
  // Fable judges an answer, so "check now" during a turn waits for the turn's answer.
  let isTurnLive = false
  let isCheckQueued = false
  let lastAnswer = ''
  // The done gate sends a turn back once; set until the person's next prompt.
  let isGateUsed = false
  // The turn under way is one a Stop hook sent back: the same prompt's, so it is no new turn in the counts.
  let isContinued = false
  // A git command ran since the base was last read.
  let isGitRun = false
  // The session this state belongs to: `/clear` and a resume change it with no session.start.
  let sessionId: string | undefined
  // For the self benchmark: the prompt's tool count when the gate sent it back, and whether a stop found nothing open.
  let blockAt: number | undefined
  let isPassed = false
  // A note names the request it is about, so an old note is not taken for a current one.
  const workRef = () => {
    const ask = turn.prompt.replace(/\s+/g, ' ').trim()
    return ask ? `"${ask.length > 40 ? `${ask.slice(0, 39)}…` : ask}"` : ''
  }
  clk = newClock(0, false)
  let cwd = ''
  // Calls that waited on an approval: their time is the person's, not the tool's.
  const askedCalls = new Set<string>()

  on('session.start', async ($, e, next) => {
    await loadOptions($).catch(() => undefined)
    t = cfg.t
    await $.command.register({
      name: 'agentmon',
      description: t.commandDescription,
      argumentHint: `[${t.argAdvisor}|${t.argCheck}|${t.argClear}|${VIEWS.join('|')}|details|open|learn|memory|debug]`,
    })
    cwd = e.cwd
    turn.root = cwd
    sessionId = await $.session.id().catch(() => undefined)
    pulse($)
    // After a reload mid-turn, older todos and agent results must not count as this turn's.
    turn.startedAt = await $.clock.now()
    if (cfg.debugLog) await openDebugLog($, turn.startedAt).catch(() => undefined)
    // The project's own size exceptions, each with a reason.
    void $.fs.read(`${cwd}/.agentmon-size`).then(
      text => {
        cfg.sizeExceptions = parseExceptions(text)
        configureSize(cfg.sizeLimit, cfg.sizeExclude, cfg.sizeExceptions)
      },
      () => undefined,
    )
    // The project's required test targets; none when the file is missing.
    testCfg.rules = []
    void $.fs.read(`${cwd}/.agentmon-tests`).then(
      text => (testCfg.rules = parseTestRules(text)),
      () => undefined,
    )
    const [model, live] = await Promise.all([$.session.model(), $.agent.list().catch(() => undefined)])
    await update($, main, m => ({ ...m, model }))
    void debug($, 'session.start', { model, language: cfg.lang, advisorMode: cfg.advisorMode, advisorBudget: cfg.advisorBudget, learning: cfg.learning, gitPollMinutes: cfg.baseMinutes, gitFetch: cfg.isFetching })
    // A turn under way when the module reloaded goes on: its clock and gate restart here, what it gathered before is gone. Older state lacks fields.
    if ((await read($, main)).turnLive) {
      isTurnLive = true
      clk = newClock(turn.startedAt, true)
    }
    await update($, insights, v => ({ ...shapeInsights(v), turn: undefined }))
    // State from an older version or another language holds keys this one does not draw; drop them.
    const known = (k: string) => k in t.cat
    const keep = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).filter(([k]) => known(k)))
    await Promise.all([
      update($, tools, keep),
      update($, stats, s => ({ ...s, errors: keep(s.errors) })),
      update($, agents, list => trimAgents(reconcile(list.filter(a => a.status in t.status), live))),
      // A load starts a new advisor epoch, so an answer the last load asked for is dropped.
      update($, advisor, a => ({ ...a, notes: a.notes.filter(n => n.kind === 'done' || n.kind === 'check'), epoch: (a.epoch ?? 0) + 1, state: a.state === 'checking' ? ('idle' as const) : a.state })),
      // Calls in flight when the module reloaded will never report back.
      update($, active, () => []),
      update($, calls, list => list.map(c => (c.result === 'running' ? { ...c, result: t.unknown } : c))),
      update($, checks, list => list.map(c => (c.result === 'running' ? { ...c, result: 'unknown' as const } : c))),
    ])
    if (!(await read($, layout)).isPaneHidden) void $.ui.open({ id: PANE, title: 'AgentMon Live' })
    // Reading the build and the status line need not hold up the session.
    $.clock.after(0, async () => {
      cfg.build = await build($).catch(() => '')
      await refreshStatus($)
      // The network need not hold up learning.
      void checkRelease($).catch(() => undefined)
      if (cfg.baseMinutes > 0 && !isBaseWatched) {
        isBaseWatched = true
        void watchBase($, cwd, cfg.baseMinutes, cfg.isFetching).catch(() => undefined)
      }
      void startWeb($, cwd).catch(() => undefined)
      // Learning is extra: an engine without a store or session id leaves the rest working.
      await startLearning($, cwd).catch(() => undefined)
      const kept = (await $.session.id().then(id => $.store.get(`active:${id}`)).catch(() => undefined)) as { at?: unknown; tokens?: unknown } | undefined
      if (typeof kept?.at !== 'number') return
      const at = kept.at
      const v = await update($, insights, v => (v.lastActive === undefined ? { ...v, lastActive: at, lastTokens: typeof kept.tokens === 'number' ? kept.tokens : undefined } : v))
      await watchCache($, v.lastActive ?? at)
    })

    return next(e)
  }).catch(($, e, next) => failOpen($, 'session.start', next.error, () => next(e)))

  // Plan-window readings, kept for their pace; a new `resetsAt` is a new window.
  on('session.end', async ($, e, next) => {
    const r = await next(e)
    await stopWeb($, e.sessionId).catch(() => undefined)
    // After `/clear` no session.start follows, and a closed pane's button must come back.
    $.ui.invalidate('ui.render')
    return r
  }).catch(($, e, next) => failOpen($, 'session.end', next.error, () => next(e)))

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const at = await $.clock.now()
      await update($, insights, v => {
        const limits = { ...v.limits }
        for (const r of e.rateLimits) {
          const resetsAt = r.resetsAt ? Date.parse(r.resetsAt) : undefined
          const kept = (limits[r.kind] ?? []).filter(x => x.resetsAt === resetsAt && at - x.at <= 30 * 60_000)
          limits[r.kind] = [...kept, { at, pct: r.percentUsed, resetsAt }].slice(-20)
        }
        return { ...v, limits }
      })
    }
    return next(e)
  }).catch(($, e, next) => failOpen($, 'session.measure', next.error, () => next(e)))

  on('command.run', { command: 'agentmon' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === t.argAdvisor) {
      const a = await update($, advisor, v => ({ ...v, isOn: !v.isOn }))
      await refreshStatus($)
      return { text: t.advisorToggled(a.isOn) }
    }
    if (arg === t.argCheck || arg === 'check') {
      if (isTurnLive) {
        isCheckQueued = true
        return { text: t.checkAfterTurn }
      }
      $.clock.after(0, () => checkNow($, turn, lastAnswer, workRef()))
      return { text: t.checking }
    }
    if (arg === 'open') {
      if (!cfg.webOn) return { text: cfg.web ? t.web.nextSession : t.web.off }
      if (!cfg.webUrl) return { text: t.web.failed }
      return { text: (await openBrowser($)) ? t.web.opened(cfg.webUrl) : t.web.noBrowser(await openLink($)) }
    }
    // What past sessions taught: `learn [dir]` reads transcripts into the store, `memory` checks the memory files.
    if (arg === 'learn' || arg.startsWith('learn ')) return { text: await learnCommand($, arg.slice(5).trim()) }
    if (arg === 'memory') return { text: await memoryCommand($) }
    if (arg === 'bench') return { text: await benchCommand($) }
    if (arg === 'debug') return { text: t.debugLog(debugPath()) }
    // Details from the prompt, so a script reaches it without focusing the pane.
    if (arg === 'details') {
      const l = await update($, layout, v => ({ ...v, isDetailed: !v.isDetailed }))
      return { text: `AgentMon Live: ${t.details} ${l.isDetailed ? t.on : t.off}` }
    }
    const v = VIEWS.find(x => x === arg.toLowerCase())
    if (v) {
      await update($, view, () => v)
      await setPane($, true)
      return { text: `AgentMon Live: ${t.cat[v]}` }
    }
    if (CLEAR_ARGS.includes(arg)) {
      forgetSizes()
      forgetTurns()
      // History goes; running and waiting agents and calls in flight stay.
      await Promise.all([
        update($, tools, () => ({})),
        update($, agents, list => list.filter(isLive)),
        update($, log, () => []),
        update($, stats, () => ({ errors: {}, compactions: 0, streak: 0 })),
        update($, calls, () => []),
        update($, trace, () => []),
        update($, checks, () => []),
        update($, files, () => ({ read: [], edited: [], editedAt: 0 })),
        update($, lastCall, () => null),
        update($, flow, () => []),
        update($, tasks, () => []),
        update($, skills, () => []),
        update($, insights, v => ({ ...EMPTY_INSIGHTS, turn: v.turn })),
      ])
      // The request stays: the turn under way still answers it.
      resetTurn(turn, [])
      await update($, testReview, () => INIT.testReview)
      await update($, advisor, a => ({ ...a, notes: [], epoch: (a.epoch ?? 0) + 1, state: 'idle' as const }))
      await refreshStatus($)
      return { text: t.cleared }
    }
    await setPane($, true)
    return { text: t.opened }
  }).catch(($, e, next) => ({ text: t.commandFailed(next.error.message ?? next.error.kind) }))

  on('turn.start', async ($, e, next) => {
    // `/reload-plugins` skips an unchanged module, so an edit to the settings arrives here.
    if (e.agentId === undefined) {
      await loadOptions($).catch(() => undefined)
      t = cfg.t
    }
    pulse($)
    // A turn a Stop hook sent back (the done gate or another one) goes on as the same turn: its checks and edits still count.
    // shortcut: any main turn with no typed text is taken for one, so another start without text keeps the old request; flag the send-back if such starts show.
    if (e.agentId === undefined && e.text === '') {
      isTurnLive = true
      isContinued = true
      await update($, main, v => ({ ...v, turnLive: true }))
      // The first turn.complete stopped the clock; the work after the send-back is still this turn's.
      if (!clk.inTurn) {
        clk = newClock(await $.clock.now(), true)
        clk.prompt = turn.prompt.slice(0, TURN_PROMPT)
      }
    } else if (e.agentId === undefined) {
      isTurnLive = true
      isGateUsed = false
      isContinued = false
      // A prompt that says the last edit turn's change did not work; read before the turn's files reset.
      const isFix = turn.edited.size > 0 && isCorrection(e.text)
      turn.prompt = mask(e.text)
      turn.startedAt = await $.clock.now()
      resetTurn(turn, await read($, checks))
      noteWorkAtStart($, turn)
      blockAt = undefined
      isPassed = false
      newPrompt()
      effortByCall.clear()
      askedCalls.clear()
      const turnAt = turn.startedAt
      void debug($, 'turn.start', { prompt_chars: e.text.length, isFix })
      clk = newClock(turnAt, true)
      clk.prompt = turn.prompt.slice(0, TURN_PROMPT)
      await Promise.all([
        update($, stats, s => ({ ...s, streak: 0 })),
        update($, main, v => ({ ...v, turnAt, turnLive: true })),
        // Loops, switches, approvals and the cache share are this turn's; re-reads add up over the session.
        update($, insights, v => ({ ...v, fails: {}, errs: {}, asked: {}, cacheRead: 0, cacheTotal: 0, turnCalls: 0, turnSwitches: 0, turnAreas: {}, corrections: isFix ? (v.corrections ?? 0) + 1 : 0 })),
      ])
    } else {
      // A finished agent that gets a new message runs again.
      const id = e.agentId
      const startedAt = await $.clock.now()
      await update($, agents, list => list.map(a => (a.id === id && !isLive(a) ? { ...a, status: 'running' as const, startedAt, endedAt: undefined, tests: undefined, testsWhy: undefined } : a)))
    }
    return next(e)
  }).catch(($, e, next) => failOpen($, 'turn.start', next.error, () => next(e)))

  on('turn.step', async function* ($, e, next) {
    const key = e.agentId ?? 'main'
    const seen = `${e.model}|${e.effort ?? ''}`
    const before = seenStep.get(key)
    if (before !== seen) {
      seenStep.set(key, seen)
      // A model or effort change mid-session starts the prompt cache over.
      if (before !== undefined && e.agentId === undefined) await update($, insights, v => ({ ...v, modelSwitches: v.modelSwitches + 1 }))
      const effort = e.effort === undefined ? '' : String(e.effort)
      if (e.agentId === undefined) {
        await update($, main, v => ({ ...v, model: e.model, effort }))
      } else {
        const id = e.agentId
        await update($, agents, list =>
          list.map(a => (a.id === id ? { ...a, model: e.model, effort: effort || a.effort } : a)),
        )
      }
      await refreshStatus($)
    }
    const isMain = e.agentId === undefined
    const agentId = e.agentId
    const stepAt = await $.clock.now()
    if (isMain) {
      book(clk, stepAt)
      clk.stepping = true
      clk.steps += 1
    } else {
      await update($, agents, list => list.map(a => (a.id === agentId ? { ...a, lastAt: stepAt } : a)))
    }
    let r: Awaited<ReturnType<typeof next>['result']> | undefined
    try {
      r = yield* next(e)
    } finally {
      if (isMain) {
        book(clk, await $.clock.now())
        clk.stepping = false
      }
    }
    // What the request was answered over is the context as it stands.
    const u = r.usage
    const total = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
    if (isMain && u) {
      clk.ctxStart ??= total
      clk.ctxEnd = total
    }
    // Off the stream's path: the next tool call need not wait for the bookkeeping.
    if (u) $.clock.after(0, () => update($, insights, v => ({
      ...v,
      ...(isMain
        ? {
            ctx: [...v.ctx, total].slice(-80),
            cacheRead: v.cacheRead + u.cache_read_input_tokens,
            cacheTotal: v.cacheTotal + total,
            tokens: { ...v.tokens, mainIn: v.tokens.mainIn + total, mainOut: v.tokens.mainOut + u.output_tokens, mainCached: v.tokens.mainCached + u.cache_read_input_tokens },
            usd: v.usd + (priceUsd(e.model, u) ?? 0),
          }
        : {}),
      ...(!isMain ? { tokens: { ...v.tokens, agentsIn: v.tokens.agentsIn + total, agentsOut: v.tokens.agentsOut + u.output_tokens } } : {}),
    })))
    if (u && !isMain) $.clock.after(0, () => update($, agents, list => list.map(a => (a.id === agentId ? { ...a, input: a.input + total, output: a.output + u.output_tokens, cached: (a.cached ?? 0) + u.cache_read_input_tokens, usd: (a.usd ?? 0) + (priceUsd(e.model, u) ?? 0) } : a))))
    return r
  }).catch(async function* ($, e, next) {
    logFailure($, 'turn.step', next.error)
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent' && e.effort && e.tool_use_id) effortByCall.set(e.tool_use_id, e.effort)
    const cat = category(e.tool, e)
    const tab = viewOf(e.tool, cat)
    // A message names its recipient, so the flow chart can draw it from lane to lane.
    const rawTo = e.tool === 'SendMessage' ? (e as { to?: unknown }).to : undefined
    const to = typeof rawTo === 'string' && rawTo ? mask(rawTo).slice(0, NAME_TEXT) : undefined
    const what = to === undefined ? describe(e.tool, e) : `→ ${to}`
    const callId = e.tool_use_id ?? `call-${++callCount}`
    const [list, m, startedAt] = await Promise.all([read($, agents), read($, main), $.clock.now()])
    const caller = e.agentId === undefined ? undefined : list.find(a => a.id === e.agentId)
    const who = e.agentId === undefined ? t.mainSession : (caller?.type ?? e.agentId)
    const model = e.agentId === undefined ? m.model : caller?.model
    const edit = e as { file_path?: string; notebook_path?: string }
    const path = edit.file_path ?? edit.notebook_path
    const id = e.agentId
    let agentFiles = 0
    if (id !== undefined) {
      const files = filesByAgent.get(id) ?? new Set<string>()
      if (path) files.add(path)
      filesByAgent.set(id, files)
      agentFiles = files.size
    } else {
      turn.tools += 1
      book(clk, startedAt)
      clk.calls.set(callId, { cat, isAsking: false })
    }

    const command = e.tool === 'Bash' ? String((e as { command?: unknown }).command ?? '') : ''
    // One row per kind, named by its last part: the one a failure is blamed on, not a script the same command ran first.
    const kinds = e.tool === 'Bash' ? findChecks(command, true) : []
    const found = [...new Map(kinds.map(c => [c.kind, c])).values()]
    const lastKind = kinds.at(-1)?.kind
    const isMine = (c: Check) => c.at === startedAt && found.some(f => f.kind === c.kind)
    // Where each test part runs: the shell's directory (a subagent's own, read here) moved by the command's own `cd`, flags and paths.
    const testParts = kinds.filter(k => k.kind === 'test').map(k => k.part)
    const shellDir = testParts.length > 0 ? await $.session.cwd().catch(() => cwd) : cwd
    let from = 0
    const scopes = testParts.map(part => {
      const scope = testScope(command, part, shellDir, from)
      from = Math.max(from, command.indexOf(part, from) + part.length)
      return { ...scope, part }
    })
    // The row's folder is its own part's.
    const scopeDir = scopes.at(-1) && relPath(scopes.at(-1)!.dir, cwd)
    if (cat === 'git') isGitRun = true
    // Listed as running before it starts: an approval asked at once must find its row.
    await update($, active, all => [...all, { id: callId, who, model, tool: e.tool, what, startedAt, ...(id === undefined ? {} : { agentId: id }) }])
    tick($)
    pulse($)
    // The other rows are written as it starts, so the detail tabs and the checks show it while it is under way; the call does not wait for them.
    const recorded = Promise.all([
      update($, tools, c => ({ ...c, [cat]: (c[cat] ?? 0) + 1 })),
      id !== undefined && update($, agents, all => all.map(a => (a.id === id ? { ...a, tools: a.tools + 1, others: (a.others ?? 0) + (cat === 'read' || cat === 'search' ? 0 : 1), files: agentFiles, lastAt: startedAt } : a))),
      tab && update($, calls, all => [...all, { id: callId, at: startedAt, who, view: tab, what, result: 'running', ...(id === undefined ? {} : { agentId: id }) }].slice(-60)),
      update($, trace, all => [...all, { id: callId, at: startedAt, who, tool: e.tool, what: what.slice(0, TRACE_TEXT), ...(id === undefined ? {} : { agentId: id }), ...(to === undefined ? {} : { to }) }].slice(-KEEP_TRACE)),
      found.length > 0 &&
        update($, checks, all => [
          ...all.filter(c => !found.some(f => f.kind === c.kind)),
          ...found.map(f => ({ ...greenOf(all, f.kind), kind: f.kind, command: mask(f.part).slice(0, 200), who, at: startedAt, result: 'running' as const, ...(f.kind === 'test' && scopeDir ? { dir: scopeDir } : {}) })),
        ]),
    ]).catch(error => void debug($, 'hook.fail', { event: 'tool.call', message: mask(String(error)) }))
    queueStatus($)

    // The file-size guide needs the size before the first edit of a file.
    const sized = EDIT_TOOLS.test(e.tool) && watched(pathOf(e), cwd) !== undefined ? pathOf(e) : undefined
    if (sized) await noteSizeBefore($, sized)
    const testFile = /^(Edit|MultiEdit|Write)$/.test(e.tool) && pathOf(e) && isTestPath(pathOf(e)!) ? pathOf(e)! : undefined
    const weakened = testFile ? await weakeningOf($, e, testFile).catch(() => NOTHING) : undefined

    // Bookkeeping after the call must not add to a turn that started meanwhile.
    const turnAt = turn.startedAt
    const run = e.tool === 'Skill' ? { skill: String((e as { skill?: unknown }).skill ?? ''), who } : undefined
    if (run) skillRuns.push(run)
    let ran: Awaited<ReturnType<typeof next>> | undefined
    try {
      ran = await next(e)
    } finally {
      if (run) skillRuns.splice(skillRuns.indexOf(run), 1)
      if (id === undefined && clk.calls.has(callId)) {
        book(clk, await $.clock.now())
        clk.calls.delete(callId)
      }
      // The rows this call's end writes to are in place first.
      await recorded
      // A call that threw never reports back.
      await Promise.all([
        update($, active, all => all.filter(a => a.id !== callId)),
        ran === undefined && tab && update($, calls, all => all.map(c => (c.id === callId ? { ...c, result: t.unknown } : c))),
        ran === undefined && $.clock.now().then(end => update($, trace, all => all.map(c => (c.id === callId ? { ...c, ms: end - startedAt, isFailed: true } : c)))),
        ran === undefined && found.length > 0 && update($, checks, all => all.map(c => (isMine(c) ? { ...c, result: 'unknown' as const } : c))),
      ])
    }
    const r = ran
    // The rest is bookkeeping; the result goes back to the model at once.
    $.clock.after(0, async () => {
      const failed = r.deny !== undefined || r.isError
      const text = String(r.text ?? '')
      const error = failed ? mask(String(r.deny ?? text).slice(0, ERROR_HEAD)).slice(0, 2000) : undefined
      const at = await $.clock.now()
      const output = String(r.text ?? (r.result as { stdout?: string } | undefined)?.stdout ?? '')
      // A denied or aborted run says nothing about the code; a failed one with one kind of check failed at it; past a pipe the output decides.
      // That output is shared: an error from one check would mark the others, so it decides only for the last.
      // Several kinds and an error: `&&` stops at the first failure, so only a test summary may blame the tests, and only when they ran last: a later check's output would decide it otherwise. The rest is unknown.
      const isChain = new Set(found.map(f => f.kind)).size > 1
      const resultOf = (kind: CheckKind): Check['result'] =>
        r.deny !== undefined ? 'unknown'
        : r.isError ? (isChain ? (kind === 'test' && kind === lastKind && testCounts(output) ? outcomeOf(output, 'test') : 'unknown') : kind === lastKind ? 'failed' : 'unknown')
        : hidesExit(command) ? (kind === lastKind ? outcomeOf(output, kind) : 'unknown') : 'ok'
      const sameTurn = turn.startedAt === turnAt
      const isMain = e.agentId === undefined && r.deny === undefined && sameTurn
      // A check that fails before the turn's first code edit was broken already; it counts as failing at the prompt.
      // Once it passes, it is no longer: a later failure is this turn's.
      const counts = scopes.length > 0 ? testCounts(output) : undefined
      // A denied run never ran. A failure is the last test part's; the summary's counts belong to one part only when there is one.
      // shortcut: counts of a chained run are not split per part, so an empty part beside a full one is not caught; upgrade when agents chain such runs.
      if (sameTurn && r.deny === undefined)
        for (const [i, { part, ...scope }] of scopes.entries()) {
          const isLast = i === scopes.length - 1
          turn.tests.push({ ...scope, command: mask(part).slice(0, 200), at: startedAt, result: isLast || !r.isError ? resultOf('test') : 'unknown', ...(counts && scopes.length === 1 ? { ran: counts.ran, skipped: counts.skipped } : {}) })
        }
      if (sameTurn)
        for (const f of found) {
          const result = resultOf(f.kind)
          if (result === 'ok') turn.before = turn.before.filter(b => b.kind !== f.kind)
          else if (result === 'failed' && turn.codeEditAt === undefined) turn.before.push({ kind: f.kind, command: f.part, who, at, result: 'failed' })
        }
      const touched = path && !failed && (cat === 'edit' || cat === 'read') ? path : undefined
      if (touched && cat === 'edit' && sameTurn) {
        turn.edited.add(touched)
        // A scratch file in /tmp is not the project's code: it makes no check stale.
        // shortcut: an edit outside the session folder (a symlinked path, a sibling worktree, an added directory) is no code edit either; upgrade when such edits go unchecked.
        if (!isDoc(touched) && relPath(touched, cwd) !== undefined) {
          turn.codeEditAt ??= at
          turn.lastCodeEditAt = at
          turn.edits.set(touched, (turn.edits.get(touched) ?? 0) + 1)
        }
        if (weakened && touched === testFile) await noteTestEdit($, turn, touched, weakened, at)
      }
      if (sameTurn && r.deny === undefined && scopes.length > 0) await noteTestRun($, turn)
      // Project docs only: not memory files, files outside the project, or .txt (requirements.txt, CMakeLists.txt).
      if (touched && cat === 'read' && isDoc(touched) && !/\.txt$/i.test(touched) && !isMemoryPath(touched) && relPath(touched, cwd) !== undefined && e.agentId === undefined && sameTurn) turn.docs.add(touched)
      if (isMain) turn.trail = [...turn.trail, `${e.tool} ${brief(e)} -> ${r.isError ? `${t.failed}: ${mask(text.slice(0, ERROR_HEAD)).slice(0, 300)}` : 'ok'}`].slice(-40)
      // Insights: how long it took, what it cost the context, where the main loop works.
      const ms = Math.max(0, at - startedAt)
      void debug($, 'tool.call', { tool: e.tool, cat, ms, agent: e.agentId !== undefined, denied: r.deny !== undefined, isError: r.isError })
      const wasAsked = askedCalls.delete(callId)
      const callKey = `${e.tool} ${brief(e)}`.trim().slice(0, 80)
      const sig = r.isError && r.deny === undefined ? errSig(text.slice(0, ERROR_HEAD)) : undefined
      const resultTokens = e.agentId === undefined && !failed ? estTokens(text) : 0
      if (r.deny === undefined) await noteCall($, e.tool, Boolean(r.isError), text.slice(0, ERROR_HEAD), r.isError ? 0 : estTokens(text))
      if (touched && cat === 'edit' && isMemoryPath(touched)) queueMemoryCheck($)
      if (touched && cat === 'edit' && touched.endsWith('/settings.json')) {
        await loadOptions($).catch(() => undefined)
        t = cfg.t
      }
      const workPath = e.agentId === undefined && sameTurn && r.deny === undefined ? pathOf(e) : undefined
      const area = workPath === undefined ? undefined : areaOf(workPath, cwd)
      // The history's calls-per-minute rate drops this call after a minute; an idle pane draws nothing on its own.
      if (!rateQueued) {
        rateQueued = true
        $.clock.after(60_000, async () => {
          rateQueued = false
          await $.ui.invalidate('ui.render')
        })
      }
      // One batch of writes, so the pane redraws once per call.
      const [s] = await Promise.all([
        (r.isError || isMain) &&
          update($, stats, v => ({
            ...v,
            errors: r.isError ? { ...v.errors, [cat]: (v.errors[cat] ?? 0) + 1 } : v.errors,
            streak: isMain ? (r.isError ? (v.streak ?? 0) + 1 : 0) : v.streak,
          })),
        failed && e.agentId !== undefined && update($, agents, all => all.map(a => (a.id === e.agentId ? { ...a, errors: (a.errors ?? 0) + 1 } : a))),
        update($, lastCall, () => ({ tool: e.tool, what, who, model, at })),
        update($, flow, all => [...all, { cat, at }].slice(-300)),
        tab && update($, calls, all => all.map(c => (c.id === callId ? { ...c, result: failed ? t.failed : 'ok', error } : c))),
        update($, trace, all => all.map(c => (c.id === callId ? { ...c, ms: at - startedAt, ...(failed ? { isFailed: true, error: error?.slice(0, TRACE_TEXT) } : {}) } : c))),
        found.length > 0 && update($, checks, all => all.map(c => (isMine(c) ? { ...c, result: resultOf(c.kind), ...(c.kind === 'test' && counts ? counts : {}) } : c))),
        !failed && e.agentId === undefined && trackTasks($, e, r.result),
        !failed && sized && recordSize($, sized),
        touched &&
          update($, files, f =>
            cat === 'edit'
              ? editedFiles(f, touched, at)
              : { ...f, read: [...f.read.filter(p => p !== touched), touched].slice(-200) },
          ),
        update($, insights, v => {
          const fails = { ...v.fails }
          if (r.deny === undefined) {
            if (r.isError) fails[callKey] = (fails[callKey] ?? 0) + 1
            else delete fails[callKey]
          }
          const moved = area !== undefined && v.area !== undefined && area !== v.area
          return {
            ...v,
            // An approval's wait would make the tool look slow.
            durations: wasAsked || r.deny !== undefined ? v.durations : pushDuration(v.durations, e.tool, ms),
            slow:
              wasAsked || r.deny !== undefined || ms < SLOW_MIN_MS
                ? v.slow
                : [...v.slow, { tool: e.tool, what, who, ms, at }].sort((a, b) => b.ms - a.ms).slice(0, 8),
            big: resultTokens < BIG_MIN_TOKENS ? v.big : [...v.big, { tool: e.tool, what, tokens: resultTokens, at }].sort((a, b) => b.tokens - a.tokens).slice(0, 6),
            reads: touched && cat === 'read' && e.agentId === undefined ? bump(v.reads, touched) : v.reads,
            edits: touched && cat === 'edit' ? bump(v.edits, touched) : v.edits,
            fails,
            errs: sig ? bump(v.errs, sig) : v.errs,
            turnCalls: isMain ? v.turnCalls + 1 : v.turnCalls,
            area: area ?? v.area,
            turnSwitches: v.turnSwitches + (moved ? 1 : 0),
            turnAreas: area === undefined ? v.turnAreas : bump(v.turnAreas, area),
          }
        }),
      ])
    })
    return r
  }).catch(($, e, next) => failOpen($, 'tool.call', next.error, () => next(e)))

  // An `ask` verdict means the call now waits for the person; `tool.call` above already listed it as active.
  on('tool.check', async ($, e, next) => {
    const v = await next(e)
    if (v.decision === 'ask') {
      let askedId: string | undefined
      await update($, active, list => {
        const mine = list.find(a => a.id === e.tool_use_id) ?? list.filter(a => a.tool === e.tool && !a.isAsking).at(-1)
        askedId = mine?.id
        return list.map(a => (a === mine ? { ...a, isAsking: true } : a))
      })
      const asking = askedId === undefined ? undefined : clk.calls.get(askedId)
      if (askedId !== undefined) askedCalls.add(askedId)
      if (asking) {
        book(clk, await $.clock.now())
        asking.isAsking = true
      }
      const askKey = `${e.tool} ${brief((e.input ?? {}) as object)}`.trim().slice(0, 60)
      await update($, insights, s => ({ ...s, asked: bump(s.asked, askKey), askedAll: bump(s.askedAll ?? {}, askKey) }))
    }
    return v
  }).catch(($, e, next) => failOpen($, 'tool.check', next.error, () => next(e)))

  on('session.compact', async ($, e, next) => {
    // Where the context stood when it compacted; past sessions' figures set the next plan's threshold.
    const before = e.trigger !== 'precompute' && e.agentId === undefined ? await $.session.usage().catch(() => undefined) : undefined
    const r = await next(e)
    if (r.skip === undefined) noteCompact(before?.context.tokens)
    void debug($, 'compact', { trigger: e.trigger, agent: e.agentId !== undefined, tokensBefore: before?.context.tokens, skipped: r.skip !== undefined })
    if (r.skip === undefined && e.trigger !== 'precompute' && e.agentId === undefined) {
      // What was read is out of the context now: a read after this is no re-read.
      await update($, insights, v => ({ ...v, reads: {} }))
      await update($, stats, s => ({ ...s, compactions: s.compactions + 1 }))
      await addLog($, { who: t.mainSession, what: t.compacted(e.trigger), result: '' })
    }
    return r
  }).catch(($, e, next) => failOpen($, 'session.compact', next.error, () => next(e)))

  // A skill's text is loaded, by the Skill tool or by a slash command the person typed.
  on('skill.prompt', async ($, e, next) => {
    const name = e.pluginName && !e.skill.includes(':') ? `${e.pluginName}:${e.skill}` : e.skill
    const bare = (s: string) => s.slice(s.indexOf(':') + 1)
    const who = skillRuns.find(s => s.skill === e.skill || bare(s.skill) === bare(e.skill))?.who ?? t.you
    $.clock.after(0, async () => {
      const at = await $.clock.now()
      await update($, skills, list => {
        const had = list.find(s => s.name === name)
        return [...list.filter(s => s !== had), { name, count: (had?.count ?? 0) + 1, who, at }].slice(-30)
      })
    })
    return next(e)
  }).catch(($, e, next) => failOpen($, 'skill.prompt', next.error, () => next(e)))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const effort = effortByCall.get(e.tool_use_id)
    effortByCall.delete(e.tool_use_id)
    if (r.deny !== undefined || r.agentId === undefined) return r
    const m = await read($, main)
    const card: Card = {
      id: r.agentId,
      type: e.subagentType,
      model: r.model,
      effort: effort ?? m.effort,
      task: mask(e.description),
      callId: e.tool_use_id,
      prompt: mask(e.prompt).slice(0, AGENT_PROMPT),
      ...(e.name ? { name: e.name.slice(0, NAME_TEXT) } : {}),
      status: 'running',
      files: 0,
      tools: 0,
      others: 0,
      input: 0,
      output: 0,
      startedAt: await $.clock.now(),
    }
    // A spawn the engine reports again for a known agent runs it again; it is no new agent.
    await update($, agents, list => trimAgents(list.some(a => a.id === card.id) ? list.map(a => (a.id === card.id ? { ...a, status: 'running' as const, endedAt: undefined } : a)) : [...list, card]))
    tick($)
    pulse($)
    await addLog($, { who: e.subagentType, what: card.task, result: t.started, agentId: r.agentId })
    await refreshStatus($)
    return r
  }).catch(($, e, next) => failOpen($, 'agent.spawn', next.error, () => next(e)))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const tests = testsOf(e.answer)
      const why = tests === 'FAIL' ? mask(failLine(e.answer) ?? '') || undefined : undefined
      const endedAt = await $.clock.now()
      const status: Card['status'] = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'cancelled' : 'error'
      seenStep.delete(id)
      const list = await update($, agents, all =>
        trimAgents(all.map(a =>
          a.id === id
            ? {
                ...a,
                status,
                tests: tests ?? a.tests,
                testsWhy: tests ? why : a.testsWhy,
                endedAt,
              }
            : a,
        )),
      )
      const card = list.find(a => a.id === id)
      // An agent an earlier turn started is not this turn's work: it must not bring the gate to a turn that did nothing.
      if (!card || card.startedAt >= turn.startedAt) turn.delegated += 1
      if (card) {
        if (tests) {
          await addLog($, { who: card.type, what: tests.startsWith('PASS') ? t.testsPassed : t.testsFailed, result: `${tests} (${t.reported})`, agentId: id })
        }
        await addLog($, { who: card.type, what: t.doneAfter(took(e.durationMs)), result: t.filesTools(card.files, card.tools), agentId: id })
      }
      await refreshStatus($)
    } else {
      // Docs read and code changed: the docs-vs-code hint in Focus; a refactor changes the code on purpose.
      const isRefactor = /refactor|refaktor|重构|重構|リファクタ/i.test(turn.prompt)
      await benchPrompt($, turn, blockAt, isPassed)
      await finishTurn($, e.durationMs, isContinued, turn.codeEditAt !== undefined && !isRefactor ? [...turn.docs].slice(0, 3) : undefined, mask(e.answer).trim().slice(0, ANSWER_TEXT))
      isTurnLive = false
      await update($, main, v => ({ ...v, turnLive: false }))
      void debug($, 'turn.complete', { ms: e.durationMs, tools: turn.tools, edited: turn.edited.size })
      lastAnswer = e.answer
      // Only a git command moves the branch against its base; the poll covers one a script ran.
      if (cfg.baseMinutes > 0 && isGitRun) {
        isGitRun = false
        $.clock.after(0, () => refreshBase($, cwd, false))
      }
      // Memory files change outside Edit and Write too: Bash, an editor, a git checkout.
      queueMemoryCheck($)
    }
    if (e.agentId === undefined && isCheckQueued) {
      isCheckQueued = false
      $.clock.after(0, () => checkNow($, turn, lastAnswer, workRef()))
    }
    return next(e)
  }).catch(($, e, next) => failOpen($, 'turn.complete', next.error, () => next(e)))

  // The done gate: before Claude stops, what is visibly unfinished goes back to it, once per prompt.
  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    // Another hook already sends it back: never stack.
    if (r.block || cfg.advisorMode === 'off' || !listening((await read($, advisor)).isOn)) return r
    await noteShellEdit($, turn)
    // A light turn has nothing to gate; while this turn's subagents still run, the work is not over yet.
    // A background agent from an earlier turn does not hold every later turn's gate.
    if (!(turn.tools >= MIN_TOOLS_FOR_DONE_CHECK || turn.edited.size > 0 || turn.delegated > 0 || turn.lastCodeEditAt !== undefined) || (await read($, agents)).some(a => a.status === 'running' && a.startedAt >= turn.startedAt)) return r
    // Fable looks at the continuation too, so the pane says whether the send-back was answered.
    const found = await openGaps($, turn, e.last_assistant_message ?? '')
    // A stop that ends a hook-driven continuation is recorded, never sent back again: no loops.
    const isSent = found.lines.length > 0 && !isGateUsed && !e.stop_hook_active
    if (found.judged) await addNote($, { kind: 'done', ok: found.lines.length === 0, text: found.lines.join('\n'), fix: found.fix, ref: workRef(), at: await $.clock.now(), isSent })
    if (found.judged) await addLog($, { who: t.gateLog.who, what: workRef(), result: found.lines.length === 0 ? t.gateLog.passed : isSent ? t.gateLog.sent : t.gateLog.open })
    void debug($, 'gate', { mode: cfg.advisorMode, gaps: found.lines.length, sent: isSent, judged: found.judged, stopHook: e.stop_hook_active })
    // A turn's last events are saved now, not 10 seconds later: the session may end right after its stop.
    void saveDebugLog($)
    if (found.lines.length === 0 && found.judged) isPassed = true
    if (isSent) blockAt = turn.tools
    await benchPrompt($, turn, blockAt, isPassed)
    if (!isSent) return r
    isGateUsed = true
    const block = t.gateReason([...found.lines, ...(found.fix ? [`→ ${found.fix}`] : [])].map(l => `- ${l}`).join('\n'))
    noteGaps(block)
    return { ...r, block }
  }).catch(($, e, next) => failOpen($, 'classic.Stop', next.error, () => next(e)))

  // How this session began, when not fresh: a resume, a /clear or a fork. A compaction logs itself.
  on('classic.SessionStart', async ($, e, next) => {
    const what = e.source === 'resume' || e.source === 'clear' || e.source === 'fork' ? t.began[e.source] : undefined
    if (what) await addLog($, { who: t.mainSession, what, result: '' })
    // `/clear` and a resume inside the process bring another session with no session.start: the last one's turn, answer and record must not go on as this one's.
    const id = await $.session.id().catch(() => undefined)
    if (sessionId !== undefined && id !== undefined && id !== sessionId) {
      sessionId = id
      turn.prompt = ''
      turn.startedAt = await $.clock.now()
      resetTurn(turn, [])
      lastAnswer = ''
      isGateUsed = false
      isContinued = false
      isCheckQueued = false
      if (cfg.debugLog) await saveDebugLog($).then(() => openDebugLog($, turn.startedAt)).catch(() => undefined)
      await startLearning($, cwd).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => failOpen($, 'classic.SessionStart', next.error, () => next(e)))

  // /model fires no turn.step until the next prompt: the title follows the switch now.
  on('classic.PostModelSwitch', async ($, e, next) => {
    if (e.to_model) {
      const model = e.to_model
      await update($, main, v => ({ ...v, model }))
    }
    return next(e)
  }).catch(($, e, next) => failOpen($, 'classic.PostModelSwitch', next.error, () => next(e)))

  // The pane's "check now" button; taken here, where this turn's material is at hand.
  on('ui.press', { plugin: 'agentmon-live', element: 'advisor:check' }, async ($, e) => {
    if (isTurnLive) {
      isCheckQueued = true
      $.ui.toast(t.checkAfterTurn)
    } else $.clock.after(0, () => checkNow($, turn, lastAnswer, workRef()))
    return { element: e.element }
  }).catch(($, e, next) => failOpen($, 'ui.press', next.error, () => ({ element: e.element })))

  // A pane that cannot draw says so in the debug log and shows its name, not an error.
  on('ui.render', { component: 'Pane', requestId: PANE }, drawPane).catch(($, e, next) => failOpen($, 'ui.render', next.error, () => paneName($, e)))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => drawBand($, e, await next(e))).catch(($, e, next) => failOpen($, 'ui.render', next.error, () => next(e)))

  // The close mark or `ctrl+x x` hides the pane like the pane's own button, so it stays closed after a module reload.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await update($, layout, l => ({ ...l, isPaneHidden: true }))
    return closed
  }).catch(($, e, next) => failOpen($, 'ui.close', next.error, () => next(e)))
}
