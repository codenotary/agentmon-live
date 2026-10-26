import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import type { Card, Check } from '../types'
import { ago, clockTime, fit, kilo, modelName, resetTime, shortPath, smoothBar, spinner } from './format'
import { CATEGORIES } from './i18n'
import type { Category } from './i18n'
import { drawFlow } from './flow'
import { cfg, INIT, isLive, listening, liveStatus, rank, shapeInsights, VIEWS } from './state'
import { isHigh, topology } from './topology'
import { BUCKET_COLOR, bucketName, cells, dur, focusList, liveBuckets, shares, sparkline } from './insights'

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
const tasks = atom({ plugin: 'agent-radar', key: 'tasks' } as const, INIT.tasks)
const skills = atom({ plugin: 'agent-radar', key: 'skills' } as const, INIT.skills)
const flow = atom({ plugin: 'agent-radar', key: 'flow' } as const, INIT.flow)
const layout = atom({ plugin: 'agent-radar', key: 'layout' } as const, INIT.layout)
const insights = atom({ plugin: 'agent-radar', key: 'insights' } as const, INIT.insights)
// Insights shown in Focus with details off; the rest wait for `d`.
const FOCUS_SHOWN = 3

const RESULT_COLOR: Record<Check['result'], string> = { ok: 'green', failed: 'red', running: 'cyan', unknown: 'gray' }

