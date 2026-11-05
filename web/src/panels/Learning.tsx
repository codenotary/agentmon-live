import { History } from 'lucide-react'

import type { WebSnapshot } from '../../../types/index'
import type { Page } from '../labels.ts'
import { Panel } from '../ui/Panel.tsx'
import { Sparkline } from '../ui/Sparkline.tsx'

export function Learning({ s, p }: { s: WebSnapshot; p: Page }) {
  const { sessions, bench } = s.learned
  if (sessions === 0 && bench.length === 0) return null
  const costs = bench.flatMap(b => (b.usd === undefined ? [] : [b.usd]))
  const heads = [p.when, p.turns, p.calls, p.errors, p.cost]
  return (
    <Panel id="learning" title={p.learning} icon={History} aside={<span className="text-xs text-ink-3">{p.sessions}: {sessions}</span>}>
      {costs.length > 1 ? <Sparkline points={costs} label={p.cost} className="mb-2 h-8 w-full" /> : null}
      {bench.length === 0 ? null : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead><tr>{heads.map(h => <th key={h} className="eyebrow px-2.5 py-2 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {[...bench].reverse().map(b => (
                <tr key={b.id} className="border-t border-line-soft">
                  <td className="px-2.5 py-1.5 whitespace-nowrap text-ink-3">{new Date(b.at).toLocaleDateString()}</td>
                  <td className="px-2.5 py-1.5">{b.turns}</td>
                  <td className="px-2.5 py-1.5">{b.calls}</td>
                  <td className={`px-2.5 py-1.5 ${b.errors ? 'text-bad' : ''}`}>{b.errors}</td>
                  <td className="px-2.5 py-1.5">{b.usd === undefined ? '–' : `$${b.usd.toFixed(2)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
