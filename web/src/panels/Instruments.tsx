import NumberFlow from '@number-flow/react'
import { useState, type CSSProperties, type ReactNode } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { blockedOf, dur, kilo, levelOf, type Tone, callText } from '../format.ts'
import { bandTone, fill, GUIDE, isAheadOfPace, paceOf, referenceOf, reversedLevel, typicalOf } from '../kpi.ts'
import type { Page } from '../labels.ts'
import { useStore, type Trend } from '../store.ts'
import { Gauge } from '../ui/Gauge.tsx'
import { HelpButton } from '../ui/Panel.tsx'
import { toneVar } from '../ui/Pill.tsx'
import { Ruler, ShareBar } from '../ui/Ruler.tsx'
import { Sparkline } from '../ui/Sparkline.tsx'

function Stat({ label, tone = '', children, foot }: { label: string; tone?: Tone; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-0.5 px-4 py-[18px]">
      <span className="kpi-label truncate">{label}</span>
      <span className="flex min-w-0 items-center gap-2 font-display text-[26px] leading-8 font-bold tracking-[-.02em] text-heading tabular-nums" style={tone ? { color: toneVar(tone) } : undefined}>{children}</span>
      {foot}
    </div>
  )
}

const Note = ({ text }: { text: string }) => <span className="text-xs text-ink-3 tabular-nums">{text}</span>
const usdText = (usd: number) => `$${usd.toFixed(2)}`

// Against a reference the ruler runs to twice that, so the tick sits in the middle: 75% of the track is 150% of it. A guide says nothing good or bad, so its zones stay neutral.
function referenceFoot(value: number, ref: { value: number; isGuide: boolean }, text: string, tone: Tone, zones: readonly { to: number; tone: Tone }[], p: Page) {
  const pct = (value / ref.value) * 100
  return (
    <>
      <Ruler pos={pct / 2} tone={tone} tick={50} zones={ref.isGuide ? [{ to: 100, tone: '' }] : zones} />
      <Note text={fill(ref.isGuide ? p.ofGuide : p.ofTypical, { pct: Math.round(pct), v: text })} />
    </>
  )
}

