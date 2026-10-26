import type { EngineInterface, RenderChildren } from 'claude-code'

import { ago, fit, modelName, smoothBar } from './format'
import type { Strings } from './i18n'
import type { Topo } from './topology'
import { fillEighths, isHigh, isMid, isRunning, limitName } from './topology'

// The elements every surface draws.
type Els = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text'>

const TANK_ROWS = 6
const WELL = '#2c313a'

// A vertical gauge filled from the bottom, top row first: each row's eighths, 0 empty to 8 full.
export const tankRows = (fraction: number, rows = TANK_ROWS) => fillEighths(fraction, rows).reverse()

const levelColor = (n: number) => (isHigh(n) ? 'red' : isMid(n) ? 'yellow' : 'green')

// Name 12, count 5 and rate 8 columns beside the bar; the bar takes the rest of the box, 4..30.
export const toolsBarWidth = (inner: number) => Math.max(4, Math.min(30, inner - 25))
// The left column (session, Fable, tanks) in the wide layout.
const LEFT = 28

// The session as boxes, each pipe drawn in the box it feeds: Box and Text only, so every surface draws it.
export function drawFlow({ Box, Text }: Els, topo: Topo, cols: number, phase: number, t: Strings): RenderChildren {
  const isWide = cols >= 100
  const title = (label: string, color: string) => (
    <Text color={color} bold>
      ● {label.toUpperCase()}
    </Text>
  )
  // A pipe's dots move one step a frame while something flows through it.
  const pipe = (label: string, isFlowing: boolean, color: string) => (
    <Text color={isFlowing ? color : undefined} dimColor={!isFlowing} wrap="truncate">
      {' '}
      {Array.from({ length: 8 }, (_, i) => (isFlowing && (i + phase) % 4 === 0 ? '●' : '═')).join('')}▶ {label}
    </Text>
  )
  const header = (label: string, color: string, feed: RenderChildren) => (
    <Box>
      {title(label, color)}
      {feed}
    </Box>
  )
  const mins = Math.floor(topo.session.uptimeMs / 60_000)

  const session = (
    <Box flexDirection="column" borderStyle="round" borderColor="#d97757" paddingX={1}>
      {title(t.session, '#d97757')}
      <Text color="#d97757">{modelName(topo.session.model)}</Text>
      <Text wrap="truncate">
        {t.effortWord} <Text bold>{topo.session.effort || '?'}</Text>
      </Text>
      <Text wrap="truncate">{t.uptime(mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : ago(topo.session.uptimeMs))}</Text>
      {topo.session.cost !== undefined && <Text color="yellow">${topo.session.cost.toFixed(2)}</Text>}
      <Text dimColor wrap="truncate">{t.compactedTimes(topo.session.compactions)}</Text>
    </Box>
  )
  const fable = (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      {title(t.fable, 'magenta')}
      <Text color={topo.fable.state === 'unavailable' ? 'red' : undefined} wrap="truncate">
        {t.fableStates[topo.fable.state]}
        {topo.fable.why ? `: ${topo.fable.why}` : ''}
      </Text>
      <Text wrap="truncate">
        {topo.fable.verdicts.map(ok => (
          <Text color={ok ? 'green' : 'red'}>● </Text>
        ))}
        <Text dimColor>
          {t.calls} {topo.fable.calls}
        </Text>
      </Text>
    </Box>
  )

  // The boxes on the right get the width the left column leaves; their border and padding take four columns.
  const inner = (isWide ? cols - LEFT - 1 : cols) - 4
  const barW = toolsBarWidth(inner)
  const most = Math.max(1, ...topo.tools.map(x => x.total))
  const tools = (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} flexGrow={1}>
      {header(t.toolsWord, 'green', pipe(`${topo.callsPerMin}/min`, topo.callsPerMin > 0, 'cyan'))}
      {topo.tools.map(x => (
        <Text wrap="truncate">
          <Text color={x.cat === 'git' ? 'yellow' : undefined}>{fit(t.cat[x.cat], 12)}</Text>
          <Text color={x.errors > 0 ? 'red' : x.cat === 'git' ? 'yellow' : 'green'}>{smoothBar(x.total / most, barW)}</Text>
          {String(x.total).padStart(5)}
          {x.perMin > 0 && <Text color="cyan"> {x.perMin}/min</Text>}
        </Text>
      ))}
    </Box>
  )
  const running = topo.agents.filter(isRunning).length
  const shown = [...topo.agents.filter(isRunning), ...topo.agents.filter(a => !isRunning(a)).reverse()].slice(0, 8)
  const agents = (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} flexGrow={1}>
      {header(t.agentsWord, 'blue', pipe(`${running} ${t.status.running}`, running > 0, 'blue'))}
      {shown.length === 0 && <Text dimColor>—</Text>}
      {shown.map(a => (
        <Text dimColor={!isRunning(a) && !a.isFail} wrap="truncate">
          <Text color={a.isFail ? 'red' : isRunning(a) ? 'cyan' : undefined}>{a.isFail ? '✗' : isRunning(a) ? (phase % 2 ? '◉' : '●') : '○'} </Text>
          {fit(a.type, 18)}
          <Text color="blue">{modelName(a.model)}</Text>
        </Text>
      ))}
      {topo.agents.length > shown.length && <Text dimColor>+{topo.agents.length - shown.length}</Text>}
    </Box>
  )
  // A tank is coloured cells, not block characters, so the filled part is solid without gaps between lines.
  const tank = (label: string, percent: number | undefined) => {
    const color = levelColor(percent ?? 0)
    return (
      <Box flexDirection="column" alignItems="center">
        <Text>{label.slice(0, 5)}</Text>
        {tankRows((percent ?? 0) / 100).map(n => (
          <Text color={color} backgroundColor={n === 8 ? color : WELL}>
            {(n === 0 || n === 8 ? ' ' : ' ▁▂▃▄▅▆▇'[n]!).repeat(5)}
          </Text>
        ))}
        <Text color={color}>{percent === undefined ? '?' : `${Math.round(percent)}%`}</Text>
      </Box>
    )
  }
  const tanks = (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      {title(t.limitsWord, 'white')}
      <Box gap={1}>
        {tank('ctx', topo.context)}
        {topo.limits.map(l => tank(limitName(l.kind), l.percent))}
      </Box>
    </Box>
  )

  if (!isWide) {
    return (
      <Box flexDirection="column">
        {session}
        {tools}
        {agents}
        {tanks}
        {fable}
      </Box>
    )
  }
  return (
    <Box flexDirection="row" gap={1}>
      <Box flexDirection="column" width={LEFT}>
        {session}
        {tanks}
        {fable}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {tools}
        {agents}
      </Box>
    </Box>
  )
}
