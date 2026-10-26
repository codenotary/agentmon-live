import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { Card } from '../types'
import { clockTime, effortBar, fit, kilo, modelName } from './format'
import { CATEGORIES } from './i18n'
import type { Category } from './i18n'
import { cfg, INIT, isLive, listening, liveStatus, VIEWS } from './state'

const main = atom({ plugin: 'agent-radar', key: 'main' } as const, INIT.main)
const tools = atom({ plugin: 'agent-radar', key: 'tools' } as const, INIT.tools)
const agents = atom({ plugin: 'agent-radar', key: 'agents' } as const, INIT.agents)
const log = atom({ plugin: 'agent-radar', key: 'log' } as const, INIT.log)
const advisor = atom({ plugin: 'agent-radar', key: 'advisor' } as const, INIT.advisor)
const stats = atom({ plugin: 'agent-radar', key: 'stats' } as const, INIT.stats)
const calls = atom({ plugin: 'agent-radar', key: 'calls' } as const, INIT.calls)
const view = atom({ plugin: 'agent-radar', key: 'view' } as const, INIT.view)
const active = atom({ plugin: 'agent-radar', key: 'active' } as const, INIT.active)

export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const t = cfg.t
  const { Box, Button, Text } = $.ui.resolve(e)
  const [m, counts, stored, lines, adv, usage, st, now, recent, tab, doing, live] = await Promise.all([
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
  ])
  const statusOf = new Map(live.map(a => [a.id, liveStatus(a.status)]))
  const list = stored.map(a => ({ ...a, status: statusOf.get(a.id) ?? a.status }))
  const cols = e.props.bodyColumns
  const isWide = cols >= 100
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const most = Math.max(1, ...Object.values(counts))
  const barRoom = Math.max(6, Math.min(24, cols - (isWide ? 60 : 30)))
  const pct = usage.context.percent ?? 0
  const running = list.filter(isLive).length
  const workerModel = list.at(-1)?.model
  const rows: (readonly [Category, number])[] = CATEGORIES.map(c => [c, counts[c] ?? 0] as const)
  if (counts.other) rows.push(['other', counts.other])
  const whatRoom = Math.max(10, Math.min(40, cols - 50))
  const shown = recent.filter(c => c.view === tab).slice(-5)
  const secs = (from: number) => `${Math.max(0, Math.round((now - from) / 1000))} s`

  const attention = [
    ...doing.filter(a => a.isAsking).map(a => <Text color="yellow">⚠ {t.approval} · {a.tool} {a.what.slice(0, whatRoom)}</Text>),
    ...((st.streak ?? 0) >= 3 ? [<Text color="red">⚠ {t.errorsInRow(st.streak ?? 0)}</Text>] : []),
    ...list
      .filter(a => a.tests === 'FAIL' || a.status === 'error')
      .map(a => <Text color="red">✗ {a.type} · {a.tests === 'FAIL' ? `FAIL (${t.reported})` : t.status.error} · {a.task.slice(0, 22)}</Text>),
    ...list.filter(a => a.status === 'waiting').map(a => <Text color="yellow">… {t.waitingAgent(a.type)} · {a.task.slice(0, 22)}</Text>),
  ]

  const advisorBox = (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1} width={isWide ? 30 : undefined}>
      <Text>
        <Text color="magenta" bold>fable</Text>{' '}
        {!listening(adv.isOn) ? (
          <Text dimColor>({t.off})</Text>
        ) : cfg.advisorMode === 'plan' ? (
          <Text dimColor>({t.planOnly})</Text>
        ) : (
          ''
        )}
      </Text>
      {adv.calls === 0 ? (
        <Text dimColor>{t.advisorAbout}</Text>
      ) : (
        adv.notes.slice(-5).map(n =>
          n.ok ? (
            <Text color="green">✓ {t.kind[n.kind]} {t.ok}</Text>
          ) : (
            <Text color="red">✗ {t.kind[n.kind]} {t.nok}: <Text color="yellow">{n.text}</Text></Text>
          ),
        )
      )}
      {adv.calls > 0 && <Text dimColor>{t.calls}  {adv.calls}</Text>}
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
            ? `⟳ ${secs(a.startedAt)} · ${a.files} ${t.files}`
            : `${t.status[a.status]} · ${a.files} ${t.files}`)}
        {a.tests && <Text dimColor> {t.reported}</Text>}
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
            <Text color={c === 'git' ? 'yellow' : undefined} bold={c === 'git'}>{fit(t.cat[c], 17)}</Text>
            <Text color={c === 'git' ? 'yellow' : 'green'}>{'█'.repeat(Math.round((n / most) * barRoom)).padEnd(barRoom)}</Text>
            {String(n).padStart(4)}{' '}
            {st.errors[c] ? <Text color="red">{t.errors(st.errors[c])}</Text> : <Text color="green">{t.ok}</Text>}
          </Text>
        ))}
        <Text>
          {fit(t.context, 17)}
          <Text color={pct > 80 ? 'red' : 'green'}>{'█'.repeat(Math.round((pct / 100) * barRoom)).padEnd(barRoom)}</Text>
          {String(pct).padStart(4)} % <Text dimColor>{t.compactedTimes(st.compactions)}</Text>
        </Text>
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
          <Text>
            <Text dimColor>{clockTime(c.at)} </Text>
            <Text color={c.result !== 'ok' ? 'red' : c.view === 'git' ? 'yellow' : undefined}>{c.what.slice(0, barRoom + 20)}</Text>
            <Text dimColor> {c.who.slice(0, 16)}</Text>
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
        AGENT RADAR · <Text color="#d97757">{modelName(m.model).split(' ')[0]?.toUpperCase()} {t.plans}</Text> ·{' '}
        {workerModel && <Text color="blue">{modelName(workerModel).split(' ')[0]?.toUpperCase()} {t.executes} · </Text>}
        {listening(adv.isOn) && <Text color="magenta">{t.watches}</Text>}
      </Text>
      {attention.length > 0 && (
        <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red" bold>{t.attention}</Text>
          {attention}
        </Box>
      )}
      {doing.slice(-3).map(a => (
        <Text>
          <Text color="cyan">⟳ {fit(a.tool, 10)}</Text>
          {fit(a.what, whatRoom + 1)}
          <Text dimColor>{a.who.slice(0, 16)} · {secs(a.startedAt)}</Text>
        </Text>
      ))}
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
            <Text color="blue">{fit(l.who, 17)}</Text>
            <Text color={l.isGit ? 'yellow' : undefined}>{fit(l.what, whatRoom + 1)}</Text>{l.result}
          </Text>
        ))}
      </Box>
      <Text dimColor>{t.statusLine(m.effort || '?', running, list.length, listening(adv.isOn), total, counts.git ?? 0)}</Text>
    </Box>
  )
}
