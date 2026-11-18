import type { ReactNode } from 'react'

import type { ViewBlock, ViewPanel, WebSnapshot } from '../../types/index'
import type { FeedEvent } from './events.ts'
import type { Labels, Page } from './labels.ts'
import { Agents } from './panels/Agents.tsx'
import { Calls } from './panels/Calls.tsx'
import { Events } from './panels/Events.tsx'
import { Files } from './panels/Files.tsx'
import { Flow } from './panels/Flow.tsx'
import { Instruments, Stat } from './panels/Instruments.tsx'
import { Log } from './panels/Log.tsx'
import { Checks, Insights, Running, Tasks } from './panels/Side.tsx'
import { Steps } from './panels/Steps.tsx'
import { TurnClock } from './panels/TurnClock.tsx'
import { Waterfall } from './panels/Waterfall.tsx'
import type { Trend } from './store.ts'
import { Empty } from './ui/Panel.tsx'
import { Sparkline } from './ui/Sparkline.tsx'
import { formatValue, pick } from './view.ts'

type Props = { s: WebSnapshot; l: Labels; p: Page; events: FeedEvent[]; trend: Trend | undefined }

const PANEL: Record<ViewPanel, (x: Props) => ReactNode> = {
  Instruments: x => <Instruments s={x.s} p={x.p} trend={x.trend} />,
  Flow: x => <Flow s={x.s} l={x.l} />,
  Waterfall: x => <Waterfall s={x.s} l={x.l} />,
  TurnClock: x => <TurnClock s={x.s} l={x.l} />,
  Events: x => <Events list={x.events} p={x.p} />,
  Running: x => <Running s={x.s} p={x.p} />,
  Steps: x => (x.s.steps ? <Steps s={x.s} p={x.p} /> : null),
  Calls: x => <Calls s={x.s} l={x.l} />,
  Insights: x => <Insights s={x.s} p={x.p} />,
  Checks: x => <Checks s={x.s} l={x.l} />,
  Tasks: x => <Tasks s={x.s} l={x.l} />,
  Agents: x => <Agents s={x.s} l={x.l} />,
  Files: x => <Files s={x.s} p={x.p} />,
  Log: x => <Log s={x.s} l={x.l} />,
}

const numbers = (v: unknown, field: string | undefined) => (Array.isArray(v) ? v.map(x => (field ? pick(x, field) : x)).filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [])

// A view's blocks, drawn from the catalog only; every text from the file goes in as React text.
function Block({ b, x }: { b: ViewBlock; x: Props }): ReactNode {
  if ('panel' in b) return PANEL[b.panel](x)
  switch (b.type) {
    case 'Row':
      return <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))]">{b.children.map((c, i) => <Block key={i} b={c} x={x} />)}</div>
    case 'Column':
      return <div className="flex min-w-0 flex-col gap-4">{b.children.map((c, i) => <Block key={i} b={c} x={x} />)}</div>
    case 'Card':
      return (
        <section className="panel flex min-w-0 flex-col gap-3 p-5" aria-label={b.title || undefined}>
          {b.title ? <h3 className="font-display text-base font-bold text-heading">{b.title}</h3> : null}
          {b.children.map((c, i) => <Block key={i} b={c} x={x} />)}
        </section>
      )
    case 'Text':
      return <p className="text-[13px] whitespace-pre-wrap text-ink-2">{b.text}</p>
    case 'Stat':
      return <div className="panel"><Stat label={b.label}>{formatValue(pick(x.s, b.value), b.format)}</Stat></div>
    case 'List': {
      const list = pick(x.s, b.items)
      const rows = Array.isArray(list) ? list.slice(0, b.max).map(item => formatValue(b.field ? pick(item, b.field) : item, undefined)) : []
      return (
        <div className="panel flex min-w-0 flex-col gap-2 p-5">
          <span className="kpi-label">{b.label}</span>
          {rows.length ? <ul className="flex flex-col gap-1 font-mono text-xs text-ink-2">{rows.map((r, i) => <li key={i} className="truncate">{r}</li>)}</ul> : <Empty text="—" />}
        </div>
      )
    }
    case 'Sparkline':
      return (
        <div className="panel flex min-w-0 flex-col gap-2 p-5">
          <span className="kpi-label">{b.label}</span>
          <Sparkline points={numbers(pick(x.s, b.points), b.field)} label={b.label} />
        </div>
      )
  }
}

export function ViewBlocks({ blocks, ...x }: Props & { blocks: ViewBlock[] }) {
  return <>{blocks.map((b, i) => <Block key={i} b={b} x={x} />)}</>
}
