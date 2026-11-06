import { ArrowDown, ArrowUp, Bot, ChevronRight, Copy, Terminal, TriangleAlert } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'

import type { Card, WebSnapshot } from '../../../types/index'
import { dotOf, elapsedOf, endOf, groupLines, isRunning, LEVEL_TONE, linesOf, sortLines, tokensOf, totalsOf, type AgentLine, type Pips, type Sort, type SortKey } from '../agents.ts'
import { agentNames, dur, hhmm, kilo, time, type AgentName } from '../format.ts'
import type { Labels } from '../labels.ts'
import { jumpTo } from '../Nav.tsx'
import { copyText } from '../Palette.tsx'
import { set, useClock, useStore } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { Pill, toneVar } from '../ui/Pill.tsx'
import { rowsOf } from '../waterfall.ts'
import { WaterfallRows } from './Waterfall.tsx'

const usdText = (n: number) => `$${n.toFixed(2)}`
const dash = (n: number) => (n > 0 ? String(n) : '–')

function PipSet({ pips, l }: { pips: Pips; l: Labels }) {
  const p = l.page
  const word = { 0: p.levelGood, 1: p.levelWarn, 2: p.levelBad }
  const parts = [[p.duration, pips.duration], [p.tokens, pips.tokens], [p.errors, pips.errors]] as const
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={parts.map(([name, level]) => `${name}: ${word[level]}`).join(', ')}>
      {parts.map(([name, level]) => <i key={name} className="pip" title={`${name}: ${word[level]}`} style={{ background: toneVar(LEVEL_TONE[level]) }} />)}
    </span>
  )
}

const Metric = ({ text, share }: { text: string; share: number }) => (
  <span className="inline-flex items-center justify-end gap-1.5">
    {text}
    <span className="inline-bar" aria-hidden><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
  </span>
)

function showCalls(id: string, onlyFailures: boolean): void {
  set({ whoFilter: id, onlyFailures })
  jumpTo('calls')
}

