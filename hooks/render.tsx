import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderChildren, RenderElement, RenderInput } from 'claude-code'

import type { Card, Check, Note } from '../types'
import { ago, breath, clip, clockTime, fit, isHigh, isNewer, kilo, modelName, percent, resetTime, shortPath, callText, smoothBar, spinner, width } from './format'
import { CATEGORIES } from './i18n'
import type { Category } from './i18n'
import { cfg, INIT, isLive, listening, liveStatus, liveTurn, PANE, rank, shapeInsights, VIEWS } from './state'
import { isCut, stepRows, turnSpan } from './steps'
import { BUCKET_COLOR, bucketName, cells, dur, focusList, liveBuckets, needsYou, shares, sparkline, topCounts } from './insights'
import { learnedItems, lt, totals, typicalCompact } from './learn'
import { droppedLines, editLine, isFlagged, lineText } from './testreview'
import { openBrowser, setPane } from './web'

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
const layout = atom({ plugin: 'agentmon-live', key: 'layout' } as const, INIT.layout)
const insights = atom({ plugin: 'agentmon-live', key: 'insights' } as const, INIT.insights)
const learned = atom({ plugin: 'agentmon-live', key: 'learned' } as const, INIT.learned)
const testReview = atom({ plugin: 'agentmon-live', key: 'testReview' } as const, INIT.testReview)
const trace = atom({ plugin: 'agentmon-live', key: 'trace' } as const, INIT.trace)
const steps = atom({ plugin: 'agentmon-live', key: 'steps' } as const, INIT.steps)
// Insights shown in Focus with details off; the rest wait for `d`.
const FOCUS_SHOWN = 3

const RESULT_COLOR: Record<Check['result'], string> = { ok: 'green', failed: 'red', running: 'cyan', unknown: 'gray' }

// Running subagents shown as cards. Calm folds the rest behind `a`; classic lists all one line each past six.
const MAX_CARDS = 4
const MAX_CARDS_CLASSIC = 6
// Sections calm leaves out unless they need the person; `v` (classic) shows them all.
const CALM_HIDDEN = ['insights', 'skills', 'usage']
// Room for the widest actor name in any language (`エージェント`, 12 cells) and a gap.
const ACTOR_COLS = 13
const STEP_GLYPH = { running: '', asking: '⏸', ok: '✓', failed: '✗', blocked: '⊘' }
const STEP_COLOR = { running: 'cyan', asking: 'yellow', ok: undefined, failed: 'red', blocked: 'red' }

// The last frame drawn, kept for `refreshRate`, and what it was drawn for.
let frame: { key: string; tree: RenderElement } | undefined

// Putting the test review away empties its list; its key stays out of `dismissed`, so the same edit later shows again.
async function dismissFocus($: EngineInterface, keys: readonly string[]) {
  const isReview = (key: string) => key.startsWith('testReview:')
  await update($, layout, l => ({ ...l, dismissed: [...(l.dismissed ?? []), ...keys.filter(k => !isReview(k))].slice(-50) }))
  if (keys.some(isReview)) await update($, testReview, () => INIT.testReview)
}

// A pane not on screen leaves one button above the prompt to bring it back, under what other mods draw there. The engine's panes decide, not the flag: `/clear` empties the state, and a pane too wide for the terminal waits unplaced. Reading the layout redraws this on a hide.
export async function drawBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, beneath: RenderElement) {
  const [, panes] = await Promise.all([read($, layout), $.ui.panes().catch(() => [])])
  if (e.props.hasSurvey || panes.some(x => x.id === PANE && x.isPlaced)) return beneath
  const { Box, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {beneath}
      <Button key="pane:show" plain hotkey="p" onPress={() => setPane($, true)}>{`▸ AgentMon Live · ${cfg.t.paneShow}`}</Button>
    </Box>
  )
}

// With a refresh rate, while work runs a change redraws the pane at the next period boundary; a key press, a resize,
// `c` or a clear (both write the advisor), a new urgent item and an idle pane redraw at once. A frame kept skips the other reads, so their writes do not redraw it;
// register.tsx's pulse, on each boundary, draws the next one.
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  if (cfg.refreshMs <= 0) return drawFresh($, e)
  const [lay, tab, adv, now, doing, checked, list] = await Promise.all([read($, layout), read($, view), read($, advisor), $.clock.now(), read($, active), read($, checks), read($, agents)])
  // Idle, the few writes left (the turn's last bookkeeping, a base or memory check) draw at once; only running work is held to the period.
  if (doing.length === 0 && !list.some(a => a.status === 'running')) return drawFresh($, e)
  // A new urgent item (a call waiting for approval, a failed check or subagent) redraws at once, not a period late.
  const urgentCount = [doing.filter(a => a.isAsking).length, checked.filter(c => c.result === 'failed').length, list.filter(a => a.status === 'error' || a.tests === 'FAIL').length]
  const key = JSON.stringify([lay, tab, adv, e.props.bodyColumns, e.surface, cfg.lang, cfg.isClassic, cfg.hidden, urgentCount, Math.floor(now / cfg.refreshMs)])
  if (frame?.key === key) return frame.tree
  const tree = await drawFresh($, e)
  frame = { key, tree }
  return tree
}

