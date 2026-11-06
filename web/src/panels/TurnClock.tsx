import * as Tooltip from '@radix-ui/react-tooltip'
import { Timer } from 'lucide-react'

import type { WebSnapshot } from '../../../types/index'
import { dur, firstLine, hhmm, RAMP_STEPS, rampColour, rankBuckets } from '../format.ts'
import type { Labels } from '../labels.ts'
import { useClock } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'

const TURNS_SHOWN = 14

export function TurnClock({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  // A live turn posts its time every few seconds; between posts the clock runs on here.
  const now = useClock(s)
  const shown = s.turns.slice(-TURNS_SHOWN)
  if (shown.length === 0) return <Panel id="turns" title={p.turnClock} help={p.helpTurns} icon={Timer}><Empty text={p.none} /></Panel>
  const ranked = rankBuckets(shown)
  const name = (k: string) => l.buckets[k] ?? k
  const longest = Math.max(1, ...shown.map(t => t.wallMs))
  return (
    <Panel id="turns" title={p.turnClock} help={p.helpTurns} icon={Timer}>
      <div className="flex flex-col gap-1.5">
        {shown.map(t => {
          const used = Object.values(t.buckets).reduce((a, b) => a + b, 0) || 1
          const parts = ranked.filter(k => (t.buckets[k] ?? 0) > 0)
          const summary = parts.map(k => `${name(k)} ${dur(t.buckets[k])}`).join(' · ')
          return (
            <div key={t.startedAt} className="grid grid-cols-[66px_minmax(0,1fr)_72px] items-center gap-2.5 text-xs">
              <span className={`whitespace-nowrap tabular-nums ${t.isLive ? 'text-signal-bright' : 'text-ink-3'}`} title={t.isLive ? p.running : undefined}>{hhmm(t.startedAt)}</span>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div className={`flex h-3.5 overflow-hidden rounded bg-surface-2 transition-[width] duration-500 ${t.isLive ? 'rec' : ''}`} role="img" aria-label={summary} style={{ width: `${Math.max(2, (t.wallMs / longest) * 100)}%` }}>
                    {parts.map(k => <i key={k} className="block h-full min-w-px transition-[width] duration-500" style={{ width: `${((t.buckets[k] ?? 0) / used) * 100}%`, background: rampColour(ranked, k) }} />)}
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Portal><Tooltip.Content className="pop" sideOffset={6}>{t.prompt ? <b className="block font-semibold">{firstLine(t.prompt)}</b> : null}{summary}</Tooltip.Content></Tooltip.Portal>
              </Tooltip.Root>
              <span className="text-right text-ink-3 tabular-nums">{dur(t.isLive ? now - t.startedAt : t.wallMs)}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-ink-2">
        {ranked.slice(0, RAMP_STEPS).map(k => <span key={k} className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px]" style={{ background: rampColour(ranked, k) }} />{name(k)}</span>)}
        {ranked.length > RAMP_STEPS ? <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px]" style={{ background: 'var(--ramp-other)' }} />{l.cat.other ?? 'other'}</span> : null}
      </div>
    </Panel>
  )
}
