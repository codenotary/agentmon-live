import NumberFlow from '@number-flow/react'

import type { Tone } from '../format.ts'
import { toneVar } from './Pill.tsx'

// Three quarters of a circle, opening downward.
const ARC = 75
const angleOf = (pct: number) => (Math.max(0, Math.min(100, pct)) / 100) * 270 - 135

export function Gauge({ label, pct, tone, note, tick }: { label: string; pct: number | undefined; tone: Tone; note?: string; tick?: number }) {
  const filled = ((pct ?? 0) / 100) * ARC
  return (
    <div className="flex items-center gap-2 px-3 py-[18px]" role="img" aria-label={`${label}: ${pct === undefined ? '—' : `${pct}%`}${note ? `, ${note}` : ''}`}>
      <div className="relative size-16 flex-none">
        <svg viewBox="0 0 64 64" className="size-full" aria-hidden>
          <g transform="rotate(135 32 32)">
            <circle cx="32" cy="32" r="27" fill="none" stroke="var(--surface-3)" strokeWidth="5" strokeLinecap="round" pathLength={100} strokeDasharray={`${ARC} 100`} />
            <circle cx="32" cy="32" r="27" fill="none" stroke={toneVar(tone)} strokeWidth="5" strokeLinecap="round" pathLength={100} strokeDasharray={`${filled} 100`} style={{ transition: 'stroke-dasharray .6s cubic-bezier(.2,.8,.2,1), stroke .3s', filter: tone === 'bad' ? 'drop-shadow(0 0 4px var(--bad))' : undefined }} />
          </g>
          {tick === undefined ? null : <line x1="32" x2="32" y1="1" y2="9" stroke="var(--ink-2)" strokeWidth="1.5" transform={`rotate(${angleOf(tick)} 32 32)`} data-testid="pace-tick" />}
          {pct === undefined ? null : (
            <g className="pin" style={{ transform: `rotate(${angleOf(pct)}deg)` }}>
              <g className="pin-wobble"><polygon points="32,0 29,13 35,13" fill="var(--heading)" stroke="var(--surface)" strokeWidth="1" strokeLinejoin="round" /></g>
            </g>
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display text-[14px] font-bold tabular-nums">
          {pct === undefined ? '—' : <NumberFlow value={pct} suffix="%" />}
        </span>
      </div>
      <span className="min-w-0">
        <span className="kpi-label block">{label}</span>
        {note ? <span className="block text-xs text-ink-3 tabular-nums">{note}</span> : null}
      </span>
    </div>
  )
}
