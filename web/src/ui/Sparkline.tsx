import { useId } from 'react'

// Needs two points to say anything; with fewer it keeps its height so the layout does not jump.
export function Sparkline({ points, label, className = 'h-7 w-full' }: { points: readonly number[]; label: string; className?: string }) {
  const id = useId()
  if (points.length < 2) return <div className={className} />
  const low = Math.min(...points)
  const high = Math.max(...points)
  const span = high - low || 1
  const coords = points.map((v, i) => `${(i / (points.length - 1)) * 100},${28 - ((v - low) / span) * 25}`)
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--signal-bright)" stopOpacity=".32" />
          <stop offset="1" stopColor="var(--signal-bright)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${coords.join(' ')} 100,30`} fill={`url(#${id})`} />
      <polyline points={coords.join(' ')} fill="none" stroke="var(--signal-bright)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
