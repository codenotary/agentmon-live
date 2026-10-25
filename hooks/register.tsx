import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, LogLine, Note } from '../types'
import { CATEGORIES, LANGUAGES } from './i18n'
import type { Category } from './i18n'

const PANE = 'agent-stack'
const CLEAR_ARGS = Object.values(LANGUAGES).map(l => l.argClear)
// A finished turn with fewer main-loop tool calls is too small to be worth a Fable call.
const MIN_TOOLS_FOR_DONE_CHECK = 3

// Set from the options on each load.
let t = LANGUAGES.en!
let advisorModel = 'claude-fable-5-1'
let advisorMode = 'all'
let statusQueued = false

const main = atom({ plugin: 'agent-stack', key: 'main' } as const, { model: '', effort: '' })
const tools = atom({ plugin: 'agent-stack', key: 'tools' } as const, {})
const agents = atom({ plugin: 'agent-stack', key: 'agents' } as const, [])
const log = atom({ plugin: 'agent-stack', key: 'log' } as const, [])
const advisor = atom({ plugin: 'agent-stack', key: 'advisor' } as const, {
  isOn: true,
  calls: 0,
  last: '–',
  notes: [],
})
const stats = atom({ plugin: 'agent-stack', key: 'stats' } as const, { errors: {}, compactions: 0 })

// `git status`, `cd x && git push`, `git -C dir log`: the git part of a shell command, else undefined.
export function gitCommand(command: string): string | undefined {
  return command.match(/(?:^|&&|\|\||;|\n)\s*(git\s+[^&|;]*)/)?.[1]?.trim().replace(/\s+/g, ' ')
}

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
  return 'other'
}

// claude-sonnet-5-5 -> Sonnet 5.5
export function modelName(id: string): string {
  const m = id.match(/claude-([a-z]+)-(\d+)-(\d+)/) ?? id.match(/^([a-z]+)$/)
  if (!m) return id || '?'
  const word = m[1] ?? ''
  const name = word.charAt(0).toUpperCase() + word.slice(1)
  return m[2] ? `${name} ${m[2]}.${m[3]}` : name
}

function decimal(n: number): string {
  return n.toFixed(1).replace('.', t.decimal)
}

export function kilo(n: number): string {
  return n >= 1000 ? `${decimal(n / 1000)}k` : String(n)
}

// The one argument that says what a call did: its file, command, pattern, ...
export function brief(call: object): string {
  const a = call as Record<string, unknown>
  const arg = ['file_path', 'command', 'pattern', 'url', 'query', 'description', 'skill'].map(k => a[k]).find(v => typeof v === 'string')
  return typeof arg === 'string' ? arg.replace(/\s+/g, ' ').slice(0, 100) : ''
}

function effortBar(effort: string): string {
  const n = ({ low: 1, medium: 2, high: 3, xhigh: 4, max: 4 } as Record<string, number>)[effort] ?? 0
  return '█'.repeat(n) + '▯'.repeat(4 - n)
}

function clockTime(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0')).join(':')
}

export function testsOf(answer: string): string | undefined {
  const pass =
    answer.match(/(\d+)\s+(?:tests?|Tests)\s+(?:passed|bestanden|passing)/i) ??
    answer.match(/\bPASS(?:ED)?\b\D{0,12}(\d+)\s+tests?/i)
  if (pass) return t.testsPass(pass[1] ?? '')
  if (/\b([1-9]\d*)\s+(?:tests?\s+)?fail(?:ed|ing)?\b/i.test(answer)) return 'FAIL'
  return undefined
}

async function addLog($: EngineInterface, line: Omit<LogLine, 'at'>) {
  const at = await $.clock.now()
  await update($, log, list => [...list, { ...line, at }].slice(-50))
}

async function refreshStatus($: EngineInterface) {
  const [m, counts, list, adv] = await Promise.all([read($, main), read($, tools), read($, agents), read($, advisor)])
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const running = list.filter(a => a.status === 'running').length
  $.ui.status(t.statusLine(m.effort || '?', running, list.length, listening(adv.isOn), total, counts.git ?? 0))
}

