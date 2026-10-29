import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, Check, CheckKind, LogLine, Task, TurnTime } from '../types'
import { addNote, consult } from './advisor'
import { doneGaps, isDoc } from './gate'
import { CHURN_EDITS } from './bench'
import { benchCommand, isMemoryPath, learnCommand, memoryCommand, newPrompt, noteCall, noteCompact, notePrompt, queueMemoryCheck, saveTurn, startLearning } from './learning'
import { brief, decimal, describe, failLine, findChecks, gitCommand, hidesExit, mask, outcomeOf, testsOf } from './format'
import { LANGUAGES } from './i18n'
import type { Category } from './i18n'
import { areaOf, bump, CACHE_TTL_MS, estTokens, pathOf, pushDuration } from './insights'
import { configureSize, forgetSizes, noteSizeBefore, parseExceptions, recordSize, relPath, watched } from './sizeguard'
import { drawPane } from './render'
import { cfg, EMPTY_INSIGHTS, INIT, isLive, listening, liveTurn, reconcile, PANE, shapeInsights, trimAgents, VIEWS } from './state'
import type { View } from '../types'

export { brief, fit, gitCommand, kilo, modelName, testsOf } from './format'

const main = atom({ plugin: 'agentmon-live', key: 'main' } as const, INIT.main)
const tools = atom({ plugin: 'agentmon-live', key: 'tools' } as const, INIT.tools)
const agents = atom({ plugin: 'agentmon-live', key: 'agents' } as const, INIT.agents)
const log = atom({ plugin: 'agentmon-live', key: 'log' } as const, INIT.log)
const advisor = atom({ plugin: 'agentmon-live', key: 'advisor' } as const, INIT.advisor)
const stats = atom({ plugin: 'agentmon-live', key: 'stats' } as const, INIT.stats)
const calls = atom({ plugin: 'agentmon-live', key: 'calls' } as const, INIT.calls)
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

// The main loop's turn clock: every moment of a turn goes to one bucket. A call waiting on an
// approval puts the time on `you`; running calls share it by category; a request streaming with
// no call running puts it on `model`; the rest is `idle`.
type TurnClock = {
  inTurn: boolean
  startedAt: number
  since: number
  stepping: boolean
  steps: number
  calls: Map<string, { cat: string; isAsking: boolean }>
  buckets: Record<string, number>
  ctxStart?: number
  ctxEnd?: number
}

function newClock(now: number, inTurn: boolean): TurnClock {
  return { inTurn, startedAt: now, since: now, stepping: false, steps: 0, calls: new Map(), buckets: {} }
}

function clockMode(c: TurnClock): string {
  const running = [...c.calls.values()]
  if (running.some(x => x.isAsking)) return 'you'
  if (running.length > 0) return running[0]!.cat
  return c.stepping ? 'model' : 'idle'
}

// Books the time since the clock last moved to the bucket it was in.
function book(c: TurnClock, now: number) {
  if (!c.inTurn) return
  const ms = Math.max(0, now - c.since)
  c.since = Math.max(c.since, now)
  if (ms === 0) return
  const running = [...c.calls.values()]
  const add = (k: string, v: number) => (c.buckets[k] = (c.buckets[k] ?? 0) + v)
  if (running.some(x => x.isAsking)) add('you', ms)
  else if (running.length > 0) for (const x of running) add(x.cat, ms / running.length)
  else add(c.stepping ? 'model' : 'idle', ms)
}

function snapshot(c: TurnClock): TurnTime {
  return { startedAt: c.startedAt, wallMs: c.since - c.startedAt, buckets: { ...c.buckets }, steps: c.steps, ctxStart: c.ctxStart, ctxEnd: c.ctxEnd, mode: clockMode(c), since: c.since }
}

const CLEAR_ARGS = Object.values(LANGUAGES).map(l => l.argClear)
// A finished turn with fewer main-loop tool calls, no edit and no subagent is too small to be worth a Fable call.
const MIN_TOOLS_FOR_DONE_CHECK = 3
// How much material Fable gets; the request and the evidence stay whole, the oldest trail lines go first.
const MATERIAL_ROOM = 12000
const REQUEST_ROOM = 2000

