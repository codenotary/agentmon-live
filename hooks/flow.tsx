import type { EngineInterface, RenderChildren } from 'claude-code'

import { ago, fit, modelName, smoothBar } from './format'
import type { Strings } from './i18n'
import type { Topo } from './topology'
import { isRunning, limitName } from './topology'

// The elements every surface draws.
type Els = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text'>

const TANK_ROWS = 6

// A vertical gauge filled from the bottom: one string per row, top first.
export function tankRows(fraction: number, rows = TANK_ROWS, width = 5): string[] {
  const level = Math.max(0, Math.min(1, fraction)) * rows * 8
  return Array.from({ length: rows }, (_, i) => {
    const r = rows - 1 - i
    const n = Math.max(0, Math.min(8, Math.round(level - r * 8)))
    return (n === 0 ? '·' : ' ▁▂▃▄▅▆▇█'[n]!).repeat(width)
  })
}

const levelColor = (n: number) => (n >= 80 ? 'red' : n >= 50 ? 'yellow' : 'green')

// The session as boxes joined by pipes with their live rates: Box and Text only, so every surface draws it.
export function drawFlow({ Box, Text }: Els, topo: Topo, cols: number, phase: number, t: Strings): RenderChildren {
  const isWide = cols >= 100
  const title = (label: string, color: string) => (
    <Text color={color} bold>
      ● {label.toUpperCase()}
    </Text>
  )
  // A pipe's dots move one step a frame while something flows through it.
  const pipe = (label: string, isFlowing: boolean, color: string, length = 10) => {
    const body = Array.from({ length }, (_, i) => (isFlowing && (i + phase) % 4 === 0 ? '●' : '═')).join('')
    return (
      <Text color={isFlowing ? color : undefined} dimColor={!isFlowing}>
        {isWide ? `${body}▶ ${label}` : `║ ${label}`}
      </Text>
    )
  }
  const mins = Math.floor(topo.session.uptimeMs / 60_000)

  const session = (
    <Box flexDirection="column" borderStyle="round" borderColor="#d97757" paddingX={1} width={isWide ? 26 : undefined}>
      {title(t.session, '#d97757')}
      <Text color="#d97757">{modelName(topo.session.model)}</Text>
      <Text>
        {t.effortWord} <Text bold>{topo.session.effort || '?'}</Text>
      </Text>
      <Text>{t.uptime(mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : ago(topo.session.uptimeMs))}</Text>
      {topo.session.cost !== undefined && <Text color="yellow">${topo.session.cost.toFixed(2)}</Text>}
      <Text dimColor>{t.compactedTimes(topo.session.compactions)}</Text>
    </Box>
  )
  const fable = (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={isWide ? 26 : undefined}>
      {title(t.fable, 'magenta')}
      <Text color={topo.fable.state === 'unavailable' ? 'red' : undefined}>{topo.fable.state}</Text>
      <Text>
        {topo.fable.verdicts.map(ok => (
          <Text color={ok ? 'green' : 'red'}>● </Text>
        ))}
      </Text>
    </Box>
  )

  const most = Math.max(1, ...topo.tools.map(x => x.total))
  const barW = Math.max(6, Math.min(20, cols - (isWide ? 80 : 40)))
  const tools = (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} flexGrow={1}>
      {title(t.toolsWord, 'green')}
      {topo.tools.map(x => (
        <Text>
          <Text color={x.cat === 'git' ? 'yellow' : undefined}>{fit(t.cat[x.cat], 14)}</Text>
          <Text color={x.errors > 0 ? 'red' : x.cat === 'git' ? 'yellow' : 'green'}>{smoothBar(x.total / most, barW)}</Text>
          {String(x.total).padStart(5)}
          {x.perMin > 0 && <Text color="cyan"> {x.perMin}/min</Text>}
        </Text>
      ))}
    </Box>
  )
  const shown = [...topo.agents.filter(isRunning), ...topo.agents.filter(a => !isRunning(a)).reverse()].slice(0, 8)
  const agents = (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} flexGrow={1}>
      {title(t.agentsWord, 'blue')}
      {shown.length === 0 && <Text dimColor>—</Text>}
      {shown.map(a => (
        <Text dimColor={!isRunning(a) && !a.isFail}>
          <Text color={a.isFail ? 'red' : isRunning(a) ? 'cyan' : undefined}>{a.isFail ? '✗' : isRunning(a) ? (phase % 2 ? '◉' : '●') : '○'} </Text>
          {fit(a.type, 18)}
          <Text color="blue">{modelName(a.model)}</Text>
        </Text>
      ))}
      {topo.agents.length > shown.length && <Text dimColor>+{topo.agents.length - shown.length}</Text>}
    </Box>
  )
  const tank = (label: string, percent: number | undefined) => (
    <Box flexDirection="column" alignItems="center">
      <Text>{label.slice(0, 9)}</Text>
      {tankRows((percent ?? 0) / 100).map(row => (
        <Text color={levelColor(percent ?? 0)}>{row}</Text>
      ))}
      <Text color={levelColor(percent ?? 0)}>{percent === undefined ? '?' : `${Math.round(percent)}%`}</Text>
    </Box>
  )
  const tanks = (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      {title(`${t.contextWord} · ${t.limitsWord}`, 'white')}
      <Box gap={2}>
        {tank(t.context, topo.context)}
        {topo.limits.map(l => tank(limitName(l.kind), l.percent))}
      </Box>
    </Box>
  )
  const toolsPipe = pipe(`${topo.callsPerMin}/min`, topo.callsPerMin > 0, 'cyan')
  const agentsPipe = pipe(`${topo.agents.filter(isRunning).length} ${t.status.running}`, topo.agents.some(isRunning), 'blue')

  if (!isWide) {
    return (
      <Box flexDirection="column">
        {session}
        {toolsPipe}
        {tools}
        {agentsPipe}
        {agents}
        {tanks}
        {fable}
      </Box>
    )
  }
  return (
    <Box flexDirection="row" gap={1}>
      <Box flexDirection="column">
        {session}
        {fable}
      </Box>
      <Box flexDirection="column" justifyContent="space-around" paddingTop={2}>
        {toolsPipe}
        {agentsPipe}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {tools}
        {agents}
      </Box>
      {tanks}
    </Box>
  )
}
