import type { Tone } from '../format.ts'

const COLOURS: Record<Tone, string> = {
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  '': 'bg-surface-2 text-ink-2',
}

export const Pill = ({ text, tone = '' }: { text: string; tone?: Tone }) => <span className={`inline-block flex-none rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${COLOURS[tone]}`}>{text}</span>

export const toneVar = (tone: Tone) => (tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--ink-3)')
