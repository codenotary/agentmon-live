import { ListOrdered } from 'lucide-react'
import { useState } from 'react'

import type { StepState, WebSnapshot } from '../../../types/index'
import { callTime, dur } from '../format.ts'
import type { Page } from '../labels.ts'
import { useClock } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { ShowAll } from '../ui/ShowAll.tsx'
import { openTrace } from './Waterfall.tsx'

const ROWS_FOLDED = 20
const GLYPH: Record<StepState, string> = { running: '●', asking: '⏸', ok: '✓', failed: '✗', blocked: '⊘' }
const TONE: Record<StepState, string> = { running: 'text-signal-bright', asking: 'text-warn', ok: 'text-ink-3', failed: 'text-bad', blocked: 'text-bad' }
const ROW = 'grid w-full grid-cols-[1rem_4.5rem_minmax(0,1fr)_auto] items-baseline gap-2 rounded px-1 py-0.5 text-left'

// The turn step by step as the session built it, newest first; a running row is timed here, from its start.
export function Steps({ s, p }: { s: WebSnapshot; p: Page }) {
  const now = useClock(s)
  const [isAll, setAll] = useState(false)
  const rows = s.steps ?? []
  return (
    <Panel id="steps" title={p.steps} help={p.helpSteps} icon={ListOrdered}>
      {rows.length === 0 ? <Empty text={p.none} /> : null}
      <ol className="flex flex-col text-[13px]" data-testid="steps">
        {(isAll ? rows : rows.slice(0, ROWS_FOLDED)).map(r => {
          const call = r.kind === 'call' ? s.trace?.find(c => c.id === r.id) : undefined
          const cells = (
            <>
              <span className={`font-mono ${TONE[r.state]} ${r.state === 'running' ? 'rec' : ''}`} aria-hidden>{GLYPH[r.state]}</span>
              <span className="truncate text-ink-3">{r.actor}</span>
              <span className={`min-w-0 truncate ${r.state === 'failed' || r.state === 'blocked' ? 'text-bad' : ''}`} title={r.what ?? r.label}>{r.label}</span>
              <span className="font-mono text-xs whitespace-nowrap text-ink-3 tabular-nums">{r.count > 1 ? `×${r.count} ` : ''}{r.state === 'running' || r.state === 'asking' ? dur(now - r.at) : callTime(r.ms)}</span>
            </>
          )
          return <li key={`${r.kind}:${r.id}`} className="row-in">{call ? <button type="button" className={`${ROW} cursor-pointer hover:bg-surface-2`} aria-label={`${p.details}: ${r.label}`} onClick={() => openTrace(call)}>{cells}</button> : <div className={ROW}>{cells}</div>}</li>
        })}
      </ol>
      {s.isStepsCut && rows.length > 0 && (isAll || rows.length <= ROWS_FOLDED) ? <p className="px-1 pt-1 text-xs text-ink-3" data-testid="steps-cut">… {p.stepsCut}</p> : null}
      {rows.length > ROWS_FOLDED ? <ShowAll isAll={isAll} count={rows.length} onToggle={() => setAll(!isAll)} p={p} /> : null}
    </Panel>
  )
}