let statusQueued = false
let isTicking = false
let reconciledAt = 0
// How often the redraw loop asks the engine which agents still run.
const RECONCILE_MS = 5000

function category(tool: string, call: object): Category {
  if (tool === 'Bash' && gitCommand(String((call as { command?: unknown }).command ?? ''))) return 'git'
  if (/^(Read|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Grep|Glob|LSP|ToolSearch)$/.test(tool)) return 'search'
  if (/^Web(Fetch|Search)$|fetch_and_index/.test(tool)) return 'web'
  if (/^(Bash|Monitor|TaskStop)$/.test(tool)) return 'shell'
  if (/^(Edit|Write|NotebookEdit)$/.test(tool)) return 'edit'
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

// The spinner and elapsed seconds under Running now move on their own: redraw twice a second while a call or a subagent runs.
function tick($: EngineInterface) {
  if (isTicking) return
  isTicking = true
  $.clock.after(500, async () => {
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

// Tool calls come in bursts; redraw the status line at most twice a second.
function queueStatus($: EngineInterface) {
  if (statusQueued) return
  statusQueued = true
  $.clock.after(500, async () => {
    statusQueued = false
    await refreshStatus($)
  })
}

// Which build is loaded: the manifest's version and, in a git checkout, the commit (`0.6.0 · 3366336`).
async function build($: EngineInterface): Promise<string> {
  const root = $.plugin.root
  const read = (path: string) => $.fs.read(`${root}/${path}`).catch(() => '')
  const manifest = await read('.claude-plugin/plugin.json')
  const version = String((manifest ? (JSON.parse(manifest) as { version?: unknown }) : {}).version ?? '')
  const head = (await read('.git/HEAD')).trim()
  const ref = head.match(/^ref: (\S+)$/)?.[1]
  // A ref with `..` would read outside .git.
  const sha =
    ref === undefined
      ? head
      : ref.includes('..')
        ? ''
        : (await read(`.git/${ref}`)).trim() ||
          ((await read('.git/packed-refs')).split('\n').find(line => line.endsWith(` ${ref}`))?.split(' ')[0] ?? '')
  // A worktree's `.git` is a file (`gitdir: …`), so what reads here need not be a commit.
  return [version, /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : ''].filter(Boolean).join(' · ')
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
}
function failOpen<T>($: EngineInterface, event: string, error: { kind: string; message?: string }, proceed: () => T): T {
  logFailure($, event, error)
  return proceed()
}

// Redraw when the prompt cache of a session last active at `at` expires: an idle pane draws nothing on its own.
async function watchCache($: EngineInterface, at: number) {
  $.clock.after(Math.max(0, at + CACHE_TTL_MS - (await $.clock.now())), async () => $.ui.invalidate('ui.render'))
}

// The main turn ended: its time joins the session's, and the window is broken down once, locally.
async function finishTurn($: EngineInterface, durationMs: number, docs?: string[]) {
  if (!clk.inTurn) return
  const endedAt = await $.clock.now()
  book(clk, endedAt)
  const done: TurnTime = { ...snapshot(clk), mode: undefined, since: undefined }
  // The engine's figure for the turn's length, when it has one, over the clock's.
  done.wallMs = Math.max(done.wallMs, durationMs || 0)
  if (docs?.length) done.docs = docs
  clk.inTurn = false
  const ended = await update($, insights, v => {
    const session = { ...v.session }
    for (const [k, ms] of Object.entries(done.buckets)) session[k] = (session[k] ?? 0) + ms
    return { ...v, turn: undefined, last: done, session, sessionWall: v.sessionWall + done.wallMs, turns: v.turns + 1, lastActive: endedAt }
  })
  // Kept in the store too: a resumed session starts a new process, and the transcript's time is rewritten on resume.
  // shortcut: one key per session, never pruned; prune by age if the store grows.
  const tokens = ended.ctx.at(-1)
  void $.session.id().then(id => $.store.set(`active:${id}`, { at: endedAt, tokens })).catch(() => undefined)
  await watchCache($, endedAt)
  $.clock.after(0, async () => {
    const u = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
    const b = u?.context.breakdown
    if (!b) return
    const breakdown = b.categories
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .sort((x, y) => y.tokens - x.tokens)
      .slice(0, 6)
      .map(c => ({ name: c.name, tokens: c.tokens }))
    const mcpTokens = b.mcpTools.filter(m => m.isLoaded).reduce((n, m) => n + m.tokens, 0)
    const memoryTokens = b.memoryFiles.reduce((n, m) => n + m.tokens, 0)
    await update($, insights, v => ({ ...v, breakdown, mcpTokens, memoryTokens }))
    const m = await read($, main)
    const fable = (await read($, advisor)).calls
    await saveTurn($, { tokens: u.context.tokens, window: u.context.window, mcpTools: b.mcpTools, model: m.model, effort: m.effort, outTokens: ended.tokens.mainOut, fable })
  })
}

// What the main loop did this turn, so Fable judges the work and not only the answer.
// `before` holds the checks as they stood at the prompt; `codeEditAt` and `lastCodeEditAt` are the turn's first and last edit of a file that is not a doc.
// `docs` are the doc files the main loop read this turn; `edits` counts the edits per code file.
type Turn = { prompt: string; startedAt: number; tools: number; delegated: number; trail: string[]; edited: Set<string>; edits: Map<string, number>; docs: Set<string>; before: Check[]; codeEditAt?: number; lastCodeEditAt?: number }

// The request, this turn's subagents and the observed checks are kept whole; the trail gives way.
async function material($: EngineInterface, turn: Turn): Promise<string> {
const t = cfg.t
  const [list, checked, touched, planned] = await Promise.all([read($, agents), read($, checks), read($, files), read($, tasks)])
  const agentLines = list
    .filter(a => isLive(a) || a.startedAt >= turn.startedAt)
    .map(a => `- ${a.type}: ${a.status}${a.tests ? ` · ${a.tests} (${t.reported})` : ''} · ${a.task}`)
  const checkLines = checked.map(
    c => `- ${c.kind}: ${c.result}${c.result !== 'running' && touched.editedAt > c.at ? ` (${t.stale})` : ''} · ${c.command}`,
  )
  const request = turn.prompt.slice(0, REQUEST_ROOM)
  const changed = [...turn.edited].slice(-50).join('\n')
  const openLines = planned.filter(k => k.status !== 'completed').map(k => `- ${k.status}: ${k.subject}`)
  const evidence = t.evidence(agentLines.join('\n'), checkLines.join('\n'), openLines.join('\n'))
  const room = MATERIAL_ROOM - t.material(request, '', changed).length - evidence.length
  let lines = turn.trail
  while (lines.length > 0 && lines.join('\n').length > room) lines = lines.slice(1)
  return t.material(request, lines.join('\n'), changed) + evidence
}

// What the turn left open: recorded facts first; only when they show nothing does Fable judge whether the answer covers the request.
async function openGaps($: EngineInterface, turn: Turn, answer: string): Promise<{ lines: string[]; fix?: string }> {
  const t = cfg.t
  const [checked, planned, list] = await Promise.all([read($, checks), read($, tasks), read($, agents)])
  const lines = doneGaps(t, { checks: checked, before: turn.before, tasks: planned, agents: list, since: turn.startedAt, codeEditAt: turn.codeEditAt, lastCodeEditAt: turn.lastCodeEditAt })
  if (lines.length > 0 || cfg.advisorMode !== 'all') return { lines }
  const v = await consult($, t.askDone, `${await material($, turn)}${answer ? `\n\n${t.finalAnswer}:\n${mask(answer.slice(-4000))}` : ''}`)
  // Fable read untrusted tool output; what it says goes to Claude as a claim, never as a fact.
  return v && !v.ok ? { lines: [t.fableSays(mask(v.text))], fix: v.fix && mask(v.fix) } : { lines: [] }
}

// This prompt's part of the self benchmark, recomputed at each main turn end and stop.
// `blockAt` is the prompt's tool count when the gate sent it back; `isPassed` when a stop found nothing open.
async function benchPrompt($: EngineInterface, turn: Turn, blockAt: number | undefined, isPassed: boolean) {
  const [checked, now] = await Promise.all([read($, checks), $.clock.now()])
  const after = checked.filter(c => c.at >= (turn.lastCodeEditAt ?? Infinity) && c.result !== 'running')
  notePrompt({
    edit: turn.lastCodeEditAt !== undefined,
    verified: after.length > 0 && after.every(c => c.result === 'ok'),
    churn: [...turn.edits.values()].some(n => n >= CHURN_EDITS),
    ms: turn.tools > 0 ? now - turn.startedAt : 0,
    block: blockAt !== undefined,
    acted: blockAt !== undefined && turn.tools > blockAt,
    passed: isPassed,
  })
}

// "check now": the gate's own look, shown in the pane and never sent.
async function checkNow($: EngineInterface, turn: Turn, answer: string, ref: string) {
  const found = await openGaps($, turn, answer)
  await addNote($, { kind: 'check', ok: found.lines.length === 0, text: found.lines.join('\n'), fix: found.fix, ref, at: await $.clock.now() })
}

export const register: Register = (on, options) => {
  const t = (cfg.t = LANGUAGES[String(options.language)] ?? LANGUAGES.en!)
  cfg.lang = String(options.language) in LANGUAGES ? String(options.language) : 'en'
  cfg.advisorModel = String(options.advisorModel || 'claude-fable-5-1')
  // `plan` was the plan-only mode, gone with the plan check; its nearest is the gate without a model.
  cfg.advisorMode = String(options.advisorMode || 'all').replace(/^plan$/, 'gate')
  const budget = Number(options.advisorBudget ?? 30)
  cfg.advisorBudget = Number.isFinite(budget) && budget >= 0 ? budget : 30
  configureSize(options.sizeLimit, options.sizeExclude)
  cfg.learning = String(options.learning ?? 'on') !== 'off'
  // Module variables reset on reload; the atoms above keep the shown state.
  const effortByCall = new Map<string, string>()
  const filesByAgent = new Map<string, Set<string>>()
  const seenStep = new Map<string, string>()
  let callCount = 0
  // Who runs each Skill call under way, for the `skill.prompt` it raises; none matches when the person typed the command.
  const skillRuns: { skill: string; who: string }[] = []
  // Files in `edited` were edited successfully this turn, by the main loop or its subagents.
  const turn: Turn = { prompt: '', startedAt: 0, tools: 0, delegated: 0, trail: [], edited: new Set(), edits: new Map(), docs: new Set(), before: [] }
  // Fable judges an answer, so "check now" during a turn waits for the turn's answer.
  let isTurnLive = false
  let isCheckQueued = false
  let lastAnswer = ''
  // The done gate sends a turn back once; set until the person's next prompt.
  let isGateUsed = false
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
    await $.command.register({
      name: 'agentmon',
      description: t.commandDescription,
      argumentHint: `[${t.argAdvisor}|${t.argCheck}|${t.argClear}|${VIEWS.join('|')}|flow|radar|details|learn|memory]`,
    })
    cwd = e.cwd
    // The project's own size exceptions, each with a reason.
    void $.fs.read(`${cwd}/.agentmon-size`).then(
      text => configureSize(options.sizeLimit, options.sizeExclude, parseExceptions(text)),
      () => undefined,
    )
    const [model, live] = await Promise.all([$.session.model(), $.agent.list().catch(() => undefined)])
    await update($, main, m => ({ ...m, model }))
    // A turn under way when the module reloaded lost its clock; older state lacks fields.
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
    void $.ui.open({ id: PANE, title: 'AgentMon Live' })
    // Reading the build and the status line need not hold up the session.
    $.clock.after(0, async () => {
      cfg.build = await build($).catch(() => '')
      await refreshStatus($)
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
    // The pane's views and details from the prompt, so a script reaches them without focusing the pane.
    if (arg === 'flow' || arg === 'radar') {
      const mode: 'flow' | 'radar' = arg
      await update($, layout, l => ({ ...l, mode }))
      await $.ui.open({ id: PANE, title: 'AgentMon Live' })
      return { text: `AgentMon Live: ${t.modes[mode]}` }
    }
    // What past sessions taught: `learn [dir]` reads transcripts into the store, `memory` checks the memory files.
    if (arg === 'learn' || arg.startsWith('learn ')) return { text: await learnCommand($, arg.slice(5).trim()) }
    if (arg === 'memory') return { text: await memoryCommand($) }
    if (arg === 'bench') return { text: await benchCommand($) }
    if (arg === 'details') {
      const l = await update($, layout, v => ({ ...v, isDetailed: !v.isDetailed }))
      return { text: `AgentMon Live: ${t.details} ${l.isDetailed ? 'on' : 'off'}` }
    }
    const v = VIEWS.find(x => x === arg.toLowerCase())
    if (v) {
      await update($, view, () => v)
      await $.ui.open({ id: PANE, title: 'AgentMon Live' })
      return { text: `AgentMon Live: ${t.cat[v]}` }
    }
    if (CLEAR_ARGS.includes(arg)) {
      forgetSizes()
      // History goes; running and waiting agents and calls in flight stay.
      await Promise.all([
        update($, tools, () => ({})),
        update($, agents, list => list.filter(isLive)),
        update($, log, () => []),
        update($, stats, () => ({ errors: {}, compactions: 0, streak: 0 })),
        update($, calls, () => []),
        update($, checks, () => []),
        update($, files, () => ({ read: [], edited: [], editedAt: 0 })),
        update($, lastCall, () => null),
        update($, flow, () => []),
        update($, tasks, () => []),
        update($, skills, () => []),
        update($, insights, v => ({ ...EMPTY_INSIGHTS, turn: v.turn })),
      ])
      // The request stays: the turn under way still answers it.
      turn.tools = 0
      turn.delegated = 0
      turn.trail = []
      turn.edited = new Set()
      turn.edits = new Map()
      turn.docs = new Set()
      await update($, advisor, a => ({ ...a, notes: [], epoch: (a.epoch ?? 0) + 1, state: 'idle' as const, lastKey: undefined, lastAt: {} }))
      await refreshStatus($)
      return { text: t.cleared }
    }
    await $.ui.open({ id: PANE, title: 'AgentMon Live' })
    return { text: t.opened }
  }).catch(($, e, next) => ({ text: `agentmon-live: the command failed (${next.error.message ?? next.error.kind})` }))

  on('turn.start', async ($, e, next) => {
    // A turn the done gate sent back goes on as the same turn: its checks and edits still count.
    if (e.agentId === undefined && e.text === '' && isGateUsed) {
      isTurnLive = true
    } else if (e.agentId === undefined) {
      isTurnLive = true
      isGateUsed = false
      turn.prompt = mask(e.text)
      turn.tools = 0
      turn.delegated = 0
      turn.startedAt = await $.clock.now()
      turn.trail = []
      turn.edited = new Set()
      turn.edits = new Map()
      turn.docs = new Set()
      turn.before = await read($, checks)
      turn.codeEditAt = undefined
      turn.lastCodeEditAt = undefined
      blockAt = undefined
      isPassed = false
      newPrompt()
      effortByCall.clear()
      askedCalls.clear()
      const turnAt = turn.startedAt
      clk = newClock(turnAt, true)
      await Promise.all([
        update($, stats, s => ({ ...s, streak: 0 })),
        update($, main, v => ({ ...v, turnAt })),
        // Loops and switches are this turn's; approvals and re-reads add up over the session.
        update($, insights, v => ({ ...v, fails: {}, turnSwitches: 0, turnAreas: {} })),
      ])
    } else {
      // A finished agent that gets a new message runs again.
      const id = e.agentId
      const startedAt = await $.clock.now()
      await update($, agents, list => list.map(a => (a.id === id && !isLive(a) ? { ...a, status: 'running' as const, startedAt, tests: undefined, testsWhy: undefined } : a)))
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
            cacheRead: u.cache_read_input_tokens,
            cacheTotal: total,
            tokens: { ...v.tokens, mainIn: v.tokens.mainIn + total, mainOut: v.tokens.mainOut + u.output_tokens, mainCached: v.tokens.mainCached + u.cache_read_input_tokens },
          }
        : {}),
      ...(!isMain ? { tokens: { ...v.tokens, agentsIn: v.tokens.agentsIn + total, agentsOut: v.tokens.agentsOut + u.output_tokens } } : {}),
    })))
    return r
  }).catch(async function* ($, e, next) {
    logFailure($, 'turn.step', next.error)
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent' && e.effort && e.tool_use_id) effortByCall.set(e.tool_use_id, e.effort)
    const cat = category(e.tool, e)
    const tab = viewOf(e.tool, cat)
    const what = describe(e.tool, e)
    const callId = e.tool_use_id ?? `call-${++callCount}`
    const [list, m, startedAt] = await Promise.all([read($, agents), read($, main), $.clock.now()])
    const caller = e.agentId === undefined ? undefined : list.find(a => a.id === e.agentId)
    const who = e.agentId === undefined ? t.mainSession : (caller?.type ?? e.agentId)
    const model = e.agentId === undefined ? m.model : caller?.model
    const path = (e as { file_path?: string }).file_path
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
    // One row per kind; the row names the part that ran the check, not a script the same command ran first.
    const kinds = cat === 'shell' ? findChecks(command) : []
    const found = [...new Map(kinds.map(c => [c.kind, c])).values()]
    const lastKind = kinds.at(-1)?.kind
    const isMine = (c: Check) => c.at === startedAt && found.some(f => f.kind === c.kind)
    // Recorded before it runs, so Running now, the detail tabs and the checks show it while it is under way.
    await Promise.all([
      update($, tools, c => ({ ...c, [cat]: (c[cat] ?? 0) + 1 })),
      id !== undefined && update($, agents, all => all.map(a => (a.id === id ? { ...a, tools: a.tools + 1, files: agentFiles, lastAt: startedAt } : a))),
      update($, active, all => [...all, { id: callId, who, model, tool: e.tool, what, startedAt }]).then(() => tick($)),
      tab && update($, calls, all => [...all, { id: callId, at: startedAt, who, view: tab, what, result: 'running' }].slice(-60)),
      found.length > 0 &&
        update($, checks, all => [
          ...all.filter(c => !found.some(f => f.kind === c.kind)),
          ...found.map(f => ({ kind: f.kind, command: mask(f.part).slice(0, 200), who, at: startedAt, result: 'running' as const })),
        ]),
    ])
    queueStatus($)

    // The file-size guide needs the size before the first edit of a file.
    const sized = /^(Edit|Write|NotebookEdit)$/.test(e.tool) && watched(pathOf(e), cwd) !== undefined ? pathOf(e) : undefined
    if (sized) await noteSizeBefore($, sized)

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
      // A call that threw never reports back.
      await Promise.all([
        update($, active, all => all.filter(a => a.id !== callId)),
        ran === undefined && tab && update($, calls, all => all.map(c => (c.id === callId ? { ...c, result: t.unknown } : c))),
        ran === undefined && found.length > 0 && update($, checks, all => all.map(c => (isMine(c) ? { ...c, result: 'unknown' as const } : c))),
      ])
    }
    const r = ran
    // The rest is bookkeeping; the result goes back to the model at once.
    $.clock.after(0, async () => {
      const failed = r.deny !== undefined || r.isError
      const error = failed ? mask(String(r.deny ?? r.text ?? '')).slice(0, 2000) : undefined
      const at = await $.clock.now()
      const output = String(r.text ?? (r.result as { stdout?: string } | undefined)?.stdout ?? '')
      // A denied or aborted run says nothing about the code; a failed one failed at its last check; past a pipe the output decides.
      const resultOf = (kind: CheckKind): Check['result'] =>
        r.deny !== undefined ? 'unknown' : r.isError ? (kind === lastKind ? 'failed' : 'unknown') : hidesExit(command) ? outcomeOf(output, kind) : 'ok'
      const sameTurn = turn.startedAt === turnAt
      const isMain = e.agentId === undefined && r.deny === undefined && sameTurn
      const touched = path && !failed && (cat === 'edit' || cat === 'read') ? path : undefined
      if (touched && cat === 'edit' && sameTurn) {
        turn.edited.add(touched)
        if (!isDoc(touched)) {
          turn.codeEditAt ??= at
          turn.lastCodeEditAt = at
          turn.edits.set(touched, (turn.edits.get(touched) ?? 0) + 1)
        }
      }
      // Project docs only: not memory files, files outside the project, or .txt (requirements.txt, CMakeLists.txt).
      if (touched && cat === 'read' && isDoc(touched) && !/\.txt$/i.test(touched) && !isMemoryPath(touched) && relPath(touched, cwd) !== undefined && e.agentId === undefined && sameTurn) turn.docs.add(touched)
      if (isMain) turn.trail = [...turn.trail, `${e.tool} ${brief(e)} -> ${r.isError ? `${t.failed}: ${mask(String(r.text ?? '')).slice(0, 300)}` : 'ok'}`].slice(-40)
      // Insights: how long it took, what it cost the context, where the main loop works.
      const ms = Math.max(0, at - startedAt)
      const wasAsked = askedCalls.delete(callId)
      const callKey = `${e.tool} ${brief(e)}`.trim().slice(0, 80)
      const resultTokens = e.agentId === undefined && !failed ? estTokens(String(r.text ?? '')) : 0
      if (r.deny === undefined) await noteCall($, e.tool, Boolean(r.isError), String(r.text ?? ''), r.isError ? 0 : estTokens(String(r.text ?? '')))
      if (touched && cat === 'edit' && isMemoryPath(touched)) queueMemoryCheck($)
      const workPath = e.agentId === undefined && sameTurn && r.deny === undefined ? pathOf(e) : undefined
      const area = workPath === undefined ? undefined : areaOf(workPath, cwd)
      // One batch of writes, so the pane redraws once per call.
      const [s] = await Promise.all([
        (r.isError || isMain) &&
          update($, stats, v => ({
            ...v,
            errors: r.isError ? { ...v.errors, [cat]: (v.errors[cat] ?? 0) + 1 } : v.errors,
            streak: isMain ? (r.isError ? (v.streak ?? 0) + 1 : 0) : v.streak,
          })),
        update($, lastCall, () => ({ tool: e.tool, what, who, model, at })),
        update($, flow, all => [...all, { cat, at }].slice(-300)),
        tab && update($, calls, all => all.map(c => (c.id === callId ? { ...c, result: failed ? t.failed : 'ok', error } : c))),
        found.length > 0 && update($, checks, all => all.map(c => (isMine(c) ? { ...c, result: resultOf(c.kind) } : c))),
        !failed && e.agentId === undefined && trackTasks($, e, r.result),
        !failed && sized && recordSize($, sized),
        touched &&
          update($, files, f =>
            cat === 'edit'
              ? { ...f, edited: [...f.edited.filter(p => p !== touched), touched].slice(-200), editedAt: at }
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
            area: area ?? v.area,
            switches: v.switches + (moved ? 1 : 0),
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
      await update($, insights, s => ({ ...s, asked: bump(s.asked, askKey) }))
    }
    return v
  }).catch(($, e, next) => failOpen($, 'tool.check', next.error, () => next(e)))

  on('session.compact', async ($, e, next) => {
    // Where the context stood when it compacted; past sessions' figures set the next plan's threshold.
    const before = e.trigger !== 'precompute' && e.agentId === undefined ? await $.session.usage().catch(() => undefined) : undefined
    const r = await next(e)
    if (r.skip === undefined) noteCompact(before?.context.tokens)
    if (r.skip === undefined && e.trigger !== 'precompute' && e.agentId === undefined) {
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
      status: 'running',
      files: 0,
      tools: 0,
      input: 0,
      output: 0,
      startedAt: await $.clock.now(),
    }
    await update($, agents, list => trimAgents([...list, card]))
    tick($)
    await addLog($, { who: e.subagentType, what: card.task, result: t.started })
    await refreshStatus($)
    return r
  }).catch(($, e, next) => failOpen($, 'agent.spawn', next.error, () => next(e)))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const u = e.usage
      const tests = testsOf(e.answer)
      const why = tests === 'FAIL' ? mask(failLine(e.answer) ?? '') || undefined : undefined
      const endedAt = await $.clock.now()
      turn.delegated += 1
      const status: Card['status'] = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'cancelled' : 'error'
      seenStep.delete(id)
      filesByAgent.delete(id)
      const list = await update($, agents, all =>
        trimAgents(all.map(a =>
          a.id === id
            ? {
                ...a,
                status,
                input: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : a.input,
                output: u?.output_tokens ?? a.output,
                tests: tests ?? a.tests,
                testsWhy: tests ? why : a.testsWhy,
                endedAt,
              }
            : a,
        )),
      )
      const card = list.find(a => a.id === id)
      if (card) {
        if (tests) {
          await addLog($, { who: card.type, what: tests.startsWith('PASS') ? t.testsPassed : t.testsFailed, result: `${tests} (${t.reported})` })
        }
        await addLog($, { who: card.type, what: t.doneAfter(decimal(e.durationMs / 1000)), result: t.filesTools(card.files, card.tools) })
      }
      await refreshStatus($)
    } else {
      // Docs read and code changed: the docs-vs-code hint in Focus; a refactor changes the code on purpose.
      const isRefactor = /refactor|refaktor|重构|重構|リファクタ/i.test(turn.prompt)
      await benchPrompt($, turn, blockAt, isPassed)
      await finishTurn($, e.durationMs, turn.codeEditAt !== undefined && !isRefactor ? [...turn.docs].slice(0, 3) : undefined)
      isTurnLive = false
      lastAnswer = e.answer
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
    // A light turn has nothing to gate; while subagents still run, the work is not over yet.
    if (!(turn.tools >= MIN_TOOLS_FOR_DONE_CHECK || turn.edited.size > 0 || turn.delegated > 0) || (await read($, agents)).some(isLive)) return r
    const found = await openGaps($, turn, e.last_assistant_message ?? '')
    // A stop that ends a hook-driven continuation is recorded, never sent back again: no loops.
    const isSent = found.lines.length > 0 && !isGateUsed && !e.stop_hook_active
    await addNote($, { kind: 'done', ok: found.lines.length === 0, text: found.lines.join('\n'), fix: found.fix, ref: workRef(), at: await $.clock.now(), isSent })
    if (found.lines.length === 0) isPassed = true
    if (isSent) blockAt = turn.tools
    await benchPrompt($, turn, blockAt, isPassed)
    if (!isSent) return r
    isGateUsed = true
    return { ...r, block: t.gateReason([...found.lines, ...(found.fix ? [`→ ${found.fix}`] : [])].map(l => `- ${l}`).join('\n')) }
  }).catch(($, e, next) => failOpen($, 'classic.Stop', next.error, () => next(e)))

  // The pane's "check now" button; taken here, where this turn's material is at hand.
  on('ui.press', { plugin: 'agentmon-live', element: 'advisor:check' }, async ($, e) => {
    if (isTurnLive) {
      isCheckQueued = true
      $.ui.toast(t.checkAfterTurn)
    } else $.clock.after(0, () => checkNow($, turn, lastAnswer, workRef()))
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, drawPane)
}
