import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, Terminal } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { agentNames, resultOf, time, whoOf } from '../format.ts'
import type { Labels } from '../labels.ts'
import { set, useStore, type Detail } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { Pill } from '../ui/Pill.tsx'
import { tableRows } from '../waterfall.ts'

const column = createColumnHelper<Detail>()
// A scroller of its own would catch the wheel on its way down the page.
const ROWS_SHOWN = 8

export function Calls({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  const { onlyFailures, whoFilter: who } = useStore()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'at', desc: true }])
  const [text, setText] = useState('')
  const [isAll, setAll] = useState(false)

  const names = useMemo(() => agentNames(s.agents), [s.agents])
  const columns = useMemo(() => [
    column.accessor('at', { header: p.when, cell: c => <span className="whitespace-nowrap text-ink-3 tabular-nums">{time(c.getValue())}</span> }),
    column.accessor(c => whoOf(c, names), { id: 'who', header: p.who, cell: c => { const { agentId } = c.row.original; return <span className="whitespace-nowrap" title={agentId === undefined ? undefined : names.get(agentId)?.full}>{c.getValue()}</span> } }),
    column.accessor('what', { header: p.what, cell: c => <span className="font-mono text-xs [overflow-wrap:anywhere]"><span className="text-ink-3">{c.row.original.view} </span>{c.getValue()}</span> }),
    column.accessor('result', { header: p.result, cell: c => { const r = resultOf(c.getValue(), l); return <Pill text={r.text} tone={r.tone} /> } }),
  ], [p, l, names])

  const list = useMemo(() => tableRows(s), [s])
  const people = useMemo(() => [...new Set(list.map(c => whoOf(c, names)))], [list, names])
  const rows = useMemo(() => {
    const q = text.toLowerCase()
    return list.filter(c => (!who || whoOf(c, names) === who) && (!onlyFailures || resultOf(c.result, l).tone === 'bad') && (!q || `${whoOf(c, names)} ${c.view} ${c.what} ${c.result} ${c.error ?? ''}`.toLowerCase().includes(q)))
  }, [list, text, who, onlyFailures, l, names])

  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: c => c.id ?? `${c.at}:${c.who}:${c.what}` })

  const all = table.getRowModel().rows
  const shown = isAll ? all : all.slice(0, ROWS_SHOWN)

  const filters = (
    <>
      <input className="field !h-[26px] !w-40" type="search" aria-label={p.filterCalls} placeholder={p.filterCalls} value={text} onChange={e => setText(e.target.value)} />
      <button type="button" className="chip" aria-pressed={onlyFailures} onClick={() => set({ onlyFailures: !onlyFailures })}>{p.onlyFailures}</button>
      {people.length > 1 ? (
        <>
          <button type="button" className="chip" aria-pressed={who === null} onClick={() => set({ whoFilter: null })}>{p.everyone}</button>
          {people.map(name => <button key={name} type="button" className="chip" aria-pressed={who === name} onClick={() => set({ whoFilter: who === name ? null : name })}>{name}</button>)}
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
              {table.getHeaderGroups().map(group => (
                <tr key={group.id}>
                  {group.headers.map(h => {
                    const dir = h.column.getIsSorted()
                    return (
                      <th key={h.id} className={`p-0 text-left ${h.id === 'who' ? 'max-sm:hidden' : ''}`} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
                        <button type="button" id={`sort-${h.id}`} className="eyebrow flex w-full cursor-pointer items-center gap-1 px-[18px] py-2.5 hover:text-ink max-sm:px-2.5" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : dir === 'desc' ? <ArrowDown size={11} aria-hidden /> : null}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {shown.map(row => (
                <tr key={row.id} className="row-in cursor-pointer border-t border-line-soft hover:bg-surface-1" tabIndex={0} aria-label={`${p.details}: ${row.original.what}`} onClick={() => set({ call: row.original })} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set({ call: row.original }) } }}>
                  {row.getVisibleCells().map(cell => <td key={cell.id} className={`px-[18px] py-[11px] align-top max-sm:px-2.5 ${cell.column.id === 'who' ? 'max-sm:hidden' : ''}`}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {all.length > ROWS_SHOWN ? <button type="button" className="chip mt-2" aria-expanded={isAll} onClick={() => setAll(!isAll)}>{isAll ? p.listFewer : `${p.listAll} (${all.length})`}</button> : null}
        </div>
      )}
    </Panel>
  )
}
