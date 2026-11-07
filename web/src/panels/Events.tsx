import { Activity } from 'lucide-react'
import { useState } from 'react'

import { alertOf, EVENT_KINDS, isAsk, kindOf, splitEvents, type EventKind, type FeedEvent } from '../events.ts'
import { hhmm, time } from '../format.ts'
import type { Page } from '../labels.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { Pill } from '../ui/Pill.tsx'

function Row({ e, p }: { e: FeedEvent; p: Page }) {
  const isCleared = e.clearedAt !== undefined
  const isBad = e.isUrgent && !isAsk(e)
  const level = isCleared ? 'cleared' : isBad ? 'bad' : 'warn'
  return (
    <li className={`event row-in ${level}`}>
      <span className="font-mono text-[11px] whitespace-nowrap text-ink-3 tabular-nums">{time(e.at)}</span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 [overflow-wrap:anywhere]">
        <Pill text={e.tag} tone={isCleared ? '' : isBad ? 'bad' : 'warn'} />
        <span className={`min-w-0 text-[13px] ${isCleared ? 'text-ink-3' : ''}`}>{e.text}</span>
        {isCleared ? <span className="font-mono text-[11px] whitespace-nowrap text-ink-3">{p.cleared} {hhmm(e.clearedAt ?? e.at)}</span> : null}
      </div>
    </li>
  )
}

export function Events({ list, p }: { list: readonly FeedEvent[]; p: Page }) {
  const [kind, setKind] = useState<EventKind | null>(null)
  const open = list.filter(e => e.clearedAt === undefined)
  const alert = alertOf(open)
  const counts = new Map<EventKind, number>()
  for (const e of list) counts.set(kindOf(e.key), (counts.get(kindOf(e.key)) ?? 0) + 1)
  // A kind chosen before its last event went still shows, so it can be cleared.
  const kinds = EVENT_KINDS.filter(k => counts.has(k) || k === kind)
  const shown = kind === null ? list : list.filter(e => kindOf(e.key) === kind)
  const { attention, rest } = splitEvents(shown)
  const name: Record<EventKind, string> = { failures: p.failuresWord, waiting: p.kindWaiting, context: p.context, memory: p.kindMemory, other: p.kindOther }
  const chip = (id: EventKind | null, label: string, n: number) => (
    <button key={id ?? 'all'} type="button" className="chip" data-kind={id ?? 'all'} aria-pressed={kind === id} onClick={() => setKind(id)}>
      {label} <span className={`tabular-nums ${id === 'failures' && n > 0 ? 'font-bold text-bad' : ''}`}>{n}</span>
    </button>
  )
  return (
    <Panel id="events" title={p.events} help={p.helpEvents} icon={Activity} className={alert === 'bad' ? '!border-bad' : alert === 'warn' ? '!border-warn' : ''} aside={open.length ? <span className={`font-mono text-xs tabular-nums ${alert === 'bad' ? 'text-bad' : 'text-warn'}`}>{open.length}</span> : undefined}>
      {kinds.length > 1 ? <div className="mb-2 flex flex-wrap gap-1.5" data-testid="event-kinds">{[chip(null, p.allRows, list.length), ...kinds.map(k => chip(k, name[k], counts.get(k) ?? 0))]}</div> : null}
      {shown.length === 0 ? <Empty text={list.length ? p.noMatch : p.none} /> : (
        <div className="flex max-h-[420px] flex-col overflow-auto" data-testid="events">
          {attention.length ? (
            <>
              <span className="eyebrow mb-1">{p.needsAttention}</span>
              <ol className={rest.length ? 'mb-2 border-b border-line pb-2' : ''}>{attention.map(e => <Row key={e.key} e={e} p={p} />)}</ol>
            </>
          ) : null}
          <ol>{rest.map(e => <Row key={e.key} e={e} p={p} />)}</ol>
        </div>
      )}
    </Panel>
  )
}