function Detail({ a, s, l, name, now }: { a: Card; s: WebSnapshot; l: Labels; name: AgentName | undefined; now: number }) {
  const p = l.page
  const end = endOf(a, now)
  const span = { from: a.startedAt, to: end }
  const rows = rowsOf({ trace: (s.trace ?? []).filter(c => c.agentId === a.id), agents: [], active: s.active }, span, now)
  const turn = s.turns.findLast(t => t.startedAt <= a.startedAt)
  const summary = `${name?.full ?? a.task}\n${a.type} · ${a.model}${a.effort ? ` ${a.effort}` : ''}\n${dur(end - a.startedAt)} · ${a.tools} ${p.calls} · ${kilo(tokensOf(a))} ${p.tokens} · ${usdText(a.usd ?? 0)} · ${a.errors ?? 0} ${p.errors}`
  const facts: [string, ReactNode][] = [
    [p.tokens, `${p.tokensIn} ${kilo(a.input)} · ${p.tokensOut} ${kilo(a.output)} · ${p.cached} ${kilo(a.cached)}`],
    [p.started, `${time(a.startedAt)}${a.endedAt === undefined ? '' : ` · ${p.ended} ${time(a.endedAt)}`}`],
    [p.model, `${a.model}${a.effort ? ` ${a.effort}` : ''}`],
    ...(turn ? [[p.turn, hhmm(turn.startedAt)] as [string, ReactNode]] : []),
    [p.result, `${l.status[a.status] ?? a.status}${a.testsWhy ? ` · ${a.testsWhy}` : ''}`],
  ]
  return (
    <div className="fold-in overflow-hidden">
      <div className="grid gap-4 border-t border-line-soft bg-surface-1 p-3 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2 text-xs">
          <p className="text-[13px] [overflow-wrap:anywhere] whitespace-pre-wrap">{a.prompt || a.task}</p>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
            {facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-3">{k}</dt><dd className="font-mono [overflow-wrap:anywhere]">{v}</dd></div>)}
          </dl>
        </div>
        <div className="min-w-0">
          {rows.length === 0 ? <Empty text={p.none} /> : <div className="flex max-h-[240px] flex-col overflow-auto"><WaterfallRows rows={rows} span={span} l={l} /></div>}
        </div>
        <div className="flex flex-wrap gap-2 lg:col-span-2">
          <button type="button" className="icon-btn" onClick={() => showCalls(a.id, false)}><Terminal size={13} aria-hidden />{p.showCalls}</button>
          <button type="button" className="icon-btn" onClick={() => void copyText(summary, p.copied)}><Copy size={13} aria-hidden />{p.copySummary}</button>
          <button type="button" className="icon-btn" onClick={() => showCalls(a.id, true)}><TriangleAlert size={13} aria-hidden />{p.onlyFailures}</button>
        </div>
      </div>
    </div>
  )
}

function onRowKey(e: KeyboardEvent<HTMLTableRowElement>, toggle: () => void, close: () => void, filter?: () => void): void {
  if (e.target !== e.currentTarget) return
  const rows = [...(e.currentTarget.closest('tbody')?.querySelectorAll<HTMLElement>('tr[data-line]') ?? [])]
  const at = rows.indexOf(e.currentTarget)
  const move = (to: number) => rows[to]?.focus()
  if (e.key === 'ArrowDown') move(at + 1)
  else if (e.key === 'ArrowUp') move(at - 1)
  else if (e.key === 'Enter' || e.key === ' ') toggle()
  else if (e.key === 'Escape') close()
  else if (e.key === 'f' && filter) filter()
  else return
  e.preventDefault()
}

type LineProps = { id: string; isOpen: boolean; setOpen: (id: string, isOpen: boolean) => void; dot: string; title: string; name: ReactNode; sub: ReactNode; ms: number; calls: number; tokens: number; usd: number; errors: number; files: number; pips: Pips; most: { calls: number; tokens: number }; hasCost: boolean; l: Labels; onErrors?: () => void; onFilter?: () => void; isMember?: boolean }

function Line({ id, isOpen, setOpen, dot, title, name, sub, ms, calls, tokens, usd, errors, files, pips, most, hasCost, l, onErrors, onFilter, isMember }: LineProps) {
  const toggle = () => setOpen(id, !isOpen)
  const stop = (e: MouseEvent) => {
    e.stopPropagation()
    onErrors?.()
  }
  return (
    <tr data-line className="agent-line" tabIndex={0} aria-expanded={isOpen} onClick={toggle} onKeyDown={e => onRowKey(e, toggle, () => setOpen(id, false), onFilter)}>
      <td className="w-7 pl-2"><i className={`agent-dot ${dot}`} aria-hidden /></td>
      <td className={`max-w-0 min-w-0 w-full py-1 pr-2 ${isMember ? 'pl-4' : ''}`} title={title}>
        <div className="flex min-w-0 items-center gap-2"><span className="truncate text-[13px] font-medium">{name}</span></div>
        <div className="truncate font-mono text-[11px] text-ink-3">{sub}</div>
      </td>
      <td className="num">{dur(ms)}</td>
      <td className="num max-sm:hidden"><Metric text={String(calls)} share={calls / most.calls} /></td>
      <td className="num max-sm:hidden"><Metric text={kilo(tokens)} share={tokens / most.tokens} /></td>
      {hasCost ? <td className="num max-md:hidden">{usdText(usd)}</td> : null}
      <td className="num max-sm:hidden">{errors > 0 ? (onErrors ? <button type="button" className="cursor-pointer text-bad underline-offset-2 hover:underline" aria-label={`${l.page.onlyFailures}: ${errors}`} onClick={stop}>{errors}</button> : <span className="text-bad">{errors}</span>) : '–'}</td>
      <td className="num max-md:hidden">{dash(files)}</td>
      <td className="px-2"><PipSet pips={pips} l={l} /></td>
      <td className="w-6 pr-2 text-ink-3"><ChevronRight size={14} className={`chevron ${isOpen ? 'open' : ''}`} aria-hidden /></td>
    </tr>
  )
}

export function Agents({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  const now = useClock(s)
  const [sort, setSort] = useState<Sort>(null)
  const { openAgents: open } = useStore()
  const names = useMemo(() => agentNames(s.agents), [s.agents])
  const lines = sortLines(linesOf(s.agents, s.trace ?? [], now), sort, now)
  const items = groupLines(lines, now)
  const totals = totalsOf(s.agents)
  const hasCost = totals.usd > 0
  const most = { calls: Math.max(1, ...s.agents.map(a => a.tools)), tokens: Math.max(1, ...s.agents.map(tokensOf)) }
  const setOpen = (id: string, isOpen: boolean) => {
    const next = new Set(open)
    if (isOpen) next.add(id)
    else next.delete(id)
    set({ openAgents: next })
  }
  const columnCount = hasCost ? 10 : 9

  const agentRow = ({ a, pips }: AgentLine, isMember: boolean) => {
    const name = names.get(a.id)
    const isOpen = open.has(a.id)
    return [
      <Line
        key={a.id}
        id={a.id}
        isOpen={isOpen}
        setOpen={setOpen}
        dot={dotOf(a)}
        title={[name?.full, a.testsWhy].filter(Boolean).join('\n')}
        name={<>{name?.short ?? a.type}{a.tests === 'FAIL' ? <>{' '}<Pill text="FAIL" tone="bad" /></> : null}</>}
        sub={`${a.type} · ${a.model}${a.effort ? ` ${a.effort}` : ''}`}
        ms={elapsedOf(a, now)}
        calls={a.tools}
        tokens={tokensOf(a)}
        usd={a.usd ?? 0}
        errors={a.errors ?? 0}
        files={a.files}
        pips={pips}
        most={most}
        hasCost={hasCost}
        l={l}
        isMember={isMember}
        onErrors={() => showCalls(a.id, true)}
        onFilter={() => showCalls(a.id, false)}
      />,
      isOpen ? <tr key={`${a.id}:detail`}><td colSpan={columnCount} className="p-0"><Detail a={a} s={s} l={l} name={name} now={now} /></td></tr> : null,
    ]
  }

  const head = (key: SortKey | null, text: string, cls = '') => {
    const isSorted = key !== null && sort?.key === key
    return (
      <th className={`p-0 ${cls}`} aria-sort={isSorted ? (sort.isDesc ? 'descending' : 'ascending') : undefined}>
        {key === null ? <span className="eyebrow block px-2 py-2 text-left">{text}</span> : (
          <button type="button" className="eyebrow ml-auto flex cursor-pointer items-center gap-1 px-2 py-2 hover:text-ink" onClick={() => setSort(isSorted ? (sort.isDesc ? { key, isDesc: false } : null) : { key, isDesc: true })}>
            {text}
            {isSorted ? (sort.isDesc ? <ArrowDown size={11} aria-hidden /> : <ArrowUp size={11} aria-hidden />) : null}
          </button>
        )}
      </th>
    )
  }

  const aside = s.agents.length ? (
    <span className="font-mono text-[11px] text-ink-3 tabular-nums" data-testid="agent-totals">
      {totals.count} {p.agentsWord}
      {totals.running ? ` · ${totals.running} ${l.status.running}` : ''}
      {totals.failed ? <span className="text-bad"> · {totals.failed} {l.result.failed}</span> : null}
      {` · ${kilo(totals.tokens)} ${p.tokens}`}
      {hasCost ? ` · ${usdText(totals.usd)}` : ''}
    </span>
  ) : undefined

  return (
    <Panel id="agents" title={p.subagents} help={p.helpAgents} icon={Bot} aside={aside}>
      {s.agents.length === 0 ? <Empty text={p.none} /> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] tabular-nums" data-testid="agents">
            <thead>
              <tr>
                <th className="w-7 p-0" aria-hidden />
                {head(null, p.agentColumn)}
                {head('elapsed', p.elapsed, 'text-right')}
                {head('calls', p.calls, 'text-right max-sm:hidden')}
                {head('tokens', p.tokens, 'text-right max-sm:hidden')}
                {hasCost ? head('usd', p.costColumn, 'text-right max-md:hidden') : null}
                {head('errors', p.errors, 'text-right max-sm:hidden')}
                {head('files', p.files, 'text-right max-md:hidden')}
                {head('health', p.health, 'text-right')}
                <th className="w-6 p-0" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {items.flatMap(item => {
                if (item.kind === 'agent') return agentRow(item.line, false)
                const id = `group:${item.prefix}`
                const isOpen = open.has(id)
                const anyRunning = item.lines.some(x => isRunning(x.a))
                return [
                  <Line
                    key={id}
                    id={id}
                    isOpen={isOpen}
                    setOpen={setOpen}
                    dot={item.totals.failed ? 'error' : anyRunning ? 'running' : 'done'}
                    title={item.prefix.replace(/: $/, '')}
                    name={item.prefix.replace(/: $/, '')}
                    sub={`${item.totals.count} ${p.agentsWord}${item.totals.running ? ` · ${item.totals.running} ${l.status.running}` : ''}`}
                    ms={item.to - item.from}
                    calls={item.calls}
                    tokens={item.totals.tokens}
                    usd={item.totals.usd}
                    errors={item.errors}
                    files={item.files}
                    pips={item.pips}
                    most={{ calls: Math.max(most.calls, item.calls), tokens: Math.max(most.tokens, item.totals.tokens) }}
                    hasCost={hasCost}
                    l={l}
                  />,
                  ...(isOpen ? item.lines.flatMap(x => agentRow(x, true)) : []),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
