import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, Check, LogLine } from '../types'
import { advise } from './advisor'
import { brief, checkKind, decimal, describe, gitCommand, hidesExit, testsOf } from './format'
import { LANGUAGES } from './i18n'
import type { Category } from './i18n'
import { drawPane } from './render'
import { cfg, INIT, isLive, listening, PANE, trimAgents, VIEWS } from './state'
import type { View } from '../types'

export { brief, fit, gitCommand, kilo, modelName, testsOf } from './format'

const main = atom({ plugin: 'agent-radar', key: 'main' } as const, INIT.main)
const tools = atom({ plugin: 'agent-radar', key: 'tools' } as const, INIT.tools)
const agents = atom({ plugin: 'agent-radar', key: 'agents' } as const, INIT.agents)
const log = atom({ plugin: 'agent-radar', key: 'log' } as const, INIT.log)
const advisor = atom({ plugin: 'agent-radar', key: 'advisor' } as const, INIT.advisor)
const stats = atom({ plugin: 'agent-radar', key: 'stats' } as const, INIT.stats)
const calls = atom({ plugin: 'agent-radar', key: 'calls' } as const, INIT.calls)
const view = atom({ plugin: 'agent-radar', key: 'view' } as const, INIT.view)
const active = atom({ plugin: 'agent-radar', key: 'active' } as const, INIT.active)
const checks = atom({ plugin: 'agent-radar', key: 'checks' } as const, INIT.checks)
const files = atom({ plugin: 'agent-radar', key: 'files' } as const, INIT.files)
const lastCall = atom({ plugin: 'agent-radar', key: 'lastCall' } as const, INIT.lastCall)

const CLEAR_ARGS = Object.values(LANGUAGES).map(l => l.argClear)
// A finished turn with fewer main-loop tool calls is too small to be worth a Fable call.
const MIN_TOOLS_FOR_DONE_CHECK = 3

let statusQueued = false

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

// Tool calls come in bursts; redraw the status line at most twice a second.
function queueStatus($: EngineInterface) {
  if (statusQueued) return
  statusQueued = true
  $.clock.after(500, async () => {
    statusQueued = false
    await refreshStatus($)
  })
}

