import { Activity } from 'lucide-react'

import type { FeedEvent } from '../events.ts'
import { hhmm, time } from '../format.ts'
import type { Page } from '../labels.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { Pill } from '../ui/Pill.tsx'

export function Events({ list, p }: { list: readonly FeedEvent[]; p: Page }) {
  const open = list.filter(e => e.clearedAt === undefined)
  const isUrgent = open.some(e => e.isUrgent)
  return (
    <Panel id="events" title={p.events} help={p.helpEvents} icon={Activity} className={isUrgent ? '!border-bad' : ''} aside={open.length ? <span className={`font-mono text-xs tabular-nums ${isUrgent ? 'text-bad' : 'text-warn'}`}>{open.length}</span> : undefined}>
      {list.length === 0 ? <Empty text={p.none} /> : (
        <ol className="flex max-h-[420px] flex-col overflow-auto" data-testid="events">
          {list.map(e => {
            const isCleared = e.clearedAt !== undefined
            const level = isCleared ? 'cleared' : e.isUrgent ? 'bad' : 'warn'
            return (
              <li key={e.key} className={`event row-in ${level}`}>
                <span className="font-mono text-[11px] whitespace-nowrap text-ink-3 tabular-nums">{time(e.at)}</span>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 [overflow-wrap:anywhere]">
                  <Pill text={e.tag} tone={isCleared ? '' : e.isUrgent ? 'bad' : 'warn'} />
                  <span className={`min-w-0 text-[13px] ${isCleared ? 'text-ink-3' : ''}`}>{e.text}</span>
                  {isCleared ? <span className="font-mono text-[11px] whitespace-nowrap text-ink-3">{p.cleared} {hhmm(e.clearedAt ?? e.at)}</span> : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
