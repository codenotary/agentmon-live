import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, Terminal } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { Call, WebSnapshot } from '../../../types/index'
import { resultOf, time } from '../format.ts'
import type { Labels } from '../labels.ts'
import { set, useStore } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { Pill } from '../ui/Pill.tsx'

const column = createColumnHelper<Call>()

export function Calls({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  const { onlyFailures } = useStore()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'at', desc: true }])
  const [text, setText] = useState('')
  const [who, setWho] = useState<string | null>(null)

  const columns = useMemo(() => [
    column.accessor('at', { header: p.when, cell: c => <span className="whitespace-nowrap text-ink-3 tabular-nums">{time(c.getValue())}</span> }),
    column.accessor('who', { header: p.who, cell: c => <span className="whitespace-nowrap">{c.getValue()}</span> }),
    column.accessor('what', { header: p.what, cell: c => <span className="font-mono text-xs [overflow-wrap:anywhere]">{c.getValue()}</span> }),
    column.accessor('result', { header: p.result, cell: c => { const r = resultOf(c.getValue(), l); return <Pill text={r.text} tone={r.tone} /> } }),
  ], [p, l])

  const people = useMemo(() => [...new Set(s.calls.map(c => c.who))], [s.calls])
  const rows = useMemo(() => {
    const q = text.toLowerCase()
    return s.calls.filter(c => (!who || c.who === who) && (!onlyFailures || resultOf(c.result, l).tone === 'bad') && (!q || `${c.who} ${c.what} ${c.result} ${c.error ?? ''}`.toLowerCase().includes(q)))
  }, [s.calls, text, who, onlyFailures, l])

  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: c => c.id ?? `${c.at}:${c.who}:${c.what}` })

  const filters = (
    <>
      <input className="field !h-[26px] !w-40" type="search" aria-label={p.filterCalls} placeholder={p.filterCalls} value={text} onChange={e => setText(e.target.value)} />
      <button type="button" className="chip" aria-pressed={onlyFailures} onClick={() => set({ onlyFailures: !onlyFailures })}>{p.onlyFailures}</button>
      {people.length > 1 ? (
        <>
          <button type="button" className="chip" aria-pressed={who === null} onClick={() => setWho(null)}>{p.everyone}</button>
          {people.map(name => <button key={name} type="button" className="chip" aria-pressed={who === name} onClick={() => setWho(who === name ? null : name)}>{name}</button>)}
        </>
      ) : null}
    </>
  )

  return (
    <Panel id="calls" title={p.toolCalls} icon={Terminal} aside={s.calls.length ? filters : undefined}>
      {s.calls.length === 0 ? <Empty text={p.none} /> : rows.length === 0 ? <Empty text={p.noMatch} /> : (
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-surface">
              {table.getHeaderGroups().map(group => (
                <tr key={group.id}>
                  {group.headers.map(h => {
                    const dir = h.column.getIsSorted()
                    return (
                      <th key={h.id} className={`p-0 text-left ${h.id === 'who' ? 'max-sm:hidden' : ''}`} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
                        <button type="button" id={`sort-${h.id}`} className="eyebrow flex w-full cursor-pointer items-center gap-1 px-2.5 py-2 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
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
              {table.getRowModel().rows.map(row => (
                <tr key={row.id} className="row-in cursor-pointer border-t border-line-soft hover:bg-surface-2" tabIndex={0} aria-label={`${p.details}: ${row.original.what}`} onClick={() => set({ call: row.original })} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set({ call: row.original }) } }}>
                  {row.getVisibleCells().map(cell => <td key={cell.id} className={`px-2.5 py-1.5 align-top ${cell.column.id === 'who' ? 'max-sm:hidden' : ''}`}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