// Order, as the review asks: needs attention, running now, changes and verification, usage, then the folding history.
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const t = cfg.t
  const ui = $.ui.resolve(e)
  const { Box, Button, Text } = ui
  const [m, counts, stored, lines, adv, usage, st, now, recent, tab, doing, live, checked, touched, last, lay, planned, loaded, flows, insStored] = await Promise.all([
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
  ])
  const ins = shapeInsights(insStored)
  const statusOf = new Map(live.map(a => [a.id, liveStatus(a.status)]))
  const list = stored.map(a => ({ ...a, status: statusOf.get(a.id) ?? a.status }))
  const cols = e.props.bodyColumns
  const isWide = cols >= 100
  // The view switch; a mode an older version saved and this one no longer draws counts as the dashboard.
  const mode = lay.mode === 'flow' ? 'flow' : 'radar'
  const isRadar = mode === 'radar'
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const most = Math.max(1, ...Object.values(counts))
  // Two columns less than the row leaves, for the bar's end caps.
  const barRoom = Math.max(6, Math.min(24, cols - (isWide ? 62 : 32)))
  const running = list.filter(isLive).length
  const workerModel = list.at(-1)?.model
  // Only categories the session used; a column of zeros says nothing.
  const rows = [...CATEGORIES, 'other' as const].map(c => [c, counts[c] ?? 0] as const).filter(([, n]) => n > 0)
  const whatRoom = Math.max(10, Math.min(40, cols - 50))
  const shown = recent.filter(c => c.view === tab).slice(-5)
  const secs = (from: number) => ago(now - from)
  // Details off cuts long texts to the room they have; on, they are drawn whole.
  const cut = (s: string, n: number) => (lay.isDetailed || s.length <= n ? s : `${s.slice(0, n - 1)}…`)
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
  type Item = { key?: string; row: RenderChildren; prompt?: string }
  const errorOf = (c: Check) => recent.find(x => x.at === c.at && x.error)?.error
  const items: Item[] = [
    ...doing.filter(a => a.isAsking).map(a => ({
      row: (
        <Text>
          {chip(t.approval, 'yellow')} <Text bold>{a.tool}</Text> {cut(a.what, whatRoom)}
        </Text>
      ),
    })),
    // Keyed by turn alone, so a dismissed streak stays away as it grows.
    ...((st.streak ?? 0) >= 3
      ? [{ key: `streak:${m.turnAt ?? 0}`, row: <Text>{chip(t.status.error, 'red')} {t.errorsInRow(st.streak ?? 0)}</Text>, prompt: t.investigateErrors(st.streak ?? 0) }]
      : []),
    ...checked.filter(c => c.result === 'failed').map(c => ({
      key: `check:${c.kind}:${c.at}`,
      row: (
        <Text>
          {chip(t.failed, 'red')} <Text bold>{t.check[c.kind]}</Text> {cut(c.command, whatRoom)}
        </Text>
      ),
      prompt: t.investigateCheck(t.check[c.kind], c.command, (errorOf(c) ?? '').slice(0, 600)),
    })),
    // A subagent's failure needs the person until the main session's next turn, which has read its answer.
    ...list
      .filter(a => (a.tests === 'FAIL' || a.status === 'error') && (a.endedAt ?? 0) >= (m.turnAt ?? 0))
      .map(a => ({
        key: `agent:${a.id}:${a.endedAt ?? 0}`,
        row: (
          <Text>
            {chip(a.tests === 'FAIL' ? 'FAIL' : t.status.error, 'red')} <Text bold>{a.type}</Text> {cut(a.task, 22)}
            {a.tests === 'FAIL' && <Text dimColor> ({t.reported}{a.testsWhy ? `: ${cut(a.testsWhy, whatRoom)}` : ''})</Text>}
          </Text>
        ),
        prompt: t.investigateAgent(a.type, a.task, a.tests === 'FAIL' ? (a.testsWhy ?? 'FAIL') : t.status.error),
      })),
    ...list.filter(a => a.status === 'waiting').map(a => ({
      row: (
        <Text>
          {chip(t.status.waiting, 'yellow')} <Text bold>{a.type}</Text> {cut(a.task, 22)}
        </Text>
      ),
    })),
  ]
  const dismissed = new Set(lay.dismissed ?? [])
  const urgent = items.filter(x => !x.key || !dismissed.has(x.key))
  // Below what needs the person: what is worth a look, most important first.
  const found = focusList({ ins, doing, agents: list, percent: usage.context.percent, window: usage.context.window, now }).filter(x => !dismissed.has(x.key))
  const insightItems: Item[] = found.slice(0, lay.isDetailed ? found.length : FOCUS_SHOWN).map(x => ({
    key: x.key,
    row: (
      <Text>
        {chip(x.tag, x.color)} {cut(x.text, whatRoom + 40)}
      </Text>
    ),
    prompt: x.prompt,
  }))
  const moreInsights = found.length - insightItems.length
  const shownItems = [...urgent, ...insightItems]
  const dismissable = shownItems.flatMap(x => (x.key ? [x.key] : []))
  // Approval rows have no prompt, so `i` goes to the first row that does.
  const firstPrompt = shownItems.findIndex(x => x.prompt)
  // Investigate drafts a prompt in the prompt box; nothing is sent until the person sends it, and a draft there is kept.
  const investigate = async (prompt: string) => {
    const box = await $.prompt.read()
    await (box.text.trim() ? $.prompt.fill({ text: `\n\n${prompt}`, mode: 'append' }) : $.prompt.fill({ text: prompt, mode: 'replace' }))
  }
  const attention = shownItems.map((x, i) => (
    <Box gap={1}>
      {x.row}
      {x.prompt && (
        <Button key={`investigate:${i}`} plain hotkey={i === firstPrompt ? 'i' : undefined} onPress={() => investigate(x.prompt ?? '')}>
          {t.investigate}
        </Button>
      )}
    </Box>
  ))

  // A subagent card is 30 columns and six rows, so three sit side by side in a narrow pane.
  const CARD = 30
  const statusChip = (a: Card) =>
    chip(a.tests === 'FAIL' ? 'FAIL' : t.status[a.status], a.status === 'error' || a.tests === 'FAIL' ? 'red' : a.status === 'done' ? 'green' : isLive(a) ? 'cyan' : 'gray')
  const card = (a: Card) => (
    <Box flexDirection="column" borderStyle="round" borderColor={isLive(a) ? 'cyan' : 'blue'} paddingX={1} width={CARD}>
      <Text>
        <Text bold>{cut(a.type, CARD - 7 - (a.tests === 'FAIL' ? 4 : t.status[a.status].length))}</Text> {statusChip(a)}
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
  // Past six running subagents, one line each: ten agents stay ten rows, not four rows of cards.
  const agentLine = (a: Card) => (
    <Text>
      <Text color="cyan">{spinner(now)} </Text>
      <Text bold>{fit(a.type, 18)}</Text>
      <Text color="blue">{fit(modelName(a.model), 11)}</Text>
      {fit(cut(a.task, whatRoom), whatRoom + 1)}
      <Text dimColor>{secs(a.startedAt)} · {a.files} {t.files}</Text>
    </Text>
  )
  const MAX_CARDS = 6
  const liveAgents = isRadar ? list.filter(isLive) : []

  const runningNow = (
    <Box flexDirection="column">
      {doing.slice(-3).map(a => (
        <Text>
          <Text color="cyan">{spinner(now)} </Text>
          <Text bold>{fit(a.tool, 10)}</Text>
          {fit(cut(a.what, whatRoom), whatRoom + 1)}
          <Text dimColor>{a.who.slice(0, 16)}{a.model ? ` · ${modelName(a.model)}` : ''} · {secs(a.startedAt)}</Text>
        </Text>
      ))}
      {doing.length === 0 && last && (
        <Text dimColor>
          {t.lastCall} · {last.tool}{last.what ? ` ${cut(last.what, whatRoom)}` : ''} · {last.who.slice(0, 16)}{last.model ? ` · ${modelName(last.model)}` : ''} · {t.ago(secs(last.at))}
        </Text>
      )}
      {liveAgents.length > MAX_CARDS ? (
        <Box flexDirection="column">{liveAgents.map(agentLine)}</Box>
      ) : (
        liveAgents.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap">
            {liveAgents.map(card)}
          </Box>
        )
      )}
    </Box>
  )

  // The session's task list: how far it is, what runs now, and every task with details on.
  const doneTasks = planned.filter(k => k.status === 'completed').length
  const current = planned.find(k => k.status === 'in_progress')
  const taskBox = isRadar && planned.length > 0 && (
    <Box flexDirection="column">
      <Text>
        {title(t.tasks, 'green')} {doneTasks}/{planned.length} {bar(doneTasks / planned.length, 'green')}
      </Text>
      {current && (
        <Text>
          <Text color="cyan">{spinner(now)} </Text>
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

  // Skills and prompt commands whose text the session loaded, the latest first.
  const skillBox = isRadar && loaded.length > 0 && (
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

  const changes = isRadar && (touched.edited.length > 0 || touched.read.length > 0 || checked.length > 0) && (
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
          <Text dimColor>{cut(c.command, whatRoom)}</Text>
        </Text>
      ))}
    </Box>
  )

  const pct = usage.context.percent
  const usageBox = isRadar && (
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
      {usage.cost && <Text>{fit('cost', 18)}${usage.cost.usd.toFixed(2)}</Text>}
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
    : cfg.advisorMode === 'plan' ? `(${t.planOnly})`
    : ''
  const advisorBox = isRadar && (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={isWide ? 30 : undefined}>
      <Text>
        {title('fable', 'magenta')}{' '}
        <Text color={adv.state === 'checking' ? 'cyan' : adv.state === 'unavailable' ? 'red' : undefined} dimColor={adv.state !== 'checking'}>
          {advisorState}
        </Text>
      </Text>
      {adv.calls === 0 ? (
        <Text dimColor>{t.advisorAbout}</Text>
      ) : (
        adv.notes.slice(-5).map(n =>
          n.ok ? (
            <Text>
              <Text color="green">✓</Text> {fit(t.kind[n.kind], 8)}
              {chip(t.ok, 'green')}
            </Text>
          ) : (
            <Box flexDirection="column">
              <Text>
                <Text color="red">✗</Text> {fit(t.kind[n.kind], 8)}
                {chip(t.nok, 'red')}
              </Text>
              <Text color="yellow">  {cut(n.text, 200)}</Text>
              {n.ref && <Text dimColor>  ↳ {cut(n.ref, 40)}</Text>}
            </Box>
          ),
        )
      )}
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
  const history = isRadar && lay.isHistoryOpen && (
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
                {c.result === 'running' ? `${spinner(now)} ` : ''}{cut(c.what, barRoom + 20)}
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
  const cachePct = ins.cacheTotal > 0 ? Math.round((ins.cacheRead / ins.cacheTotal) * 100) : undefined
  const allIn = ins.tokens.mainIn + ins.tokens.agentsIn
  const top = (r: Record<string, number>, n: number, min: number) =>
    Object.entries(r)
      .filter(([, v]) => v >= min)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
  const areaList = top(ins.turnAreas, 4, 1).map(([a, n]) => `${a} ${n}`).join(' · ')
  const rereads = top(ins.reads, 2, 2).map(([p, n]) => `${shortPath(p)} ${n}×`).join(', ')
  const churned = top(ins.edits, 2, 2).map(([p, n]) => `${shortPath(p)} ${n}×`).join(', ')
  const hasInsights = shownTurn !== undefined || ins.slow.length > 0 || ins.ctx.length > 0
  const insightBox = isRadar && hasInsights && (
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
      {ins.slow.slice(0, lay.isDetailed ? 8 : 3).map(s => (
        <Text>
          <Text color={s.ms >= 60_000 ? 'yellow' : undefined}>{dur(s.ms).padStart(7)}</Text> <Text bold>{fit(s.tool, 10)}</Text>
          {fit(cut(s.what, whatRoom), whatRoom + 1)}
          <Text dimColor>{s.who.slice(0, 16)}</Text>
        </Text>
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
          {'  '}≈{kilo(b.tokens).padStart(6)} {b.tool} {cut(b.what, whatRoom)}
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
          {ti.tokens(kilo(allIn), ins.tokens.mainIn > 0 ? Math.round((ins.tokens.mainCached / ins.tokens.mainIn) * 100) : 0, kilo(ins.tokens.mainOut + ins.tokens.agentsOut), Math.round((ins.tokens.agentsIn / allIn) * 100))}
        </Text>
      )}
      {ins.turnSwitches > 0 && areaList && <Text>{cut(ti.areas(ins.turnSwitches, areaList), whatRoom + 40)}</Text>}
      {(rereads || churned) && (
        <Text dimColor>
          {[rereads && `${ti.reread} ${rereads}`, churned && `${ti.editedOften} ${churned}`].filter(Boolean).join(' · ')}
        </Text>
      )}
      {lay.isDetailed && ins.modelSwitches > 0 && <Text dimColor>{ti.modelSwitches(ins.modelSwitches)}</Text>}
    </Box>
  )

  // What each section last did and whether it needs the person now; `rank` orders them by it. Listed in the usual order.
  const latest = (...at: number[]) => Math.max(0, ...at)
  const lastNote = adv.notes.at(-1)
  const sections = !isRadar ? [] : rank(
    [
      { key: 'tasks', node: taskBox, isUrgent: false, at: latest(...planned.map(k => k.at ?? 0)) },
      { key: 'insights', node: insightBox, isUrgent: false, at: ins.turn ? now : ins.last ? ins.last.startedAt + ins.last.wallMs : 0 },
      { key: 'skills', node: skillBox, isUrgent: false, at: latest(...loaded.map(s => s.at)) },
      { key: 'advisor', node: advisorBox, isUrgent: lastNote?.ok === false && now - latest(...Object.values(adv.lastAt ?? {})) < 10 * 60_000, at: latest(...Object.values(adv.lastAt ?? {})) },
      { key: 'changes', node: changes, isUrgent: checked.some(c => c.result === 'failed' && !isStale(c)), at: latest(touched.editedAt, ...checked.map(c => c.at)) },
      { key: 'usage', node: usageBox, isUrgent: isHigh(pct ?? 0) || usage.rateLimits.some(r => isHigh(r.percentUsed)), at: 0 },
    ].filter(s => s.node),
    now,
  )

  const nextMode = mode === 'radar' ? ('flow' as const) : ('radar' as const)
  const viewButton = (
    <Button key="view" plain hotkey="v" onPress={() => update($, layout, l => ({ ...l, mode: nextMode }))}>
      {`${t.view}: ${t.modes[mode]}`}
    </Button>
  )
  const topo =
    isRadar
      ? undefined
      : topology({ main: m, counts, errors: st.errors, compactions: st.compactions, agents: list, usage, advisor: adv, isListening: listening(adv.isOn), checks: checked, flow: flows, now })
  const phase = Math.floor(now / 500)
  const topoView = topo && drawFlow(ui, topo, cols, phase, t)

  return (
    <Box flexDirection="column">
      <Text bold>
        AGENT RADAR · <Text color="#d97757">{modelName(m.model).toUpperCase()} {t.plans}</Text>
        {m.effort && <Text color="#d97757" bold={false}> ({m.effort})</Text>}
        {workerModel && <Text color="blue"> · {modelName(workerModel).toUpperCase()} {t.executes}</Text>}
        {listening(adv.isOn) && <Text color="magenta"> · {t.watches}</Text>}
        {cfg.build && <Text dimColor bold={false}> {cfg.build}</Text>}
      </Text>
      {attention.length > 0 ? (
        <Box flexDirection="column" borderStyle="round" borderColor={urgent.length > 0 ? 'red' : 'yellow'} paddingX={1}>
          <Box justifyContent="space-between">
            {title(urgent.length > 0 ? `${ti.focus} · ${t.attention}` : ti.focus, urgent.length > 0 ? 'red' : 'yellow')}
            {dismissable.length > 0 && (
              <Button key="attention:dismiss" plain hotkey="x" onPress={() => update($, layout, l => ({ ...l, dismissed: [...(l.dismissed ?? []), ...dismissable].slice(-50) }))}>
                {t.dismiss}
              </Button>
            )}
          </Box>
          {attention}
          {moreInsights > 0 && <Text dimColor>+{moreInsights} · {t.details} (d)</Text>}
        </Box>
      ) : (
        // Always on top: when nothing needs a look, where the last turn's time went.
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
      )}
      {topoView}
      {isRadar && runningNow}
      {isRadar && (
        <Box flexDirection={isWide ? 'row' : 'column'} flexWrap="wrap" gap={isWide ? 1 : 0}>
          {sections.map(s => s.node)}
        </Box>
      )}
      {!isRadar && <Box gap={2}>{viewButton}</Box>}
      {isRadar && (
      <Box gap={2}>
        {viewButton}
        <Button key="fold:history" plain hotkey="h" onPress={() => update($, layout, l => ({ ...l, isHistoryOpen: !l.isHistoryOpen }))}>
          {`${lay.isHistoryOpen ? '▾' : '▸'} ${t.history}`}
        </Button>
        <Button key="details" plain hotkey="d" dimColor={!lay.isDetailed} onPress={() => update($, layout, l => ({ ...l, isDetailed: !l.isDetailed }))}>
          {`${lay.isDetailed ? '●' : '○'} ${t.details}`}
        </Button>
      </Box>
      )}
      {history}
    </Box>
  )
}
