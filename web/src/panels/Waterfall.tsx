import { ChartNoAxesGantt, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { dur, hhmm, resultOf } from '../format.ts'
import type { Labels } from '../labels.ts'
import { set, useClock } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { rowsOf, spanOf, xOf, type Row } from '../waterfall.ts'

const TICKS = [0, 25, 50, 75]

const msText = (ms: number | undefined) => (ms === undefined ? '' : ms < 1000 ? `${ms} ms` : dur(ms))

function Bar({ row, from, to }: { row: Row; from: number; to: number }) {
  const left = xOf(row.from, from, to)
  return <i className={`wf-bar ${row.state} ${row.isAgent ? 'agent' : ''} ${row.isSlowest ? 'slowest' : ''}`} style={{ left: `${left}%`, width: `${xOf(row.to, from, to) - left}%` }} />
}

function Name({ row, status }: { row: Row; status: string | undefined }) {
  return (
    <span className="wf-name" style={{ paddingLeft: `${row.depth * 14}px` }}>
      <b className={row.isAgent ? 'text-signal' : row.state === 'failed' ? 'text-bad' : 'text-ink-2'}>{row.name}</b>
      {status ? <span className="text-warn">{status}</span> : null}
      <span className="truncate text-ink-3" title={row.what}>{row.what}</span>
    </span>
  )
}

export function Waterfall({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  const now = useClock(s)
  // Null follows the newest turn.
  const [pickedAt, setPickedAt] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const turn = s.turns.find(t => t.startedAt === pickedAt) ?? s.turns.at(-1)
  const at = turn ? s.turns.indexOf(turn) : -1
  const isFollowing = pickedAt === null
  const span = turn ? spanOf(turn, now) : { from: 0, to: 0 }
  const rows = turn ? rowsOf(s, span, l.main, now) : []
  const failed = rows.filter(r => r.state === 'failed').length
  const calls = rows.filter(r => !r.isAgent).length

  useEffect(() => {
    if (isFollowing && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [isFollowing, rows.length])

  const goTo = (i: number) => {
    const next = s.turns[i]
    if (next) setPickedAt(i === s.turns.length - 1 ? null : next.startedAt)
  }
  const aside = turn ? (
    <>
      <span className="font-mono text-[11px] text-ink-3 tabular-nums">{calls} {p.calls}{failed ? <span className="text-bad"> · {failed} {p.errors}</span> : null} · {dur(span.to - span.from)}</span>
      <div className="flex items-center gap-1">
        <button type="button" className="icon-btn !h-[26px] !min-w-[26px] !p-0" aria-label={p.prevTurn} title={p.prevTurn} disabled={at <= 0} onClick={() => goTo(at - 1)}><ChevronLeft size={13} aria-hidden /></button>
        <span className="min-w-11 text-center font-mono text-[11px] tabular-nums">{hhmm(turn.startedAt)}</span>
        <button type="button" className="icon-btn !h-[26px] !min-w-[26px] !p-0" aria-label={p.nextTurn} title={p.nextTurn} disabled={at >= s.turns.length - 1} onClick={() => goTo(at + 1)}><ChevronRight size={13} aria-hidden /></button>
      </div>
      <button type="button" className="chip" aria-pressed={isFollowing} onClick={() => setPickedAt(null)}>{p.follow}</button>
    </>
  ) : undefined

  return (
    <Panel id="waterfall" title={p.waterfall} icon={ChartNoAxesGantt} aside={aside}>
      {rows.length === 0 ? <Empty text={p.none} /> : (
        <>
          <div className="wf-row wf-axis" aria-hidden>
            <span />
            <span className="wf-track !bg-none">
              {TICKS.map(pct => <span key={pct} className={`absolute font-mono text-[10px] text-ink-3 ${pct % 50 ? 'max-sm:hidden' : ''}`} style={{ left: `${pct}%` }}>{dur(((span.to - span.from) * pct) / 100)}</span>)}
            </span>
            <span />
          </div>
          <div ref={box} className="flex max-h-[460px] flex-col overflow-auto" data-testid="waterfall">
            {rows.map(row => {
              const asked = row.state === 'asking' ? l.status.waiting : undefined
              const inner = (
                <>
                  <Name row={row} status={asked} />
                  <span className="wf-track"><Bar row={row} from={span.from} to={span.to} /></span>
                  <span className={`text-right font-mono text-[11px] tabular-nums ${row.isSlowest ? 'font-bold text-signal' : 'text-ink-3'}`}>{msText(row.ms)}</span>
                </>
              )
              const { call } = row
              if (!call) return <div key={row.key} className="wf-row">{inner}</div>
              const result = call.isFailed ? 'failed' : call.ms === undefined ? 'running' : 'ok'
              return (
                <button key={row.key} type="button" className="wf-row row-in" aria-label={`${p.details}: ${call.tool} ${call.what} ${resultOf(result, l).text}`} onClick={() => set({ call: { at: call.at, who: call.who, view: call.tool, what: call.what, result, ...(call.error ? { error: call.error } : {}), ...(call.ms === undefined ? {} : { ms: call.ms }) } })}>
                  {inner}
                </button>
              )
            })}
          </div>
        </>
      )}
    </Panel>
  )
}