// Order, as the review asks: needs attention, running now, changes and verification, usage, then the folding history.
async function drawFresh($: EngineInterface, e: RenderInput<'Pane'>) {
  const t = cfg.t
  const { Box, Button, Link, Text } = $.ui.resolve(e)
  const [m, counts, stored, lines, adv, usage, st, now, recent, tab, doing, live, checked, touched, last, lay, planned, loaded, flows, insStored, learnt, reviewed, traced, stepped] = await Promise.all([
    read($, main),
    read($, tools),
    read($, agents),
    read($, log),
    read($, advisor),
    $.session.usage(),
    read($, stats),
    $.clock.now(),
    read($, calls),
    read($, view),
    read($, active),
    // The dashboard draws from its own cards when the engine cannot list agents.
    $.agent.list().catch(() => []),
    read($, checks),
    read($, files),
    read($, lastCall),
    read($, layout),
    read($, tasks),
    read($, skills),
    read($, flow),
    read($, insights),
    read($, learned),
    read($, testReview),
    read($, trace),
    read($, steps),
  ])
  const ins = { ...shapeInsights(insStored), turn: liveTurn.read ? liveTurn.read() : insStored?.turn }
  const statusOf = new Map(live.map(a => [a.id, liveStatus(a.status)]))
  const list = stored.map(a => ({ ...a, status: statusOf.get(a.id) ?? a.status }))
  const cols = e.props.bodyColumns
  const isWide = cols >= 100
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const most = Math.max(1, ...Object.values(counts))
  // Two columns less than the row leaves, for the bar's end caps.
  const barRoom = Math.max(6, Math.min(24, cols - (isWide ? 62 : 32)))
  const running = list.filter(isLive).length
  const workerModel = list.at(-1)?.model
  // Only categories the session used; a column of zeros says nothing.
  const rows = [...CATEGORIES, 'other' as const].map(c => [c, counts[c] ?? 0] as const).filter(([, n]) => n > 0)
  const whatRoom = Math.max(10, Math.min(40, cols - 50))
  // An approval with a label shows the command beside it: the two share the room one of them had.
  const halfRoom = Math.floor(whatRoom / 2)
  const shown = recent.filter(c => c.view === tab).slice(-5)
  const perMin = (cat: string) => flows.filter(f => f.cat === cat && now - f.at < 60_000).length
  // The person's switch (`v`) beats the `layout` option.
  const isClassic = lay.isClassic ?? cfg.isClassic
  // Calm: a breathing dot, and running times that move in 5 s steps, so fewer cells change each redraw.
  const spin = isClassic ? spinner : breath
  const secs = (from: number) => (isClassic ? ago(now - from) : now - from < 5000 ? '<5 s' : ago(Math.floor((now - from) / 5000) * 5000))
  // Details off cuts long texts to the room they have; on, they are drawn whole.
  const cut = (s: string, n: number) => (lay.isDetailed || width(s) <= n ? s : `${clip(s, n - 1)}…`)
  const isStale = (c: Check) => c.result !== 'running' && touched.editedAt > c.at
  const bar = (part: number, color: string) => (
    <Text>
      <Text dimColor>▕</Text>
      <Text color={color}>{smoothBar(part, barRoom)}</Text>
      <Text dimColor>▏</Text>
    </Text>
  )
  // A status word on a coloured ground, as the mockup's chips.
  const chip = (label: string, color: string) => (
    <Text backgroundColor={color} color="black" bold>
      {` ${label.toUpperCase()} `}
    </Text>
  )
  const title = (label: string, color?: string) => (
    <Text color={color} bold>
      ● {label.toUpperCase()}
    </Text>
  )
  const checkLabel = (c: Check) => (c.result === 'running' ? t.status.running : c.result === 'unknown' ? t.unknown : c.result === 'ok' ? t.ok : t.failed)

  // Each item: its row, a key to put it away by (none: it cannot be dismissed), and a prompt to look into it.
  type Item = { key?: string; row: RenderChildren; prompt?: string; isGlobal?: boolean }
  const errorOf = (c: Check) => recent.find(x => x.at === c.at && x.error)?.error
  // Approvals and waiting subagents cannot be put away here: they leave when answered.
  const items: Item[] = needsYou({ doing, streak: st.streak ?? 0, checks: checked, agents: list, turnAt: m.turnAt }).map((u): Item => {
    if (u.kind === 'ask') return { row: <Text>{chip(t.approval, 'yellow')} <Text bold>{u.call.tool}</Text> {cut(callText(u.call), u.call.label ? halfRoom : whatRoom)}{u.call.label ? <Text dimColor> {cut(u.call.what, whatRoom - halfRoom)}</Text> : null}</Text> }
    if (u.kind === 'streak') return { key: u.key, row: <Text>{chip(t.status.error, 'red')} {t.errorsInRow(u.n)}</Text>, prompt: t.investigateErrors(u.n) }
    if (u.kind === 'check') {
      const c = u.check
      return {
        key: u.key,
        row: (
          <Text>
            {chip(t.failed, 'red')} <Text bold>{t.check[c.kind]}</Text> {cut(c.command, whatRoom)}
          </Text>
        ),
        prompt: t.investigateCheck(t.check[c.kind], c.command, (errorOf(c) ?? '').slice(0, 600)),
      }
    }
    const a = u.agent
    if (u.kind === 'agent')
      return {
        key: u.key,
        row: (
          <Text>
            {chip(a.tests === 'FAIL' ? 'FAIL' : t.status.error, 'red')} <Text bold>{a.type}</Text> {cut(a.task, 22)}
            {a.tests === 'FAIL' && <Text dimColor> ({t.reported}{a.testsWhy ? `: ${cut(a.testsWhy, whatRoom)}` : ''})</Text>}
          </Text>
        ),
        prompt: t.investigateAgent(a.type, a.task, a.tests === 'FAIL' ? (a.testsWhy ?? 'FAIL') : t.status.error),
      }
    return { row: <Text>{chip(t.status.waiting, 'yellow')} <Text bold>{a.type}</Text> {cut(a.task, 22)}</Text> }
  })
  const dismissed = new Set(lay.dismissed ?? [])
  const urgent = items.filter(x => !x.key || !dismissed.has(x.key))
  // Below what needs the person: what is worth a look, most important first.
  const learnedFocus = learnedItems(learnt, { percent: usage.context.percent, window: usage.context.window, model: m.model, effort: m.effort, calls: ins.turnCalls })
  const isCurrent = (n: Note) => n.at !== undefined && n.at >= (m.turnAt ?? 0)
  const found = focusList({ ins, doing, agents: list, percent: usage.context.percent, window: usage.context.window, tokens: usage.context.tokens, now, learned: learnedFocus, base: cfg.base, edited: touched.edited, testReview: reviewed, leaks: cfg.leaks }).filter(x => !dismissed.has(x.key))
  const insightItems: Item[] = found.slice(0, lay.isDetailed ? found.length : FOCUS_SHOWN).map(x => ({
    key: x.key,
    row: (
      <Text>
        {chip(x.tag, x.color)} {cut(x.text, whatRoom + 40)}
      </Text>
    ),
    prompt: x.prompt,
    isGlobal: x.isGlobal,
  }))
  const moreInsights = found.length - insightItems.length
  const shownItems = [...urgent, ...insightItems]
  // `x` puts away the notes first; what needs the person goes only when nothing else is left to put away.
  const dismissable = (insightItems.length ? insightItems : urgent).flatMap(x => (x.key ? [x.key] : []))
  // Approval rows have no prompt, so `i` goes to the first row that does.
  const firstPrompt = shownItems.findIndex(x => x.prompt)
  // Investigate drafts a prompt in the prompt box; nothing is sent until the person sends it, and a draft there is kept.
  const investigate = async (prompt: string) => {
    const box = await $.prompt.read()
    await (box.text.trim() ? $.prompt.fill({ text: `\n\n${prompt}`, mode: 'append' }) : $.prompt.fill({ text: prompt, mode: 'replace' }))
  }
  const firstGlobal = shownItems.findIndex(x => x.isGlobal)
  const attention = shownItems.flatMap((x, i) => [
    ...(i === firstGlobal ? [<Text dimColor>{t.ins.environment}</Text>] : []),
    <Box gap={1}>
      {x.row}
      {x.prompt && (
        <Button key={`investigate:${i}`} plain hotkey={i === firstPrompt ? 'i' : undefined} onPress={() => investigate(x.prompt ?? '')}>
          {t.investigate}
        </Button>
      )}
    </Box>,
  ])

  // A subagent card is 30 columns and six rows, so three sit side by side in a narrow pane.
  const CARD = 30
  const statusChip = (a: Card) =>
    chip(a.tests === 'FAIL' ? 'FAIL' : t.status[a.status], a.status === 'error' || a.tests === 'FAIL' ? 'red' : a.status === 'done' ? 'green' : isLive(a) ? 'cyan' : 'gray')
  const card = (a: Card) => (
    <Box flexDirection="column" borderStyle="round" borderColor={isLive(a) ? 'cyan' : 'blue'} paddingX={1} width={CARD}>
      <Text>
        <Text bold>{cut(a.type, CARD - 7 - width(a.tests === 'FAIL' ? 'FAIL' : t.status[a.status]))}</Text> {statusChip(a)}
      </Text>
      <Text color="blue">
        {modelName(a.model)} <Text dimColor>· {a.effort || '?'}</Text>
      </Text>
      <Text>{cut(a.task, CARD - 4)}</Text>
      <Text color={a.tests?.startsWith('PASS') ? 'green' : a.tests === 'FAIL' ? 'red' : undefined} dimColor={!a.tests}>
        {cut(
          a.tests
            ? `${a.tests} ${t.reported}`
            : isLive(a)
              ? `⟳ ${secs(a.startedAt)} · ${a.files} ${t.files}`
              : `${kilo(a.input)} / ${kilo(a.output)} · ${a.files} ${t.files}`,
          CARD - 4,
        )}
      </Text>
    </Box>
  )
  // Calm: a call's row and the last call's row stay one line each, cut at the edge, so swapping one for the other moves nothing.
  const rowWrap = isClassic ? undefined : ('truncate-end' as const)
  // Past four running subagents, the first four stay cards and the rest fold behind `a`; open, one line each.
  const agentLine = (a: Card) => (
    <Text wrap={rowWrap}>
      <Text color="cyan">{spin(now)} </Text>
      <Text bold>{fit(a.type, 18)}</Text>
      <Text color="blue">{fit(modelName(a.model), 11)}</Text>
      {fit(cut(a.task, whatRoom), whatRoom + 1)}
      <Text dimColor>{secs(a.startedAt)} · {a.files} {t.files}</Text>
    </Text>
  )
  const liveAgents = list.filter(isLive)
  const maxCards = isClassic ? MAX_CARDS_CLASSIC : MAX_CARDS
  const isFolded = !isClassic && liveAgents.length > maxCards && !lay.isAgentsOpen
  // The first four by start, so the cards stay put while the agents work.
  const cardAgents = isFolded ? liveAgents.slice(0, maxCards) : liveAgents
  const callRows = doing.length > 0 ? Math.min(3, doing.length) : last ? 1 : 0
  // Calm: Running now always keeps three rows, so the sections below do not jump with each call or turn.
  const padRows = isClassic ? 0 : Math.max(0, 3 - callRows)

  const lastText = last ? callText(last) : ''
  const runningNow = (
    <Box flexDirection="column">
      {doing.slice(-3).flatMap(a => [
        <Text wrap={rowWrap}>
          <Text color="cyan">{spin(now)} </Text>
          <Text bold>{fit(a.tool, 10)}</Text>
          {fit(cut(callText(a), whatRoom), whatRoom + 1)}
          <Text dimColor>{a.who.slice(0, 16)}{a.model ? ` · ${modelName(a.model)}` : ''} · {secs(a.startedAt)}</Text>
        </Text>,
        // On its own row: beside the label a long command pushed who runs it and for how long off the row.
        ...(lay.isDetailed && a.label ? [<Text dimColor wrap={rowWrap}>{'  '}{a.what}</Text>] : []),
      ])}
      {doing.length === 0 && last && (
        <Text dimColor wrap={rowWrap}>
          {t.lastCall} · {last.tool}{lastText ? ` ${cut(lastText, whatRoom)}` : ''} · {last.who.slice(0, 16)}{last.model ? ` · ${modelName(last.model)}` : ''} · {t.ago(secs(last.at))}
        </Text>
      )}
      {Array.from({ length: padRows }, () => (
        <Text> </Text>
      ))}
      {liveAgents.length > maxCards && !isFolded ? (
        <Box flexDirection="column">{liveAgents.map(agentLine)}</Box>
      ) : (
        cardAgents.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap">
            {cardAgents.map(card)}
          </Box>
        )
      )}
      {!isClassic && liveAgents.length > maxCards && (
        <Button key="fold:agents" plain hotkey="a" onPress={() => update($, layout, l => ({ ...l, isAgentsOpen: !l.isAgentsOpen }))}>
          {isFolded ? `▸ ${t.moreAgents(liveAgents.length - maxCards)}` : `▾ ${t.agentsAll(liveAgents.length)}`}
        </Button>
      )}
    </Box>
  )

  // The session's task list: how far it is, what runs now, and every task with details on.
  const doneTasks = planned.filter(k => k.status === 'completed').length
  const current = planned.find(k => k.status === 'in_progress')
  const taskBox = planned.length > 0 && (
    <Box flexDirection="column">
      <Text>
        {title(t.tasks, 'green')} {doneTasks}/{planned.length} {bar(doneTasks / planned.length, 'green')}
      </Text>
      {current && (
        <Text>
          <Text color="cyan">{spin(now)} </Text>
          {cut(current.activeForm || current.subject, whatRoom + 20)}
        </Text>
      )}
      {lay.isDetailed &&
        planned.map(k => (
          <Text dimColor={k.status === 'completed'}>
            {'  '}{k.status === 'completed' ? '✓' : k.status === 'in_progress' ? '▸' : '·'} {k.subject}
          </Text>
        ))}
    </Box>
  )

  // The turn step by step, newest first: who acted, on what, for how long.
  const span = turnSpan(ins)
  const stepList = span ? stepRows({ trace: traced, steps: stepped, active: doing }, span) : []
  const stepsShown = stepList.slice(0, lay.isDetailed ? 30 : isClassic ? 10 : 5)
  const stepsBox = stepList.length > 0 && (
    <Box flexDirection="column">
      <Text>{title(t.steps, 'cyan')}</Text>
      {stepsShown.map(r => (
        <Text wrap={rowWrap}>
          <Text color={STEP_COLOR[r.state]} dimColor={r.state === 'ok'}>{r.state === 'running' ? spin(now) : STEP_GLYPH[r.state]} </Text>
          <Text dimColor>{fit(t.actor[r.actor], ACTOR_COLS)}</Text>
          {fit(cut(r.label, whatRoom), whatRoom + 1)}
          <Text dimColor>{r.count > 1 ? `×${r.count} ` : ''}{r.state === 'running' || r.state === 'asking' ? secs(r.at) : dur(r.ms)}</Text>
        </Text>
      ))}
      {span && stepsShown.length === stepList.length && isCut({ trace: traced, steps: stepped }, span) ? <Text dimColor>  … {t.web.page.stepsCut}</Text> : null}
    </Box>
  )

  // Skills and prompt commands whose text the session loaded, the latest first.
  const skillBox = loaded.length > 0 && (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      {title(`${t.cat.skills} · ${loaded.length}`, 'yellow')}
      {loaded.slice(lay.isDetailed ? -30 : -5).reverse().map(s => (
        <Text>
          {fit(s.name, whatRoom + 1)}
          <Text dimColor>×{s.count} · {s.who.slice(0, 16)} · {t.ago(secs(s.at))}</Text>
        </Text>
      ))}
    </Box>
  )

  const changes = (touched.edited.length > 0 || touched.read.length > 0 || checked.length > 0) && (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexGrow={1}>
      {title(t.changes, 'cyan')}
      <Text>
        {t.edited(touched.edited.length)} <Text dimColor>· {t.readFiles(touched.read.length)}</Text>
      </Text>
      {touched.edited.slice(lay.isDetailed ? -20 : -3).map(p => (
        <Text dimColor>  {lay.isDetailed ? p : shortPath(p)}</Text>
      ))}
      {checked.map(c => (
        <Text>
          {fit(t.check[c.kind], 12)}
          {c.result === 'unknown' ? <Text dimColor>{t.unknown}</Text> : chip(checkLabel(c), RESULT_COLOR[c.result])} {isStale(c) && <Text>{chip(t.stale, 'yellow')} </Text>}
          <Text dimColor>{cut(`${c.ran !== undefined ? `${t.testsRan(c.ran, c.skipped ?? 0)} · ` : ''}${c.dir ? `${c.dir}: ` : ''}${c.command}`, whatRoom)}</Text>
        </Text>
      ))}
      {reviewed.files.map(f => (
        <Box flexDirection="column">
          <Text color={isFlagged(f) ? 'yellow' : undefined} dimColor={!isFlagged(f)}>{cut(editLine(t, f), whatRoom + 20)}</Text>
          {(f.lines ?? []).slice(lay.isDetailed ? -5 : -2).flatMap(lineText).map(line => <Text dimColor>  {cut(line, whatRoom + 16)}</Text>)}
        </Box>
      ))}
      {reviewed.isGreen && droppedLines(t, reviewed).map(line => <Text color="yellow">{cut(line, whatRoom + 20)}</Text>)}
    </Box>
  )

  const pct = usage.context.percent
  const usageBox = (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} flexGrow={1}>
      {title(t.usage)}
      <Text>
        {fit(t.context, 18)}
        {pct === undefined ? (
          <Text dimColor>{t.unavailable}</Text>
        ) : (
          <Text>
            {bar(pct / 100, isHigh(pct) ? 'red' : 'green')}
            {String(pct).padStart(4)} % <Text dimColor>{usage.context.tokens === undefined ? '' : `${kilo(usage.context.tokens)} / ${kilo(usage.context.window)} · `}{t.compactedTimes(st.compactions)}</Text>
          </Text>
        )}
      </Text>
      {usage.cost && <Text>{fit(t.costWord, 18)}${usage.cost.usd.toFixed(2)}</Text>}
      {adv.calls > 0 && <Text>{fit('fable', 18)}{t.calls} {adv.calls}{cfg.advisorBudget > 0 ? `/${cfg.advisorBudget}` : ''} · {t.advisorTokens(kilo(adv.tokensIn ?? 0), kilo(adv.tokensOut ?? 0))}</Text>}
      {usage.rateLimits.map(r => (
        <Text>
          {fit(r.kind, 18)}
          {bar(r.percentUsed / 100, isHigh(r.percentUsed) ? 'red' : 'yellow')}
          {String(Math.round(r.percentUsed)).padStart(4)} %{' '}
          <Text dimColor>{r.resetsAt && !Number.isNaN(Date.parse(r.resetsAt)) ? t.resets(resetTime(Date.parse(r.resetsAt), now)) : ''}</Text>
        </Text>
      ))}
    </Box>
  )

  const isListening = listening(adv.isOn)
  const advisorState =
    !isListening ? `(${t.off})`
    : adv.state === 'checking' ? t.checking
    : adv.state === 'unavailable' ? `(${t.unavailable}${adv.why ? `: ${adv.why}` : ''})`
    : adv.state === 'budget' ? `(${t.budgetUsed})`
    : cfg.advisorMode === 'gate' ? `(${t.gateOnly})`
    : ''
  // The box answers one question: did Claude stop with work left open? Gone once the next turn starts.
  const lastVerdict = adv.notes.findLast(n => n.kind === 'done' || n.kind === 'check')
  const verdict = lastVerdict && isCurrent(lastVerdict) ? lastVerdict : undefined
  const gaps = [...(verdict?.text.split('\n').filter(Boolean) ?? []), ...(verdict?.fix ? [`→ ${verdict.fix}`] : [])]
  // The session's earlier results, newest first: three, all with details on.
  const earlier = adv.notes.filter(n => (n.kind === 'done' || n.kind === 'check') && n !== verdict).reverse()
  const advisorBox = (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text>
        {title(t.gateTitle, 'magenta')}{' '}
        <Text color={adv.state === 'checking' ? 'cyan' : adv.state === 'unavailable' ? 'red' : undefined} dimColor={adv.state !== 'checking'}>
          {advisorState}
        </Text>
      </Text>
      {!verdict ? (
        <Text dimColor>{t.advisorAbout}</Text>
      ) : verdict.ok ? (
        <Text>
          <Text color="green">✓</Text> {t.gatePassed}
        </Text>
      ) : (
        <Box flexDirection="column">
          <Text color={verdict.isSent ? 'cyan' : 'yellow'} bold>
            {verdict.isSent ? `↩ ${t.gateSent}` : `⚠ ${t.gateLeft}`}
          </Text>
          {gaps.map(g => (
            <Text>  {g.startsWith('→') ? g : `- ${g}`}</Text>
          ))}
        </Box>
      )}
      {verdict && (
        <Box gap={1}>
          <Text dimColor>  ↳ {t.ago(secs(verdict.at ?? now))}{verdict.ref ? ` · ${verdict.ref}` : ''}</Text>
          {!verdict.ok && !verdict.isSent && (
            <Button key="advisor:investigate" plain hotkey="f" onPress={() => investigate(t.gateReason(gaps.map(g => `- ${g}`).join('\n')))}>
              {t.askClaude}
            </Button>
          )}
        </Box>
      )}
      {earlier.length > 0 && <Text dimColor>{t.gateEarlier}</Text>}
      {earlier.slice(0, lay.isDetailed ? earlier.length : 3).map(n => (
        <Text>
          {'  '}
          {n.ok ? <Text color="green">✓</Text> : n.isSent ? <Text color="cyan">↩</Text> : <Text color="yellow">⚠</Text>}{' '}
          <Text dimColor>{cut([t.ago(secs(n.at ?? now)), n.ref, n.ok ? undefined : n.text.split('\n')[0]].filter(Boolean).join(' · '), whatRoom + 30)}</Text>
        </Text>
      ))}
      {adv.calls > 0 && (
        <Text dimColor>
          {t.calls}  {adv.calls}{cfg.advisorBudget > 0 ? `/${cfg.advisorBudget}` : ''} · {t.advisorTokens(kilo(adv.tokensIn ?? 0), kilo(adv.tokensOut ?? 0))}
        </Text>
      )}
      {isListening && adv.state !== 'checking' && adv.state !== 'budget' && (
        <Button key="advisor:check" variant="primary" hotkey="c" onPress={() => undefined /* register.tsx takes this press in a ui.press hook */}>
          {t.checkNow}
        </Button>
      )}
    </Box>
  )

  const finished = list.filter(a => !isLive(a))
  const history = lay.isHistoryOpen && (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
        <Box justifyContent="space-between">
          {title(t.toolsHeader, 'green')}
          <Text>{t.total} {total}</Text>
        </Box>
        {rows.map(([c, n]) => (
          <Text>
            <Text color={c === 'git' ? 'yellow' : undefined} bold={c === 'git'}>{fit(t.cat[c], 18)}</Text>
            {bar(n / most, c === 'git' ? 'yellow' : 'green')}
            {String(n).padStart(4)}
            {perMin(c) > 0 && <Text color="cyan"> {perMin(c)}/min</Text>}
            {st.errors[c] ? <Text> <Text color="red">{t.errors(st.errors[c])}</Text></Text> : ''}
          </Text>
        ))}
        {total > 0 && (
          <Box gap={2}>
            {VIEWS.map(v => (
              <Button key={`view:${v}`} plain hotkey={v[0]} dimColor={v !== tab} onPress={() => update($, view, () => v)}>
                {t.cat[v]}
              </Button>
            ))}
          </Box>
        )}
        {total > 0 && shown.length === 0 && <Text dimColor>{t.empty}</Text>}
        {shown.map(c => (
          <Box flexDirection="column">
            <Text>
              <Text dimColor>{clockTime(c.at)} </Text>
              <Text color={c.result === 'running' ? 'cyan' : c.result !== 'ok' ? 'red' : c.view === 'git' ? 'yellow' : undefined}>
                {c.result === 'running' ? `${spin(now)} ` : ''}{cut(c.what, barRoom + 20)}
              </Text>
              <Text dimColor> {c.who.slice(0, 16)}</Text>
            </Text>
            {lay.isDetailed && c.error && <Text color="red">  {c.error}</Text>}
          </Box>
        ))}
      </Box>
      {workerModel && <Text color="blue">{'  '}{t.delegated(modelName(workerModel), running)}</Text>}
      <Box flexDirection="row" flexWrap="wrap">
        {finished.slice(-(isWide ? 4 : 3)).map(card)}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Text dimColor>{t.sessionLog}</Text>
        {lines.length === 0 && <Text dimColor>{t.empty}</Text>}
        {lines.slice(-8).map(l => (
          <Text>
            <Text dimColor>{clockTime(l.at)} </Text>
            <Text color="blue">{fit(l.who, 17)}</Text>
            <Text>{fit(cut(l.what, whatRoom), whatRoom + 1)}</Text>{l.result}
          </Text>
        ))}
      </Box>
    </Box>
  )

  // Insights: where the time went, what fills the context, where the session works.
  const ti = t.ins
  const stackRoom = Math.max(10, Math.min(40, cols - 40))
  const stack = (buckets: Record<string, number>) => {
    const parts = shares(buckets)
    const widths = cells(parts.map(p => p[2]), stackRoom)
    return (
      <Text>
        <Text dimColor>▕</Text>
        {parts.map(([k], i) => (
          <Text color={BUCKET_COLOR[k] ?? 'gray'}>{'█'.repeat(widths[i] ?? 0)}</Text>
        ))}
        <Text dimColor>▏</Text>
      </Text>
    )
  }
  const legend = (buckets: Record<string, number>) => (
    <Text>
      {'  '}
      {shares(buckets)
        .slice(0, lay.isDetailed ? undefined : 5)
        .map(([k, ms, f], i) => (
          <Text>
            {i > 0 ? <Text dimColor> · </Text> : ''}
            <Text color={BUCKET_COLOR[k] ?? 'gray'}>{bucketName(k)}</Text> {Math.round(f * 100)}%{lay.isDetailed ? <Text dimColor> {dur(ms)}</Text> : ''}
          </Text>
        ))}
    </Text>
  )
  const shownTurn = ins.turn ?? ins.last
  const turnBuckets = ins.turn ? liveBuckets(ins.turn, now) : ins.last?.buckets
  const turnWall = ins.turn ? now - ins.turn.startedAt : (ins.last?.wallMs ?? 0)
  const ctxNow = ins.ctx.at(-1)
  const ctxDelta = ins.last?.ctxStart !== undefined && ins.last.ctxEnd !== undefined ? ins.last.ctxEnd - ins.last.ctxStart : undefined
  const cachePct = ins.cacheTotal > 0 ? percent(ins.cacheRead, ins.cacheTotal) : undefined
  const allIn = ins.tokens.mainIn + ins.tokens.agentsIn
  const areaList = topCounts(ins.turnAreas, 4, 1).map(([a, n]) => `${a} ${n}`).join(' · ')
  const rereads = topCounts(ins.reads, 2, 2).map(([p, n]) => `${shortPath(p)} ${n}×`).join(', ')
  const churned = topCounts(ins.edits, 2, 2).map(([p, n]) => `${shortPath(p)} ${n}×`).join(', ')
  const hasInsights = shownTurn !== undefined || ins.slow.length > 0 || ins.ctx.length > 0
  const insightBox = hasInsights && (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} flexGrow={1}>
      {title(ti.title, 'blue')}
      {shownTurn && turnBuckets && (
        <Box flexDirection="column">
          <Text>
            {fit(ins.turn ? ti.thisTurn(dur(turnWall)) : ti.lastTurn(dur(turnWall)), 22)}
            {stack(turnBuckets)}
          </Text>
          {legend(turnBuckets)}
        </Box>
      )}
      {ins.turns > 1 && (
        <Text>
          {fit(ti.session(dur(ins.sessionWall), ins.turns), 22)}
          {stack(ins.session)}
        </Text>
      )}
      {ins.slow.length > 0 && <Text dimColor>{ti.slowest}</Text>}
      {ins.slow.slice(0, lay.isDetailed ? 8 : 3).map((s, i) => (
        <Box gap={1}>
          <Text>
            <Text color={s.ms >= 60_000 ? 'yellow' : undefined}>{dur(s.ms).padStart(7)}</Text> <Text bold>{fit(s.tool, 10)}</Text>
            {fit(cut(callText(s), whatRoom), whatRoom + 1)}
            {/* A narrow pane keeps room for investigate over who ran the call. */}
            {isWide && <Text dimColor>{s.who.slice(0, 16)}</Text>}
          </Text>
          {/* `i` belongs to Focus when it has something to ask; else to the slowest call. */}
          <Button key={`investigate:slow:${i}`} plain hotkey={i === 0 && firstPrompt < 0 ? 'i' : undefined} onPress={() => investigate(ti.promptSlowDone(s.tool, s.what, dur(s.ms)))}>
            {t.investigate}
          </Button>
        </Box>
      ))}
      {ins.ctx.length > 0 && (
        <Text>
          {fit(ti.context, 10)}
          <Text color={isHigh(pct ?? 0) ? 'red' : 'cyan'}>{sparkline(ins.ctx, Math.min(40, stackRoom))}</Text>{' '}
          <Text dimColor>{ti.ctxLine(kilo(ctxNow ?? 0), !ctxDelta ? '' : `${ctxDelta >= 0 ? '+' : ''}${kilo(ctxDelta)}`, cachePct, st.compactions)}</Text>
        </Text>
      )}
      {ins.big.slice(0, lay.isDetailed ? 6 : 2).map(b => (
        <Text dimColor>
          {'  '}≈{kilo(b.tokens).padStart(6)} {b.tool} {cut(callText(b), whatRoom)}
        </Text>
      ))}
      {lay.isDetailed && ins.breakdown && ins.breakdown.length > 0 && (
        <Text dimColor>
          {'  '}
          {ins.breakdown.map(c => `${c.name} ${kilo(c.tokens)}`).join(' · ')}
          {ins.mcpTokens ? ` · MCP ${kilo(ins.mcpTokens)}` : ''}
          {ins.memoryTokens ? ` · CLAUDE.md ${kilo(ins.memoryTokens)}` : ''}
        </Text>
      )}
      {allIn > 0 && (
        <Text dimColor>
          {ti.tokens(kilo(allIn), ins.tokens.mainIn > 0 ? percent(ins.tokens.mainCached, ins.tokens.mainIn) : '0', kilo(ins.tokens.mainOut + ins.tokens.agentsOut), Math.round((ins.tokens.agentsIn / allIn) * 100))}
        </Text>
      )}
      {ins.turnSwitches > 0 && areaList && <Text>{cut(ti.areas(ins.turnSwitches, areaList), whatRoom + 40)}</Text>}
      {(rereads || churned) && (
        <Text dimColor>
          {[rereads && `${ti.reread} ${rereads}`, churned && `${ti.editedOften} ${churned}`].filter(Boolean).join(' · ')}
        </Text>
      )}
      {lay.isDetailed && ins.modelSwitches > 0 && <Text dimColor>{ti.modelSwitches(ins.modelSwitches)}</Text>}
      {learnt.sessions.length > 0 && <Text dimColor>{lt().learnedLine(learnt.sessions.length, typicalCompact(totals(learnt), usage.context.window))}</Text>}
    </Box>
  )

  // What each section last did and whether it needs the person now; `rank` orders them by it. Listed in the usual order.
  const latest = (...at: number[]) => Math.max(0, ...at)
  const sections = rank(
    [
      { key: 'tasks', node: taskBox, isUrgent: false, at: latest(...planned.map(k => k.at ?? 0)) },
      { key: 'steps', node: stepsBox, isUrgent: false, at: stepList[0]?.at ?? 0 },
      { key: 'insights', node: insightBox, isUrgent: false, at: ins.turn ? now : ins.last ? ins.last.startedAt + ins.last.wallMs : 0 },
      { key: 'skills', node: skillBox, isUrgent: false, at: latest(...loaded.map(s => s.at)) },
      { key: 'advisor', node: advisorBox, isUrgent: !!verdict && !verdict.ok && !verdict.isSent, at: verdict?.at ?? 0 },
      { key: 'changes', node: changes, isUrgent: checked.some(c => c.result === 'failed' && !isStale(c)), at: latest(touched.editedAt, ...checked.map(c => c.at)) },
      { key: 'usage', node: usageBox, isUrgent: isHigh(pct ?? 0) || usage.rateLimits.some(r => isHigh(r.percentUsed)), at: 0 },
    ].filter(s => s.node && !cfg.hidden.includes(s.key) && (isClassic || s.isUrgent || !CALM_HIDDEN.includes(s.key))),
    now,
    isClassic,
  )

  const slowest = ins.slow[0]
  // A newer GitHub release: `update` drafts the commands, `changelog` folds out what changed.
  const release = cfg.release && isNewer(cfg.release.version, cfg.version) ? cfg.release : undefined

  return (
    <Box flexDirection="column">
      {/* Title on its own row: beside the keys it gets a narrow column and wraps word by word. */}
      <Text bold>
        AGENTMON LIVE · <Text color="#d97757">{modelName(m.model).toUpperCase()} {t.plans}</Text>
        {m.effort && <Text color="#d97757" bold={false}> ({m.effort})</Text>}
        {workerModel && <Text color="blue"> · {modelName(workerModel).toUpperCase()} {t.executes}</Text>}
        {listening(adv.isOn) && <Text color="magenta"> · {t.watches}</Text>}
        {cfg.build && <Text dimColor bold={false}> {cfg.build}</Text>}
      </Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Button key="layout:switch" plain hotkey="v" onPress={() => update($, layout, l => ({ ...l, isClassic: !(l.isClassic ?? cfg.isClassic) }))}>
        {`◐ ${isClassic ? t.layoutClassic : t.layoutCalm}`}
      </Button>
      {cfg.webOn && cfg.webUrl && (
        <Button key="web:open" plain hotkey="o" onPress={() => openBrowser($).then(({ isOpen, link }) => (isOpen ? undefined : $.ui.toast(t.web.noBrowser(link))))}>
          {t.web.open}
        </Button>
      )}
      <Button key="pane:hide" plain hotkey="p" onPress={() => setPane($, false)}>{`◂ ${t.paneHide}`}</Button>
      {/* Narrower, the address wraps the header row; `o` still opens it. */}
      {cfg.webOn && cfg.webUrl && cols >= 130 && <Link href={cfg.webUrl}>{cfg.webUrl}</Link>}
      {release && (
        <Button key="update" plain hotkey="u" onPress={() => investigate(t.promptUpdate(cfg.version, release.version))}>
          {t.update}
        </Button>
      )}
      {release && release.notes && (
        <Button key="changelog" plain hotkey="l" dimColor={!lay.isChangelogOpen} onPress={() => update($, layout, l => ({ ...l, isChangelogOpen: !l.isChangelogOpen }))}>
          {`${lay.isChangelogOpen ? '▾' : '▸'} ${t.changelog}`}
        </Button>
      )}
      </Box>
      {release && lay.isChangelogOpen && release.notes && (
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          {title(`${t.changelog} ${release.version}`, 'green')}
          {release.notes.split('\n').filter(line => line.trim()).map(line => <Text>{line}</Text>)}
        </Box>
      )}
      {attention.length > 0 ? (
        <Box flexDirection="column" borderStyle="round" borderColor={urgent.length > 0 ? 'red' : 'yellow'} paddingX={1}>
          <Box justifyContent="space-between">
            {title(urgent.length > 0 ? `${ti.focus} · ${t.attention}` : ti.focus, urgent.length > 0 ? 'red' : 'yellow')}
            {dismissable.length > 0 && (
              <Button key="attention:dismiss" plain hotkey="x" onPress={() => dismissFocus($, dismissable)}>
                {t.dismiss}
              </Button>
            )}
          </Box>
          {attention}
          {moreInsights > 0 && <Text dimColor>+{moreInsights} · {t.details} (d)</Text>}
        </Box>
      ) : (
        // Always on top: when nothing needs a look, where the last turn's time went.
        <Box gap={1}>
        <Text>
          {title(ti.focus, 'green')} <Text dimColor>{ti.allClear}</Text>
          {shownTurn && turnBuckets && (
            <Text dimColor>
              {' · '}
              {ins.turn ? ti.thisTurn(dur(turnWall)) : ti.lastTurn(dur(turnWall))}
              {shares(turnBuckets)
                .slice(0, 3)
                .map(([k, , f]) => ` · ${bucketName(k)} ${Math.round(f * 100)}%`)
                .join('')}
            </Text>
          )}
        </Text>
        {/* With Insights hidden, `i` still reaches the slowest call from here. */}
        {slowest && !sections.some(s => s.key === 'insights') && (
          <Button key="investigate:slowest" plain hotkey="i" onPress={() => investigate(ti.promptSlowDone(slowest.tool, slowest.what, dur(slowest.ms)))}>
            {t.investigate}
          </Button>
        )}
        </Box>
      )}
      {runningNow}
      {/* A wrapping column measures notes one line high, a shrinking one squeezes boxes below their text. */}
      <Box flexDirection={isWide ? 'row' : 'column'} flexWrap={isWide ? 'wrap' : 'nowrap'} gap={isWide ? 1 : 0}>
        {sections.map(s => (
          <Box key={s.key} flexDirection="column" flexShrink={0} flexGrow={isWide ? 1 : 0}>
            {s.node}
          </Box>
        ))}
      </Box>
      <Box gap={2}>
        <Button key="fold:history" plain hotkey="h" onPress={() => update($, layout, l => ({ ...l, isHistoryOpen: !l.isHistoryOpen }))}>
          {`${lay.isHistoryOpen ? '▾' : '▸'} ${t.history}`}
        </Button>
        <Button key="details" plain hotkey="d" dimColor={!lay.isDetailed} onPress={() => update($, layout, l => ({ ...l, isDetailed: !l.isDetailed }))}>
          {`${lay.isDetailed ? '●' : '○'} ${t.details}`}
        </Button>
      </Box>
      {history}
    </Box>
  )
}
