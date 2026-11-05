import NumberFlow from '@number-flow/react'
import { useState, type CSSProperties, type ReactNode } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { blockedOf, dur, kilo, levelOf } from '../format.ts'
import type { Page } from '../labels.ts'
import type { Trend } from '../store.ts'
import { Gauge } from '../ui/Gauge.tsx'
import { HelpButton } from '../ui/Panel.tsx'
import { Sparkline } from '../ui/Sparkline.tsx'

function Stat({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-0.5 px-4 py-[18px]">
      <span className="kpi-label truncate">{label}</span>
      <span className="font-display text-[26px] leading-8 font-bold tracking-[-.02em] text-heading tabular-nums">{children}</span>
      {foot}
    </div>
  )
}

export function Instruments({ s, p, trend }: { s: WebSnapshot; p: Page; trend: Trend | undefined }) {
  const [isHelpOpen, setHelpOpen] = useState(false)
  const [isContextOpen, setContextOpen] = useState(false)
  const rate = (kind: string) => s.usage.rate.find(r => r.kind === kind)?.pct
  const five = rate('five_hour')
  const seven = rate('seven_day')
  const { tokens } = s.insights
  // Counts up over the session, so it never falls back to a dash; the per-turn figure starts over at every prompt.
  const cache = tokens.mainIn > 0 ? Math.round((tokens.mainCached / tokens.mainIn) * 100) : undefined
  const blocked = blockedOf(s)
  const parts = [
    <button key="ctx" type="button" className="cursor-pointer text-left hover:bg-surface-1" aria-expanded={isContextOpen} data-testid="context-gauge" onClick={() => setContextOpen(!isContextOpen)}><Gauge label={p.context} pct={s.usage.ctxPct} tone={levelOf(s.usage.ctxPct)} /></button>,
    // Without a plan's limits there is nothing to show until a value exists.
    five === undefined ? null : <Gauge key="five" label={p.quota5h} pct={five} tone={levelOf(five)} />,
    seven === undefined ? null : <Gauge key="seven" label={p.quota} pct={seven} tone={levelOf(seven)} />,
    <Stat key="cost" label={p.cost} foot={<Sparkline points={trend?.usd ?? []} label={p.cost} className="mt-1 h-4 w-full" />}>
      <NumberFlow value={s.usage.usd} locales="en-US" format={{ style: 'currency', currency: 'USD' }} />
    </Stat>,
    <Stat key="blocked" label={p.blockedOnYou} foot={<span className="text-xs text-ink-3 tabular-nums">{blocked.pct}%</span>}>{dur(blocked.ms)}</Stat>,
    <Stat key="turns" label={p.turns}><NumberFlow value={s.turnCount} /></Stat>,
    <Stat key="cache" label={p.cacheHit}>{cache === undefined ? '—' : <NumberFlow value={cache} suffix="%" />}</Stat>,
    <Stat key="tokens" label={p.tokens}>
      <span className="text-[13px] tracking-normal whitespace-nowrap">
        <span className="text-ink-3">{p.tokensIn} </span>{kilo(tokens.mainIn + tokens.agentsIn)}
        <span className="text-ink-3"> · {p.tokensOut} </span>{kilo(tokens.mainOut + tokens.agentsOut)}
      </span>
    </Stat>,
  ].filter(Boolean)
  const fills = [...(s.insights.breakdown ?? []), ...(s.insights.mcpTokens ? [{ name: p.mcpTools, tokens: s.insights.mcpTokens }] : []), ...(s.insights.memoryTokens ? [{ name: p.memoryFiles, tokens: s.insights.memoryTokens }] : [])]
  return (
    <section id="instruments" className="kpi-band grid grid-cols-2 min-[480px]:grid-cols-3 xl:[grid-template-columns:repeat(var(--tiles),minmax(0,1fr))] [&>*]:border-line xl:[&>*:not(:first-child)]:border-l" style={{ '--tiles': parts.length } as CSSProperties} data-testid="instruments" aria-label={p.context}>
      {parts}
      <HelpButton text={p.helpInstruments} isOpen={isHelpOpen} onToggle={() => setHelpOpen(!isHelpOpen)} className="absolute top-1.5 right-1.5" />
      {isHelpOpen ? <p className="help-text col-span-full m-3 mt-0">{p.helpInstruments}</p> : null}
      {isContextOpen ? (
        <div className="col-span-full !border-l-0 border-t px-5 py-3 text-xs" data-testid="context-parts">
          <span className="eyebrow">{p.contextParts}</span>
          {fills.length === 0 ? <p className="mt-1 text-ink-3">{p.none}</p> : (
            <ul className="mt-1 flex flex-col gap-0.5">{fills.map(f => <li key={f.name} className="flex justify-between gap-3"><span className="min-w-0 truncate">{f.name}</span><span className="font-mono text-ink-2 tabular-nums">{kilo(f.tokens)}</span></li>)}</ul>
          )}
          {s.insights.big.length ? (
            <>
              <span className="eyebrow mt-3 block">{p.big}</span>
              <ul className="mt-1 flex flex-col gap-0.5">{s.insights.big.slice(0, 5).map(c => <li key={`${c.at}:${c.what}`} className="flex justify-between gap-3"><span className="min-w-0 truncate font-mono">{c.tool} {c.what}</span><span className="font-mono text-ink-2 tabular-nums">{kilo(c.tokens)}</span></li>)}</ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