export function Instruments({ s, p, trend }: { s: WebSnapshot; p: Page; trend: Trend | undefined }) {
  const isDown = useStore(st => st.isDown)
  const [isHelpOpen, setHelpOpen] = useState(false)
  const [isContextOpen, setContextOpen] = useState(false)
  const { tokens } = s.insights
  // Counts up over the session, so it never falls back to a dash; the per-turn figure starts over at every prompt.
  const cache = tokens.mainIn > 0 ? Math.round((tokens.mainCached / tokens.mainIn) * 100) : undefined
  const blocked = blockedOf(s)
  const blockedTone = bandTone(blocked.pct, 20, 50)
  const { ctxPct, ctxTokens, ctxWindow, usd } = s.usage
  const quotaGauge = (kind: string, key: string, label: string) => {
    const rate = s.usage.rate.find(r => r.kind === kind)
    // Without a plan's limits there is nothing to show until a value exists.
    if (!rate) return null
    const pace = paceOf(kind, rate.resetsAt, s.now)
    const isAhead = isAheadOfPace(rate.pct, pace)
    const level = levelOf(rate.pct)
    return <Gauge key={key} label={label} pct={rate.pct} tone={isAhead && level === 'good' ? 'warn' : level} tick={pace} note={pace === undefined ? undefined : isAhead ? p.aheadOfPace : p.onPace} />
  }
  const usdTypical = typicalOf(s.learned.bench, s.session.id, r => r.totalUsd)
  const turnsTypical = typicalOf(s.learned.bench, s.session.id, r => r.turns)
  const usdRef = referenceOf(usdTypical, GUIDE.usd)
  const turnsRef = referenceOf(turnsTypical, GUIDE.turns)
  const usdTone = usdTypical === undefined ? '' : bandTone((usd / usdTypical) * 100, 100, 150)
  const turnsTone: Tone = turnsTypical !== undefined && s.turnCount > turnsTypical * 1.5 ? 'warn' : ''
  const tokensIn = tokens.mainIn + tokens.agentsIn
  const tokensOut = tokens.mainOut + tokens.agentsOut
  const tokensAll = tokensIn + tokensOut
  const inPct = tokensAll > 0 ? Math.round((tokensIn / tokensAll) * 100) : 0
  const parts = [
    <button key="ctx" type="button" className="cursor-pointer text-left hover:bg-surface-1" aria-expanded={isContextOpen} data-testid="context-gauge" onClick={() => setContextOpen(!isContextOpen)}><Gauge label={p.context} pct={ctxPct} tone={levelOf(ctxPct)} note={ctxTokens === undefined || ctxWindow === undefined ? undefined : fill(p.relOf, { a: kilo(ctxTokens), b: kilo(ctxWindow) })} /></button>,
    quotaGauge('five_hour', 'five', p.quota5h),
    quotaGauge('seven_day', 'seven', p.quota),
    <Gauge key="cache" label={p.cacheHit} pct={cache} tone={reversedLevel(cache)} note={cache === undefined ? undefined : p.ofInputTokens} />,
    s.usage.credits !== undefined ? <Stat key="cost" label={p.credits}><NumberFlow value={s.usage.credits} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /></Stat> : <Stat key="cost" label={p.cost} tone={usdTone} foot={referenceFoot(usd, usdRef, usdText(usdRef.value), usdTone, [{ to: 50, tone: 'good' }, { to: 75, tone: 'warn' }, { to: 100, tone: 'bad' }], p)}>
      <NumberFlow value={usd} locales="en-US" format={{ style: 'currency', currency: 'USD' }} />
      <Sparkline points={trend?.usd ?? []} label={p.cost} className="h-4 min-w-0 flex-1" />
    </Stat>,
    <Stat key="turns" label={p.turns} tone={turnsTone} foot={referenceFoot(s.turnCount, turnsRef, String(Math.round(turnsRef.value)), turnsTone, [{ to: 75, tone: '' }, { to: 100, tone: 'warn' }], p)}><NumberFlow value={s.turnCount} /></Stat>,
    <Stat key="blocked" label={p.blockedOnYou} tone={blockedTone} foot={<><Ruler pos={blocked.pct} tone={blockedTone} zones={[{ to: 20, tone: 'good' }, { to: 50, tone: 'warn' }, { to: 100, tone: 'bad' }]} /><Note text={fill(p.ofSessionTime, { pct: blocked.pct })} /></>}>{dur(blocked.ms)}</Stat>,
    <div key="tokens" className="flex min-w-0 flex-col justify-center gap-0.5 px-4 py-[18px]">
      <span className="kpi-label truncate">{p.tokens}</span>
      <ShareBar pct={inPct} />
      <span className="mt-1 flex justify-between gap-2 text-xs tabular-nums"><span className="text-ink-3">{p.tokensIn}</span><span className="text-heading">{kilo(tokensIn)}</span><span className="text-ink-3">{inPct}%</span></span>
      <span className="flex justify-between gap-2 text-xs tabular-nums"><span className="text-ink-3">{p.tokensOut}</span><span className="text-heading">{kilo(tokensOut)}</span><span className="text-ink-3">{tokensAll > 0 ? 100 - inPct : 0}%</span></span>
    </div>,
  ].filter(Boolean)
  const fills = [...(s.insights.breakdown ?? []), ...(s.insights.mcpTokens ? [{ name: p.mcpTools, tokens: s.insights.mcpTokens }] : []), ...(s.insights.memoryTokens ? [{ name: p.memoryFiles, tokens: s.insights.memoryTokens }] : [])]
  return (
    <section id="instruments" className="kpi-band grid grid-cols-2 min-[480px]:grid-cols-3 xl:[grid-template-columns:repeat(var(--tiles),minmax(0,1fr))] [&>*]:border-line xl:[&>*:not(:first-child)]:border-l" style={{ '--tiles': parts.length } as CSSProperties} data-testid="instruments" data-down={isDown || undefined} aria-label={p.context}>
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
              <ul className="mt-1 flex flex-col gap-0.5">{s.insights.big.slice(0, 5).map(c => <li key={`${c.at}:${c.what}`} className="flex justify-between gap-3"><span className="min-w-0 truncate font-mono" title={c.what}>{c.tool} {callText(c)}</span><span className="font-mono text-ink-2 tabular-nums">{kilo(c.tokens)}</span></li>)}</ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
