import type { ReactNode } from 'react'

import type { ViewBlock, ViewNote, ViewPanel, WebSnapshot } from '../../types/index'
import type { FeedEvent } from './events.ts'
import { rampColour } from './format.ts'
import { fill } from './kpi.ts'
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
import { Gauge } from './ui/Gauge.tsx'
import { Empty } from './ui/Panel.tsx'
import { toneVar } from './ui/Pill.tsx'
import { Ruler, ShareBar } from './ui/Ruler.tsx'
import { Sparkline } from './ui/Sparkline.tsx'
import { barRows, formatValue, pctOf, pick, queryRows, statValue, toneOf } from './view.ts'

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
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const Kids = ({ list, x }: { list: ViewBlock[]; x: Props }) => <>{list.map((c, i) => <Block key={i} b={c} x={x} />)}</>
const Labeled = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="panel flex min-w-0 flex-col gap-2 p-5">
    <span className="kpi-label">{label}</span>
    {children}
  </div>
)

// A view's blocks, drawn from the catalog only; every text from the file goes in as React text.
function Block({ b, x }: { b: ViewBlock; x: Props }): ReactNode {
  if ('panel' in b) return PANEL[b.panel](x)
  switch (b.type) {
    case 'Row':
      return <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))]"><Kids list={b.children} x={x} /></div>
    case 'Column':
      return <div className="flex min-w-0 flex-col gap-4"><Kids list={b.children} x={x} /></div>
    case 'Card':
      return (
        <section className="panel flex min-w-0 flex-col gap-3 p-5" aria-label={b.title || undefined}>
          {b.title ? <h3 className="font-display text-base font-bold text-heading">{b.title}</h3> : null}
          <Kids list={b.children} x={x} />
        </section>
      )
    case 'Text':
      return <p className="text-[13px] whitespace-pre-wrap text-ink-2">{b.text}</p>
    case 'Stat': {
      const v = statValue(x.s, b)
      // Only the file's own thresholds colour a Stat: a percent without them stays plain, as before.
      return <div className="panel"><Stat label={b.label} tone={toneOf(v, b, false)} foot={b.foot ? <span className="text-xs text-ink-3">{b.foot}</span> : undefined}>{formatValue(v, b.format)}</Stat></div>
    }
    case 'List': {
      const list = pick(x.s, b.items)
      const rows = Array.isArray(list) ? list.slice(0, b.max).map(item => formatValue(b.field ? pick(item, b.field) : item, undefined)) : []
      return <Labeled label={b.label}>{rows.length ? <ul className="flex flex-col gap-1 font-mono text-xs text-ink-2">{rows.map((r, i) => <li key={i} className="truncate">{r}</li>)}</ul> : <Empty text="—" />}</Labeled>
    }
    case 'Sparkline': {
      const points = numbers(pick(x.s, b.points), b.field)
      if (points.length < 2) return <Labeled label={b.label}><Empty text={x.p.fewPoints} /></Labeled>
      const show = (n: number) => formatValue(n, b.format)
      return (
        <Labeled label={b.label}>
          <Sparkline points={points} label={b.label} />
          <span className="text-xs text-ink-3 tabular-nums"><b className="text-ink">{show(points.at(-1)!)}</b> · {show(Math.min(...points))} – {show(Math.max(...points))}</span>
        </Labeled>
      )
    }
    case 'Table': {
      const rows = queryRows(x.s, b, b.columns)
      // A column of numbers lines up on the right.
      const isRight = b.columns.map((c, i) => c.format !== undefined || c.agg !== undefined || rows.some(r => isNumber(r[i])))
      return (
        <Labeled label={b.label}>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px] tabular-nums">
                <thead>
                  <tr>{b.columns.map((c, i) => <th key={i} scope="col" className={`border-b border-line px-2 py-1.5 text-[11px] font-bold tracking-[.05em] text-ink-3 uppercase ${isRight[i] ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-line-soft last:border-0">
                      {r.map((v, j) => {
                        const shown = formatValue(v, b.columns[j]!.format)
                        return <td key={j} className={`max-w-[24ch] truncate px-2 py-1.5 ${isRight[j] ? 'text-right' : 'text-left text-ink-2'}`} title={shown}>{shown}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty text="—" />}
        </Labeled>
      )
    }
    case 'Bars': {
      const rows = barRows(x.s, b)
      const total = rows.reduce((a, [, v]) => a + v, 0)
      // The largest five take the ramp, as the page's own charts do.
      const names = [...rows].sort((a, b) => b[1] - a[1]).map(([name]) => name)
      return (
        <Labeled label={b.label}>
          {rows.length ? (
            <ul className="flex flex-col gap-2 text-[13px]">
              {rows.map(([name, v], i) => (
                <li key={i}>
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-ink-2" title={name}>{name}</span>
                    <span className="tabular-nums">{formatValue(v, b.format)}</span>
                    <span className="w-9 text-right text-xs text-ink-3 tabular-nums">{total > 0 ? `${Math.round((v / total) * 100)}%` : ''}</span>
                  </span>
                  <ShareBar pct={total > 0 ? (v / total) * 100 : 0} colour={rampColour(names, name)} />
                </li>
              ))}
            </ul>
          ) : <Empty text="—" />}
        </Labeled>
      )
    }
    case 'Gauge':
    case 'Meter': {
      const v = pick(x.s, b.value)
      const top = b.max ?? 100
      const pct = pctOf(v, top)
      const tone = toneOf(v, b, b.max === undefined)
      const shown = formatValue(v, b.format ?? (b.max === undefined ? 'pct' : undefined))
      if (b.type === 'Gauge') return <div className="panel"><Gauge label={b.label} pct={pct} tone={tone} note={b.max === undefined ? undefined : shown} /></div>
      const at = (n: number | undefined) => (n === undefined ? undefined : (n / top) * 100)
      const zones = [{ to: at(b.warnAt) ?? at(b.badAt), tone: 'good' as const }, { to: at(b.badAt), tone: 'warn' as const }, { to: 100, tone: (b.badAt === undefined ? (b.warnAt === undefined ? '' : 'warn') : 'bad') as '' | 'warn' | 'bad' }].filter((z): z is { to: number; tone: '' | 'good' | 'warn' | 'bad' } => z.to !== undefined)
      return (
        <Labeled label={b.label}>
          <span className="font-display text-[22px] leading-7 font-bold tabular-nums" style={tone ? { color: toneVar(tone) } : undefined}>{shown}</span>
          <Ruler pos={pct ?? 0} tone={tone} zones={zones} />
        </Labeled>
      )
    }
  }
}

export function ViewBlocks({ blocks, ...x }: Props & { blocks: ViewBlock[] }) {
  return <>{blocks.map((b, i) => <Block key={i} b={b} x={x} />)}</>
}

const NOTE_LABEL = { block: 'noteBlock', panel: 'notePanel', pointer: 'notePointer', colour: 'noteColour', section: 'noteSection', limit: 'noteLimit', empty: 'noteEmpty' } as const

// What the page left out of the chosen view, and the pointers that find nothing: closed until asked for, so a working view stays clean.
export function ViewNotes({ notes, p }: { notes: readonly ViewNote[]; p: Page }) {
  if (notes.length === 0) return null
  return (
    <details className="rounded-lg border border-warn bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn" data-testid="view-notes">
      <summary className="cursor-pointer font-bold">{fill(p.viewNotes, { n: notes.length })}</summary>
      <ul className="mt-2 flex flex-col gap-1 font-mono text-xs">
        {notes.map((n, i) => <li key={i} className="[overflow-wrap:anywhere]">{n.at} · {p[NOTE_LABEL[n.kind]]}{n.detail ? ` · ${n.detail}` : ''}</li>)}
      </ul>
    </details>
  )
}
