import NumberFlow from '@number-flow/react'
import { useState, type ReactNode } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { kilo, levelOf } from '../format.ts'
import type { Page } from '../labels.ts'
import type { Trend } from '../store.ts'
import { Gauge } from '../ui/Gauge.tsx'
import { HelpButton } from '../ui/Panel.tsx'
import { Sparkline } from '../ui/Sparkline.tsx'

function Stat({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-0.5 px-5 py-[18px]">
      <span className="kpi-label truncate">{label}</span>
      <span className="font-display text-[26px] leading-8 font-bold tracking-[-.02em] text-heading tabular-nums">{children}</span>
      {foot}
    </div>
  )
}

export function Instruments({ s, p, trend }: { s: WebSnapshot; p: Page; trend: Trend | undefined }) {
  const [isHelpOpen, setHelpOpen] = useState(false)
  const rate = (kind: string) => s.usage.rate.find(r => r.kind === kind)?.pct
  const five = rate('five_hour')
  const seven = rate('seven_day')
  const { tokens } = s.insights
  // Counts up over the session, so it never falls back to a dash; the per-turn figure starts over at every prompt.
  const cache = tokens.mainIn > 0 ? Math.round((tokens.mainCached / tokens.mainIn) * 100) : undefined
  const parts = [
    <Gauge key="ctx" label={p.context} pct={s.usage.ctxPct} tone={levelOf(s.usage.ctxPct)} />,
    <Gauge key="five" label={p.quota5h} pct={five} tone={levelOf(five)} />,
    <Gauge key="seven" label={p.quota} pct={seven} tone={levelOf(seven)} />,
    <Stat key="cost" label={p.cost} foot={<Sparkline points={trend?.usd ?? []} label={p.cost} className="mt-1 h-4 w-full" />}>
      <NumberFlow value={s.usage.usd} locales="en-US" format={{ style: 'currency', currency: 'USD' }} />
    </Stat>,
    <Stat key="turns" label={p.turns}><NumberFlow value={s.turnCount} /></Stat>,
    <Stat key="cache" label={p.cacheHit}>{cache === undefined ? '—' : <NumberFlow value={cache} suffix="%" />}</Stat>,
    <Stat key="tokens" label={p.tokens}>
      <span className="text-[13px] tracking-normal whitespace-nowrap">
        <span className="text-ink-3">{p.tokensIn} </span>{kilo(tokens.mainIn + tokens.agentsIn)}
        <span className="text-ink-3"> · {p.tokensOut} </span>{kilo(tokens.mainOut + tokens.agentsOut)}
      </span>
    </Stat>,
  ]
  return (
    <section id="instruments" className="kpi-band grid auto-rows-fr grid-cols-2 min-[480px]:grid-cols-3 xl:grid-cols-7 [&>*]:border-line xl:[&>*:not(:first-child)]:border-l" data-testid="instruments" aria-label={p.context}>
      {parts}
      <HelpButton text={p.helpInstruments} isOpen={isHelpOpen} onToggle={() => setHelpOpen(!isHelpOpen)} className="absolute top-1.5 right-1.5" />
      {isHelpOpen ? <p className="help-text col-span-full m-3 mt-0">{p.helpInstruments}</p> : null}
    </section>
  )
}
