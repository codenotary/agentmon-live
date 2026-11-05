import NumberFlow from '@number-flow/react'
import type { ReactNode } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { kilo, levelOf } from '../format.ts'
import type { Page } from '../labels.ts'
import type { Trend } from '../store.ts'
import { Gauge } from '../ui/Gauge.tsx'
import { Sparkline } from '../ui/Sparkline.tsx'

function Stat({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-0.5 p-3">
      <span className="eyebrow truncate">{label}</span>
      <span className="font-display text-[22px] leading-tight font-bold tabular-nums">{children}</span>
      {foot}
    </div>
  )
}

export function Instruments({ s, p, trend }: { s: WebSnapshot; p: Page; trend: Trend | undefined }) {
  const rate = (kind: string) => s.usage.rate.find(r => r.kind === kind)?.pct
  const five = rate('five_hour')
  const seven = rate('seven_day')
  const { cacheRead, cacheTotal, tokens } = s.insights
  const cache = cacheTotal > 0 ? Math.round((cacheRead / cacheTotal) * 100) : undefined
  const parts = [
    <Gauge key="ctx" label={p.context} pct={s.usage.ctxPct} tone={levelOf(s.usage.ctxPct)} />,
    <Gauge key="five" label={p.quota5h} pct={five} tone={levelOf(five)} />,
    <Gauge key="seven" label={p.quota} pct={seven} tone={levelOf(seven)} />,
    <Stat key="cost" label={p.cost} foot={<Sparkline points={trend?.usd ?? []} label={p.cost} className="mt-1 h-4 w-full" />}>
      <NumberFlow value={s.usage.usd} locales={s.lang} format={{ style: 'currency', currency: 'USD' }} />
    </Stat>,
    <Stat key="turns" label={p.turns}><NumberFlow value={s.turnCount} /></Stat>,
    <Stat key="cache" label={p.cacheHit}>{cache === undefined ? '–' : <NumberFlow value={cache} suffix="%" />}</Stat>,
    <Stat key="tokens" label={p.tokens}>
      <span className="text-[15px]">
        <span className="text-ink-3">{p.tokensIn} </span>{kilo(tokens.mainIn + tokens.agentsIn)}
        <span className="text-ink-3"> · {p.tokensOut} </span>{kilo(tokens.mainOut + tokens.agentsOut)}
      </span>
    </Stat>,
  ]
  return (
    <section id="instruments" className="panel grid grid-cols-2 divide-line-soft sm:grid-cols-3 lg:grid-cols-7" data-testid="instruments" aria-label={p.context}>
      {parts}
    </section>
  )
}