// The `/agent-stack advisor` toggle and the advisorMode option both have to allow Fable.
function listening(isOn: boolean): boolean {
  return isOn && advisorMode !== 'off'
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

// Fable reads along and speaks up only when something looks off.
function advise($: EngineInterface, kind: Note['kind'], question: string, material: string) {
  $.clock.after(0, async () => {
    const adv = await read($, advisor)
    if (!adv.isOn) return
    await update($, advisor, a => ({ ...a, calls: a.calls + 1, last: `${t.kind[kind]}: ${question}` }))
    const r = await $.model.complete({
      model: advisorModel,
      effort: 'low',
      maxTokens: 300,
      system: t.advisorSystem,
      prompt: `${question}\n\n${material.slice(-12000)}`,
    })
    if (!r.isAnswered) return
    const text = r.text.trim()
    if (/^OK\b/i.test(text)) return
    await update($, advisor, a => ({ ...a, notes: [...a.notes, { kind, text }].slice(-6) }))
    $.ui.toast(`Fable: ${text}`)
  })
}

export const register: Register = (on, options) => {
  t = LANGUAGES[String(options.language)] ?? LANGUAGES.en!
  advisorModel = String(options.advisorModel || 'claude-fable-5-1')
  advisorMode = String(options.advisorMode || 'all')
  // Module variables reset on reload; the atoms above keep the shown state.
  const effortByCall = new Map<string, string>()
  const filesByAgent = new Map<string, Set<string>>()
  const seenStep = new Map<string, string>()
  let lastPrompt = ''
  let turnTools = 0
  let errorStreak = 0
  // What the main loop did this turn, so Fable judges the work and not only the answer.
  let trail: string[] = []
  let edited = new Set<string>()
  const material = () => t.material(lastPrompt, trail.join('\n'), [...edited].join('\n'))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-stack',
      description: t.commandDescription,
      argumentHint: `[${t.argAdvisor}|${t.argClear}]`,
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
      update($, advisor, a => ({ ...a, notes: a.notes.filter(n => n.kind in t.kind) })),
    ])
    void $.ui.open({ id: PANE, title: 'Agent Stack' })
    await refreshStatus($)

    return next(e)
  })

  on('command.run', { command: 'agent-stack' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === t.argAdvisor) {
      const a = await update($, advisor, v => ({ ...v, isOn: !v.isOn }))
      await refreshStatus($)
      return { text: t.advisorToggled(a.isOn) }
    }
    if (CLEAR_ARGS.includes(arg)) {
      await Promise.all([
        update($, tools, () => ({})),
        update($, agents, () => []),
        update($, log, () => []),
        update($, stats, () => ({ errors: {}, compactions: 0 })),
      ])
      await update($, advisor, a => ({ ...a, notes: [], last: '–' }))
      await refreshStatus($)
      return { text: t.cleared }
    }
    await $.ui.open({ id: PANE, title: 'Agent Stack' })
    return { text: t.opened }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      lastPrompt = e.text
      turnTools = 0
      errorStreak = 0
      trail = []
      edited = new Set()
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
    const git = cat === 'git' ? gitCommand(String((e as { command?: unknown }).command)) : undefined
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
      if (path && cat === 'edit') edited.add(path)
    }
    queueStatus($)

    if (e.tool === 'ExitPlanMode' && e.agentId === undefined && advisorMode !== 'off') {
      const plan = (await $.session.messages()).filter(m => m.role === 'assistant').at(-1)?.text ?? ''
      advise($, 'plan', t.askPlan, `${t.task}: ${lastPrompt}\n\n${t.plan}:\n${plan}`)
    }

    const ran = await next(e)
    if (ran.isError) await update($, stats, s => ({ ...s, errors: { ...s.errors, [cat]: (s.errors[cat] ?? 0) + 1 } }))
    if (git) {
      const id = e.agentId
      const who = id === undefined ? t.mainSession : ((await read($, agents)).find(a => a.id === id)?.type ?? id)
      await addLog($, { who, what: git, isGit: true, result: ran.deny !== undefined || ran.isError ? t.failed : 'ok' })
    }
    if (e.agentId === undefined && ran.deny === undefined) {
      trail = [...trail, `${e.tool} ${brief(e)} -> ${ran.isError ? `${t.failed}: ${String(ran.text ?? '').slice(0, 300)}` : 'ok'}`].slice(-40)
      errorStreak = ran.isError ? errorStreak + 1 : 0
      if (errorStreak === 3 && advisorMode === 'all') advise($, 'error', t.askErrors, material())
    }
    return ran
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
    await update($, agents, list => [...list, card].slice(-12))
    await addLog($, { who: e.subagentType, what: e.description, result: t.started })
    await refreshStatus($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const u = e.usage
      const tests = testsOf(e.answer)
      const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'cancelled' : 'error'
      seenStep.delete(id)
      const list = await update($, agents, all =>
        all.map(a =>
          a.id === id
            ? {
                ...a,
                status,
                input: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : a.input,
                output: u?.output_tokens ?? a.output,
                tests: tests ?? a.tests,
              }
            : a,
        ),
      )
      const card = list.find(a => a.id === id)
      if (card) {
        if (tests) {
          await addLog($, { who: card.type, what: tests.startsWith('PASS') ? t.testsPassed : t.testsFailed, result: tests })
        }
        await addLog($, { who: card.type, what: t.doneAfter(decimal(e.durationMs / 1000)), result: t.filesTools(card.files, card.tools) })
      }
      await refreshStatus($)
    } else if (e.reason === 'answer' && turnTools >= MIN_TOOLS_FOR_DONE_CHECK && advisorMode === 'all') {
      advise($, 'done', t.askDone, `${material()}\n\n${t.finalAnswer}:\n${e.answer}`)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [m, counts, list, lines, adv, usage, st, now] = await Promise.all([
      read($, main),
      read($, tools),
      read($, agents),
      read($, log),
      read($, advisor),
      $.session.usage(),
      read($, stats),
      $.clock.now(),
    ])
    const cols = e.props.bodyColumns
    const isWide = cols >= 100
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const most = Math.max(1, ...Object.values(counts))
    const barRoom = Math.max(6, Math.min(24, cols - (isWide ? 60 : 30)))
    const pct = usage.context.percent ?? 0
    const running = list.filter(a => a.status === 'running').length
    const workerModel = list.at(-1)?.model
    const rows: (readonly [Category, number])[] = CATEGORIES.map(c => [c, counts[c] ?? 0] as const)
    if (counts.other) rows.push(['other', counts.other])
    const whatRoom = Math.max(10, Math.min(40, cols - 50))
    const gitLines = lines.filter(l => l.isGit).slice(-3)

    const advisorBox = (
      <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1} width={isWide ? 30 : undefined}>
        <Text color="magenta" bold>fable</Text>
        {t.advisorLines.map(l => (l.startsWith(' ') ? <Text dimColor>{l}</Text> : <Text>{l}</Text>))}
        <Text dimColor>{t.advisorAbout}</Text>
        <Text dimColor>{t.last}</Text>
        <Text>» {adv.last}</Text>
        {adv.notes.slice(-3).map(n => (
          <Text color="yellow">! {t.kind[n.kind]}: {n.text}</Text>
        ))}
        <Text>{t.calls}  {adv.calls} {adv.isOn ? '' : `(${t.off})`}</Text>
        <Text>{t.context}  {kilo(usage.context.tokens ?? 0)}</Text>
      </Box>
    )

    const card = (a: Card) => (
      <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1} width={isWide ? 26 : undefined}>
        <Text bold>{a.type}</Text>
        <Text color="blue">{modelName(a.model)}</Text>
        <Text>
          <Text color="blue">{effortBar(a.effort)}</Text> {a.effort.slice(0, 3)}
        </Text>
        <Text>{a.task.slice(0, 22)}</Text>
        <Text color={a.tests?.startsWith('PASS') ? 'green' : a.status === 'error' || a.tests === 'FAIL' ? 'red' : undefined}>
          {a.tests ??
            (a.status === 'running'
              ? `⟳ ${Math.round((now - a.startedAt) / 1000)} s · ${a.files} ${t.files}`
              : `${t.status[a.status]} · ${a.files} ${t.files}`)}
        </Text>
        <Text dimColor>{t.context}  {kilo(a.input)}</Text>
        <Text dimColor>{t.output}  {kilo(a.output)}</Text>
      </Box>
    )

    const stack = (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column" borderStyle="single" borderColor="#d97757" paddingX={1} alignSelf="center">
          <Text color="#d97757">{modelName(m.model)} · {t.mainSession}</Text>
          <Text>{t.plansAndShips}</Text>
          <Text>
            effort <Text color="#d97757">{effortBar(m.effort)}</Text> {m.effort || '?'}
          </Text>
        </Box>
        <Box flexDirection="column" borderStyle="single" borderColor="green" paddingX={1}>
          <Box justifyContent="space-between">
            <Text color="green" bold>{t.toolsHeader}</Text>
            <Text>{t.total} {total}</Text>
          </Box>
          {rows.map(([c, n]) => (
            <Text>
              <Text color={c === 'git' ? 'yellow' : undefined} bold={c === 'git'}>{t.cat[c].padEnd(17)}</Text>
              <Text color={c === 'git' ? 'yellow' : 'green'}>{'█'.repeat(Math.round((n / most) * barRoom)).padEnd(barRoom)}</Text>
              {String(n).padStart(4)}{' '}
              {st.errors[c] ? <Text color="red">{t.errors(st.errors[c])}</Text> : <Text color="green">{t.ok}</Text>}
            </Text>
          ))}
          <Text>
            {t.context.padEnd(17)}
            <Text color={pct > 80 ? 'red' : 'green'}>{'█'.repeat(Math.round((pct / 100) * barRoom)).padEnd(barRoom)}</Text>
            {String(pct).padStart(4)} % <Text dimColor>{t.compactedTimes(st.compactions)}</Text>
          </Text>
          {gitLines.map(l => (
            <Text>
              <Text color="yellow" bold>{t.lastGit.padEnd(17)}</Text>
              <Text color={l.result === 'ok' ? 'yellow' : 'red'}>{l.what.slice(0, barRoom + 20)}</Text>
              <Text dimColor> {l.who.slice(0, 16)}</Text>
            </Text>
          ))}
        </Box>
        {workerModel && <Text color="blue">{'  '}{t.delegated(modelName(workerModel), running)}</Text>}
        <Box flexDirection={isWide ? 'row' : 'column'} flexWrap="wrap">
          {list.length === 0 ? <Text dimColor>{t.noSubagents}</Text> : list.slice(-4).map(card)}
        </Box>
        {list.length > 0 && <Text color="#d97757">{t.backTo(modelName(m.model))}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold>
          AGENT STACK · <Text color="#d97757">{modelName(m.model).split(' ')[0]?.toUpperCase()} {t.plans}</Text> ·{' '}
          {workerModel && <Text color="blue">{modelName(workerModel).split(' ')[0]?.toUpperCase()} {t.executes} · </Text>}
          {listening(adv.isOn) && <Text color="magenta">{t.watches}</Text>}
        </Text>
        <Box flexDirection={isWide ? 'row' : 'column'} gap={1}>
          {advisorBox}
          {stack}
        </Box>
        <Box flexDirection="column" borderStyle="single" paddingX={1}>
          <Text dimColor>{t.sessionLog}</Text>
          {lines.length === 0 && <Text dimColor>{t.empty}</Text>}
          {lines.slice(-8).map(l => (
            <Text>
              <Text dimColor>{clockTime(l.at)} </Text>
              <Text color="blue">{l.who.slice(0, 16).padEnd(17)}</Text>
              <Text color={l.isGit ? 'yellow' : undefined}>{l.what.slice(0, whatRoom).padEnd(whatRoom)}</Text> {l.result}
            </Text>
          ))}
        </Box>
        <Text dimColor>{t.statusLine(m.effort || '?', running, list.length, listening(adv.isOn), total, counts.git ?? 0)}</Text>
      </Box>
    )
  })
}
