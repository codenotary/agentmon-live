import NumberFlow from '@number-flow/react'

import type { Tone } from '../format.ts'
import { toneVar } from './Pill.tsx'

// Three quarters of a circle, opening downward.
const ARC = 75

export function Gauge({ label, pct, tone }: { label: string; pct: number | undefined; tone: Tone }) {
  const filled = ((pct ?? 0) / 100) * ARC
  return (
    <div className="flex items-center gap-3 p-3" role="img" aria-label={`${label}: ${pct === undefined ? '—' : `${pct}%`}`}>
      <div className="relative size-16 flex-none">
        <svg viewBox="0 0 64 64" className="size-full rotate-[135deg]" aria-hidden>
          <circle cx="32" cy="32" r="27" fill="none" stroke="var(--surface-3)" strokeWidth="5" strokeLinecap="round" pathLength={100} strokeDasharray={`${ARC} 100`} />
          <circle cx="32" cy="32" r="27" fill="none" stroke={toneVar(tone)} strokeWidth="5" strokeLinecap="round" pathLength={100} strokeDasharray={`${filled} 100`} style={{ transition: 'stroke-dasharray .6s cubic-bezier(.2,.8,.2,1), stroke .3s', filter: tone === 'bad' ? 'drop-shadow(0 0 4px var(--bad))' : undefined }} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display text-[15px] font-bold tabular-nums">
          {pct === undefined ? '—' : <NumberFlow value={pct} suffix="%" />}
        </span>
      </div>
      <span className="eyebrow min-w-0">{label}</span>
    </div>
  )
}
