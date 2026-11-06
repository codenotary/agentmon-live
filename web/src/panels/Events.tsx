import { Activity } from 'lucide-react'

import { alertOf, isAsk, splitEvents, type FeedEvent } from '../events.ts'
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
  const open = list.filter(e => e.clearedAt === undefined)
  const alert = alertOf(open)
  const { attention, rest } = splitEvents(list)
  return (
    <Panel id="events" title={p.events} help={p.helpEvents} icon={Activity} className={alert === 'bad' ? '!border-bad' : alert === 'warn' ? '!border-warn' : ''} aside={open.length ? <span className={`font-mono text-xs tabular-nums ${alert === 'bad' ? 'text-bad' : 'text-warn'}`}>{open.length}</span> : undefined}>
      {list.length === 0 ? <Empty text={p.none} /> : (
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
