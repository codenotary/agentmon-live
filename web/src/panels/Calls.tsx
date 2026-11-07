import { ArrowDown, ArrowUp, Terminal } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { agentNames, chipsWith, firstLine, MAIN_KEY, resultOf, time, whoKey, whoOf } from '../format.ts'
import type { Labels } from '../labels.ts'
import { set, useStore } from '../store.ts'
import { Choice } from '../ui/Choice.tsx'
import { Empty, Panel } from '../ui/Panel.tsx'
import { Pill } from '../ui/Pill.tsx'
import { sortCalls, tableRows, type CallColumn, type CallSort } from '../waterfall.ts'

const CELL = 'px-[18px] py-[11px] align-top max-sm:px-2.5'
// A scroller of its own would catch the wheel on its way down the page.
const ROWS_SHOWN = 8
// Past this many values a filter is a dropdown: one chip per tool and per agent filled rows of their own.
const CHIPS_MAX = 8

export function Calls({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  const { onlyFailures, whoFilter: who } = useStore()
  const [sort, setSort] = useState<CallSort>({ id: 'at', isDesc: true })
  const [text, setText] = useState('')
  const [isAll, setAll] = useState(false)
  const [tool, setTool] = useState<string | null>(null)

  const names = useMemo(() => agentNames(s.agents), [s.agents])
  const list = useMemo(() => tableRows(s), [s])
  const tools = useMemo(() => [...new Set(list.map(c => c.view))].sort(), [list])
  const agentTypes = useMemo(() => new Set(s.agents.map(a => a.type)), [s.agents])
  // Label by key: two agents can show one name.
  const people = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of list) {
      const key = whoKey(c, agentTypes)
      if (!seen.has(key)) seen.set(key, key === MAIN_KEY ? l.main : whoOf(c, names))
    }
    return [...seen]
  }, [list, names, agentTypes, l.main])
  const rows = useMemo(() => {
    const q = text.toLowerCase()
    return list.filter(c => (!tool || c.view === tool) && (!who || whoKey(c, agentTypes) === who) && (!onlyFailures || resultOf(c.result, l).tone === 'bad') && (!q || `${whoOf(c, names)} ${c.view} ${c.what} ${c.result} ${c.error ?? ''}`.toLowerCase().includes(q)))
  }, [list, text, tool, who, onlyFailures, l, names, agentTypes])

  const all = useMemo(() => sortCalls(rows, sort, c => whoOf(c, names)), [rows, sort, names])
  const shown = isAll ? all : all.slice(0, ROWS_SHOWN)
  const columns: [CallColumn, string][] = [['at', p.when], ['who', p.who], ['what', p.what], ['result', p.result]]
  const sortBy = (id: CallColumn) => setSort(sort.id === id ? { id, isDesc: !sort.isDesc } : { id, isDesc: id === 'at' })

  const filters = (
    <>
      <input className="field !h-[26px] !w-40" type="search" aria-label={p.filterCalls} placeholder={p.filterCalls} value={text} onChange={e => setText(e.target.value)} />
      <button type="button" className="chip" aria-pressed={onlyFailures} onClick={() => set({ onlyFailures: !onlyFailures })}>{p.onlyFailures}</button>
      {tools.length > CHIPS_MAX ? <Choice label={p.what} value={tool} options={chipsWith(tools, tool).map(name => [name, name] as const)} anyText={p.allTools} onChange={setTool} testId="tool-filter" />
        : tools.length > 1 || tool ? chipsWith(tools, tool).map(name => <button key={name} type="button" className="chip font-mono" aria-pressed={tool === name} onClick={() => setTool(tool === name ? null : name)}>{name}</button>) : null}
      {people.length > CHIPS_MAX ? <Choice label={p.who} value={who} options={people} anyText={p.everyone} onChange={key => set({ whoFilter: key })} testId="who-filter" />
        : people.length > 1 || who ? (
        <>
          <button type="button" className="chip" aria-pressed={who === null} onClick={() => set({ whoFilter: null })}>{p.everyone}</button>
          {people.map(([key, name]) => <button key={key} type="button" className="chip" aria-pressed={who === key} onClick={() => set({ whoFilter: who === key ? null : key })}>{name}</button>)}
        </>
      ) : null}
    </>
  )

  return (
    <Panel id="calls" title={p.toolCalls} help={p.helpCalls} icon={Terminal} aside={list.length ? filters : undefined}>
      {list.length === 0 ? <Empty text={p.none} /> : rows.length === 0 ? <Empty text={p.noMatch} /> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead className="bg-surface-1">
              <tr>
                {columns.map(([id, head]) => {
                  const isSorted = sort.id === id
                  return (
                    <th key={id} className={`p-0 text-left ${id === 'who' ? 'max-sm:hidden' : ''}`} aria-sort={!isSorted ? 'none' : sort.isDesc ? 'descending' : 'ascending'}>
                      <button type="button" id={`sort-${id}`} className="eyebrow flex w-full cursor-pointer items-center gap-1 px-[18px] py-2.5 hover:text-ink max-sm:px-2.5" onClick={() => sortBy(id)}>
                        {head}
                        {!isSorted ? null : sort.isDesc ? <ArrowDown size={11} aria-hidden /> : <ArrowUp size={11} aria-hidden />}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map(c => {
                const r = resultOf(c.result, l)
                const open = () => set({ call: c })
                return (
                  <tr key={c.id ?? `${c.at}:${c.who}:${c.what}`} className="row-in cursor-pointer border-t border-line-soft hover:bg-surface-1" tabIndex={0} aria-label={`${p.details}: ${c.what}`} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}>
                    <td className={CELL}><span className="whitespace-nowrap text-ink-3 tabular-nums">{time(c.at)}</span></td>
                    <td className={`${CELL} max-sm:hidden`}><span className="whitespace-nowrap" title={c.agentId === undefined ? undefined : names.get(c.agentId)?.full}>{whoOf(c, names)}</span></td>
                    <td className={CELL}><span className="font-mono text-xs [overflow-wrap:anywhere]"><span className="text-ink-3">{c.view} </span>{c.what}</span>{c.result === 'failed' && c.error ? <div className="mt-0.5 font-mono text-[11px] break-words text-bad">{firstLine(c.error)}</div> : null}</td>
                    <td className={CELL}><Pill text={r.text} tone={r.tone} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {all.length > ROWS_SHOWN ? <button type="button" className="chip mt-2" aria-expanded={isAll} onClick={() => setAll(!isAll)}>{isAll ? p.listFewer : `${p.listAll} (${all.length})`}</button> : null}
        </div>
      )}
    </Panel>
  )
}