export const register: Register = (on, options) => {
  const t = (cfg.t = LANGUAGES[String(options.language)] ?? LANGUAGES.en!)
  cfg.advisorModel = String(options.advisorModel || 'claude-fable-5-1')
  cfg.advisorMode = String(options.advisorMode || 'all')
  // Module variables reset on reload; the atoms above keep the shown state.
  const effortByCall = new Map<string, string>()
  const filesByAgent = new Map<string, Set<string>>()
  const seenStep = new Map<string, string>()
  let lastPrompt = ''
  let turnTools = 0
  let callCount = 0
  // What the main loop did this turn, so Fable judges the work and not only the answer.
  let trail: string[] = []
  let edited = new Set<string>()
  const material = () => t.material(lastPrompt, trail.join('\n'), [...edited].join('\n'))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-radar',
      description: t.commandDescription,
      argumentHint: `[${t.argAdvisor}|${t.argClear}|${VIEWS.join('|')}]`,
    })
    const model = await $.session.model()
    await update($, main, m => ({ ...m, model }))
    // State from an older version or another language holds keys this one does not draw; drop them.
    const known = (k: string) => k in t.cat
    const keep = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).filter(([k]) => known(k)))
    await Promise.all([
      update($, tools, keep),
      update($, stats, s => ({ ...s, errors: keep(s.errors) })),
      update($, agents, list => list.filter(a => a.status in t.status)),
      // A load starts a new advisor epoch, so an answer the last load asked for is dropped.
      update($, advisor, a => ({ ...a, notes: a.notes.filter(n => n.kind in t.kind), epoch: (a.epoch ?? 0) + 1 })),
      // Calls in flight when the module reloaded will never report back.
      update($, active, () => []),
    ])
    void $.ui.open({ id: PANE, title: 'Agent Radar' })
    await refreshStatus($)

    return next(e)
  })

  on('command.run', { command: 'agent-radar' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === t.argAdvisor) {
      const a = await update($, advisor, v => ({ ...v, isOn: !v.isOn }))
      await refreshStatus($)
      return { text: t.advisorToggled(a.isOn) }
    }
    const v = VIEWS.find(x => x === arg.toLowerCase())
    if (v) {
      await update($, view, () => v)
      await $.ui.open({ id: PANE, title: 'Agent Radar' })
      return { text: `Agent Radar: ${t.cat[v]}` }
    }
    if (CLEAR_ARGS.includes(arg)) {
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
      ])
      await update($, advisor, a => ({ ...a, notes: [], epoch: (a.epoch ?? 0) + 1 }))
      await refreshStatus($)
      return { text: t.cleared }
    }
    await $.ui.open({ id: PANE, title: 'Agent Radar' })
    return { text: t.opened }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      lastPrompt = e.text
      turnTools = 0
      trail = []
      edited = new Set()
      await update($, stats, s => ({ ...s, streak: 0 }))
    } else {
      // A finished agent that gets a new message runs again.
      const id = e.agentId
      const startedAt = await $.clock.now()
      await update($, agents, list => list.map(a => (a.id === id && !isLive(a) ? { ...a, status: 'running' as const, startedAt } : a)))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const key = e.agentId ?? 'main'
    const seen = `${e.model}|${e.effort ?? ''}`
    if (seenStep.get(key) !== seen) {
      seenStep.set(key, seen)
      const effort = e.effort === undefined ? '' : String(e.effort)
      if (e.agentId === undefined) {
        await update($, main, () => ({ model: e.model, effort }))
      } else {
        const id = e.agentId
        await update($, agents, list =>
          list.map(a => (a.id === id ? { ...a, model: e.model, effort: effort || a.effort } : a)),
        )
      }
      await refreshStatus($)
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent' && e.effort && e.tool_use_id) effortByCall.set(e.tool_use_id, e.effort)
    const cat = category(e.tool, e)
    const tab = viewOf(e.tool, cat)
    const what = describe(e.tool, e)
    const callId = e.tool_use_id ?? `call-${++callCount}`
    const who = e.agentId === undefined ? t.mainSession : ((await read($, agents)).find(a => a.id === e.agentId)?.type ?? e.agentId)
    await update($, tools, c => ({ ...c, [cat]: (c[cat] ?? 0) + 1 }))
    const path = (e as { file_path?: string }).file_path
    if (e.agentId !== undefined) {
      const id = e.agentId
      const files = filesByAgent.get(id) ?? new Set<string>()
      if (path) files.add(path)
      filesByAgent.set(id, files)
      await update($, agents, list => list.map(a => (a.id === id ? { ...a, tools: a.tools + 1, files: files.size } : a)))
    } else {
      turnTools += 1
    }
    queueStatus($)

    if (e.tool === 'ExitPlanMode' && e.agentId === undefined && cfg.advisorMode !== 'off') {
      const plan = (await $.session.messages()).filter(m => m.role === 'assistant').at(-1)?.text ?? ''
      advise($, 'plan', t.askPlan, `${t.task}: ${lastPrompt}\n\n${t.plan}:\n${plan}`)
    }

    const command = e.tool === 'Bash' ? String((e as { command?: unknown }).command ?? '') : ''
    const kind = cat === 'shell' ? checkKind(command) : undefined
    const startedAt = await $.clock.now()
    // Recorded before it runs, so Running now, the detail tabs and the checks show it while it is under way.
    await Promise.all([
      update($, active, list => [...list, { id: callId, who, tool: e.tool, what, startedAt }]),
      tab && update($, calls, list => [...list, { id: callId, at: startedAt, who, view: tab, what, result: 'running' }].slice(-60)),
      kind && update($, checks, list => [...list.filter(c => c.kind !== kind), { kind, command: what, who, at: startedAt, result: 'running' as const }]),
    ])
    let ran
    try {
      ran = await next(e)
    } finally {
      await update($, active, list => list.filter(a => a.id !== callId))
    }
    const failed = ran.deny !== undefined || ran.isError
    const error = failed ? String(ran.deny ?? ran.text ?? '').slice(0, 2000) : undefined
    const at = await $.clock.now()
    await update($, lastCall, () => ({ tool: e.tool, what, who, at }))
    if (ran.isError) await update($, stats, s => ({ ...s, errors: { ...s.errors, [cat]: (s.errors[cat] ?? 0) + 1 } }))
    if (tab) {
      const result = failed ? t.failed : 'ok'
      await update($, calls, list => list.map(c => (c.id === callId ? { ...c, result, error } : c)))
      if (tab === 'git') await addLog($, { who, what, isGit: true, result })
    }
    if (kind) {
      // A denied or aborted run says nothing about the code; a pipe hides the exit status.
      const result: Check['result'] = ran.deny !== undefined ? 'unknown' : ran.isError ? 'failed' : hidesExit(command) ? 'unknown' : 'ok'
      await update($, checks, list => list.map(c => (c.kind === kind && c.at === startedAt ? { ...c, result } : c)))
    }
    if (path && !failed && (cat === 'edit' || cat === 'read')) {
      if (cat === 'edit' && e.agentId === undefined) edited.add(path)
      await update($, files, f =>
        cat === 'edit'
          ? { ...f, edited: [...f.edited.filter(p => p !== path), path].slice(-200), editedAt: at }
          : { ...f, read: [...f.read.filter(p => p !== path), path].slice(-200) },
      )
    }
    if (e.agentId === undefined && ran.deny === undefined) {
      trail = [...trail, `${e.tool} ${brief(e)} -> ${ran.isError ? `${t.failed}: ${String(ran.text ?? '').slice(0, 300)}` : 'ok'}`].slice(-40)
      const s = await update($, stats, v => ({ ...v, streak: ran.isError ? (v.streak ?? 0) + 1 : 0 }))
      if (s.streak === 3 && cfg.advisorMode === 'all') advise($, 'error', t.askErrors, material())
    }
    return ran
  })

  // An `ask` verdict means the call now waits for the person; `tool.call` above already listed it as active.
  on('tool.check', async ($, e, next) => {
    const v = await next(e)
    if (v.decision === 'ask') {
      await update($, active, list => {
        const mine = list.find(a => a.id === e.tool_use_id) ?? list.filter(a => a.tool === e.tool && !a.isAsking).at(-1)
        return list.map(a => (a === mine ? { ...a, isAsking: true } : a))
      })
    }
    return v
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (r.skip === undefined && e.trigger !== 'precompute' && e.agentId === undefined) {
      await update($, stats, s => ({ ...s, compactions: s.compactions + 1 }))
      await addLog($, { who: t.mainSession, what: t.compacted(e.trigger), result: '' })
    }
    return r
  })

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
      task: e.description,
      status: 'running',
      files: 0,
      tools: 0,
      input: 0,
      output: 0,
      startedAt: await $.clock.now(),
    }
    await update($, agents, list => trimAgents([...list, card]))
    await addLog($, { who: e.subagentType, what: e.description, result: t.started })
    await refreshStatus($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const u = e.usage
      const tests = testsOf(e.answer)
      const status: Card['status'] = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'cancelled' : 'error'
      seenStep.delete(id)
      const list = await update($, agents, all =>
        trimAgents(all.map(a =>
          a.id === id
            ? {
                ...a,
                status,
                input: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : a.input,
                output: u?.output_tokens ?? a.output,
                tests: tests ?? a.tests,
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
    } else if (e.reason === 'answer' && turnTools >= MIN_TOOLS_FOR_DONE_CHECK && cfg.advisorMode === 'all') {
      advise($, 'done', t.askDone, `${material()}\n\n${t.finalAnswer}:\n${e.answer}`)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, drawPane)
}
