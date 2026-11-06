import type { Tone } from '../format.ts'
import { toneVar } from './Pill.tsx'

const clamp = (pct: number) => Math.max(0, Math.min(100, pct))

// `zones` run left to right, each up to its `to` percent of the track. The text beside the ruler holds the exact value, so screen readers skip it.
export function Ruler({ pos, tone, tick, zones }: { pos: number; tone: Tone; tick?: number; zones: readonly { to: number; tone: Tone }[] }) {
  const stops = zones.map((z, i) => `${toneVar(z.tone)} ${zones[i - 1]?.to ?? 0}% ${z.to}%`)
  return (
    <div className="relative mt-1 h-3" aria-hidden data-testid="ruler">
      <div className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-40" style={{ background: `linear-gradient(90deg, ${stops.join(', ')})` }} />
      {tick === undefined ? null : <i className="absolute bottom-0 h-2.5 w-px bg-ink-2" style={{ left: `${clamp(tick)}%` }} />}
      <span className="ruler-pin absolute top-0 -ml-1" style={{ left: `${clamp(pos)}%` }}>
        <svg className="ruler-wobble block" width="8" height="8" viewBox="0 0 8 8"><polygon points="4,8 0,0 8,0" fill={tone ? toneVar(tone) : 'var(--heading)'} /></svg>
      </span>
    </div>
  )
}

export function ShareBar({ pct }: { pct: number }) {
  return (
    <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <i className="h-full bg-ink-3" style={{ width: `${clamp(pct)}%` }} />
    </div>
  )
}
