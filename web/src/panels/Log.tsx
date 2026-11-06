import { ScrollText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { agentNames, callTime, resultOf, time, tone, type AgentName } from '../format.ts'
import type { Labels } from '../labels.ts'
import { chipCounts, logRows, matchesChip, stripOf, type LogChip, type LogRow } from '../logrows.ts'
import { useClock } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { toneVar } from '../ui/Pill.tsx'
import { openTrace } from './Waterfall.tsx'

const END_SLACK_PX = 24

function Marked({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const at = text.toLowerCase().indexOf(q)
  if (at < 0) return <>{text}</>
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + q.length)}</mark><Marked text={text.slice(at + q.length)} q={q} /></>
}

function Row({ row, q, now, l, names }: { row: LogRow; q: string; now: number; l: Labels; names: ReadonlyMap<string, AgentName> }) {
  const shown = row.tool === undefined ? { text: row.result, tone: tone(row.result) } : resultOf(row.result, l)
  const ms = row.isRunning ? now - row.at : row.ms
  const cells = (
    <>
      <span className="whitespace-nowrap text-ink-3">{time(row.at)}</span>
      <span className={`truncate ${row.isYou ? 'font-bold text-heading' : 'text-signal'}`} title={row.agentId === undefined ? undefined : names.get(row.agentId)?.full}><Marked text={row.who} q={q} /></span>
      <span className={`max-sm:col-start-2 [overflow-wrap:anywhere] ${row.isYou ? 'font-bold text-heading' : ''}`}>
        {row.tool === undefined ? null : <span className="text-ink-3"><Marked text={row.tool} q={q} /> </span>}
        <Marked text={row.what} q={q} />
        {row.count > 1 ? <span className="ml-1.5 text-ink-2">×{row.count}</span> : null}
      </span>
      <span className="whitespace-nowrap text-ink-3 tabular-nums max-sm:col-start-2 sm:text-right">{callTime(ms)}</span>
      <span className={`max-sm:col-start-2 [overflow-wrap:anywhere] sm:text-right ${row.isFailed ? 'font-bold' : ''}`} style={{ color: row.isFailed ? 'var(--bad)' : toneVar(shown.tone) }}>
        {row.isRunning ? <i className="rec mr-1.5 inline-block size-1.5 rounded-full bg-signal-bright align-middle" aria-hidden /> : null}
        <Marked text={shown.text} q={q} />
      </span>
    </>
  )
  const grid = `row-in grid w-full grid-cols-[76px_minmax(0,1fr)] gap-x-2.5 rounded px-1 py-0.5 text-left sm:grid-cols-[72px_190px_minmax(0,1fr)_56px_minmax(48px,140px)] ${row.isFailed ? 'bg-bad-soft' : ''}`
  const { call } = row
  return call ? <button type="button" className={`${grid} cursor-pointer hover:bg-surface-2`} aria-label={`${l.page.details}: ${call.tool} ${call.what}`} onClick={() => openTrace(call)}>{cells}</button> : <div className={grid}>{cells}</div>
}

export function Log({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  const now = useClock(s)
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<LogChip>('all')
  const [follow, setFollow] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const q = query.toLowerCase()
  const names = useMemo(() => agentNames(s.agents), [s.agents])
  const all = useMemo(() => logRows(s, p.you, names), [s.log, s.trace, s.turns, names, p.you])
  const counts = chipCounts(all)
  const rows = all.filter(x => matchesChip(x, chip) && (!q || `${x.who} ${x.tool ?? ''} ${x.what} ${x.tool === undefined ? x.result : resultOf(x.result, l).text}`.toLowerCase().includes(q)))
  const strip = stripOf(rows)
  const tallest = Math.max(1, ...strip.map(b => b?.count ?? 0))

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [follow, rows.length, rows.at(-1)?.at])

  const goTo = (index: number) => {
    const el = box.current?.children[index]
    if (!box.current || !el) return
    setFollow(false)
    box.current.scrollTop += el.getBoundingClientRect().top - box.current.getBoundingClientRect().top
  }
  const chips: [LogChip, string][] = [['all', p.allRows], ['failures', p.failuresWord], ['you', p.you], ['agents', p.subagents]]
  const aside = (
    <>
      <input id="q" className="field !h-[26px] !w-48" type="search" aria-label={p.search} placeholder={`${p.search}  /`} value={query} onChange={e => setQuery(e.target.value)} />
      <button type="button" className="chip" aria-pressed={follow} onClick={() => setFollow(!follow)}>{p.follow}</button>
    </>
  )
  return (
    <Panel id="log" title={p.log} help={p.helpLog} icon={ScrollText} aside={aside}>
      <div className="mb-2 flex flex-wrap gap-1.5" data-testid="log-chips">
        {chips.map(([id, label]) => <button key={id} type="button" className="chip" data-chip={id} aria-pressed={chip === id} onClick={() => setChip(id)}>{label} <span className={`tabular-nums ${id === 'failures' && counts.failures > 0 ? 'font-bold text-bad' : ''}`}>{counts[id]}</span></button>)}
      </div>
      {rows.length === 0 ? <Empty text={q || chip !== 'all' ? p.noMatch : p.none} /> : (
        <>
          <div className="mb-2 flex h-8 items-end gap-px" data-testid="log-strip">
            {strip.map((bar, i) => (bar ? (
              <button key={i} type="button" tabIndex={-1} className="group flex h-full min-w-0 flex-1 cursor-pointer items-end" data-failed={bar.isFailed || undefined} aria-label={`${time(bar.at)}: ${bar.count}`} title={time(bar.at)} onClick={() => goTo(bar.target)}>
                <i className={`block w-full rounded-t-[1px] group-hover:opacity-70 ${bar.isFailed ? 'bg-bad' : 'bg-ink-3'}`} style={{ height: bar.isFailed ? '100%' : `${Math.max(12, (bar.count / tallest) * 100)}%` }} />
              </button>
            ) : <span key={i} className="h-px min-w-0 flex-1 self-end bg-line" />))}
          </div>
          <div
            ref={box}
            className="log flex max-h-[360px] flex-col gap-0.5 overflow-auto font-mono text-xs"
            data-testid="log-rows"
            onScroll={e => {
              const el = e.currentTarget
              const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < END_SLACK_PX
              if (atEnd !== follow) setFollow(atEnd)
            }}
          >
            {rows.map(x => <Row key={x.key} row={x} q={q} now={now} l={l} names={names} />)}
          </div>
        </>
      )}
    </Panel>
  )
}
