import { ChartNoAxesGantt } from 'lucide-react'
import { useEffect, useRef, type CSSProperties } from 'react'

import type { TraceCall, WebSnapshot } from '../../../types/index'
import { callTime, countWord, dur, resultOf, stateOf, traceResult } from '../format.ts'
import { windowOf } from '../flow.ts'
import type { Labels } from '../labels.ts'
import { set, useClock, useStore } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { rowsOf, ticksOf, xOf, type Row } from '../waterfall.ts'

export function openTrace(call: TraceCall): void {
  // The drawer reads the live state; this is what it shows for a call that has left the trace: no end there means lost, not running.
  const result = traceResult(call, false)
  set({ call: { id: call.id, ...(call.agentId === undefined ? {} : { agentId: call.agentId }), at: call.at, who: call.who, view: call.tool, what: call.what, result, ...(call.error ? { error: call.error } : {}), ...(call.ms === undefined ? {} : { ms: call.ms }) } })
}

function Bar({ row, from, to }: { row: Row; from: number; to: number }) {
  const left = xOf(row.from, from, to)
  return <i className={`wf-bar ${row.state} ${row.isAgent ? 'agent' : ''} ${row.isSlowest ? 'slowest' : ''}`} style={{ left: `${left}%`, width: `${xOf(row.to, from, to) - left}%` }} />
}

function Name({ row, status }: { row: Row; status: string | undefined }) {
  return (
    <span className="wf-name" style={{ paddingLeft: `${row.depth * 14}px` }}>
      <b className={row.isAgent ? 'min-w-0 truncate text-signal' : row.state === 'failed' ? 'text-bad' : 'text-ink-2'} title={row.full}>{row.name}</b>
      {status ? <span className="text-warn">{status}</span> : null}
      <span className="truncate text-ink-3" title={row.what}>{row.what}</span>
    </span>
  )
}

// One row per call and subagent; an agent's own row in the table draws its calls with this too.
export function WaterfallRows({ rows, span, l }: { rows: readonly Row[]; span: { from: number; to: number }; l: Labels }) {
  const p = l.page
  return (
    <>
    {rows.map(row => {
      const asked = row.state === 'asking' ? l.status.waiting : undefined
      const inner = (
        <>
          <Name row={row} status={asked} />
          <span className="wf-track"><Bar row={row} from={span.from} to={span.to} /></span>
          <span className={`text-right font-mono text-[11px] tabular-nums ${row.isSlowest ? 'font-bold text-signal' : 'text-ink-3'}`}>{callTime(row.ms)}</span>
        </>
      )
      const { call } = row
      if (!call) return <div key={row.key} className="wf-row">{inner}</div>
      const result = traceResult(call, row.state === 'running' || row.state === 'asking')
      return (
        <button key={row.key} type="button" className="wf-row row-in" aria-label={`${p.details}: ${call.tool} ${call.what} ${resultOf(result, l).text}`} onClick={() => openTrace(call)}>
          {inner}
        </button>
      )
    })}
    </>
  )
}

export function Waterfall({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  const now = useClock(s)
  const { flowView } = useStore()
  const box = useRef<HTMLDivElement>(null)
  const isFollowing = flowView.at === null
  const span = windowOf(flowView, s, now, stateOf(s) !== 'idle')
  const rows = rowsOf(s, span, now)
  const failed = rows.filter(r => r.state === 'failed').length
  const calls = rows.filter(r => !r.isAgent).length
  const length = span.to - span.from
  const ticks = ticksOf(length)

  useEffect(() => {
    if (isFollowing && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [isFollowing, rows.length])

  const aside = <span className="font-mono text-[11px] text-ink-3 tabular-nums">{countWord(calls, p)}{failed ? <span className="text-bad"> · {failed} {failed === 1 ? p.error : p.errors}</span> : null} · {dur(length)}</span>

  return (
    <Panel id="waterfall" title={p.waterfall} help={p.helpWaterfall} icon={ChartNoAxesGantt} aside={aside}>
      {rows.length === 0 ? <Empty text={p.none} /> : (
        <div style={{ '--tick-gap': `${(ticks.step / Math.max(1, length)) * 100}%` } as CSSProperties}>
          <div className="wf-row wf-axis" aria-hidden>
            <span />
            <span className="wf-track !bg-none">
              {ticks.at.map((ms, i) => <span key={ms} className={`absolute font-mono text-[10px] whitespace-nowrap text-ink-3 ${i % 2 ? 'max-sm:hidden' : ''}`} style={{ left: `${(ms / Math.max(1, length)) * 100}%` }}>{ticks.step < 1000 ? `${(ms / 1000).toFixed(1)}s` : dur(ms)}</span>)}
            </span>
            <span />
          </div>
          <div ref={box} className="flex max-h-[460px] flex-col overflow-auto" data-testid="waterfall">
            <WaterfallRows rows={rows} span={span} l={l} />
          </div>
        </div>
      )}
    </Panel>
  )
}
