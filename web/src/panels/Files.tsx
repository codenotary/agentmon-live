import { CheckCircle2, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { fileGroups, type FileRow } from '../files.ts'
import { countWord, dur, pathIn, type Tone } from '../format.ts'
import { fill } from '../kpi.ts'
import type { Page } from '../labels.ts'
import { useClock } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { Pill, toneVar } from '../ui/Pill.tsx'
import { ShowAll } from '../ui/ShowAll.tsx'

const READ_ROWS_FOLDED = 2
// A busy session edits hundreds of files: the latest ones lead, the rest wait behind a button.
const EDITED_ROWS_FOLDED = 10

function Heading({ text, count, tone = '' }: { text: string; count: number; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="eyebrow" style={tone ? { color: toneVar(tone) } : undefined}>{text}</span>
      <span className="text-xs text-ink-3 tabular-nums">{count}</span>
    </div>
  )
}

function EditedRows({ rows, tone, now, p, cwd }: { rows: readonly FileRow[]; tone: Tone; now: number; p: Page; cwd: string | undefined }) {
  const [isAll, setAll] = useState(false)
  return (
    <>
    <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
      {(isAll ? rows : rows.slice(0, EDITED_ROWS_FOLDED)).map(r => (
        <li key={r.path} className="flex min-w-0 items-center gap-2" title={r.path}>
          {tone === 'good' ? <CheckCircle2 size={12} className="flex-none text-good" aria-hidden /> : <i className="ml-0.5 size-2 flex-none rounded-full" style={{ background: toneVar(tone) }} aria-hidden />}
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{pathIn(r.path, cwd)}</span>
          {r.isNew ? <Pill text={p.newFile} /> : null}
          {r.edits === undefined ? null : <span className="flex-none text-ink-2 tabular-nums">×{r.edits}</span>}
          {r.at === undefined ? null : <span className="flex-none text-right whitespace-nowrap text-ink-3 tabular-nums">{fill(p.agoText, { t: dur(now - r.at) })}</span>}
        </li>
      ))}
    </ul>
    {rows.length > EDITED_ROWS_FOLDED ? <ShowAll isAll={isAll} count={rows.length} onToggle={() => setAll(!isAll)} p={p} /> : null}
    </>
  )
}

export function Files({ s, p }: { s: WebSnapshot; p: Page }) {
  const now = useClock(s)
  const [isReadOpen, setReadOpen] = useState(false)
  const isEmpty = s.files.edited.length === 0 && s.files.read.length === 0
  const g = useMemo(() => fileGroups(s), [s])
  const heading = g.state === 'green' ? p.notTestedSinceGreen : g.state === 'failed' ? p.lastTestFailed : p.noPassingTest
  const readRows = isReadOpen ? g.readOnly : g.readOnly.slice(0, READ_ROWS_FOLDED)
  const aside = <span className="text-xs text-ink-3 tabular-nums">{fill(p.filesSummary, { e: s.files.edited.length, r: g.readOnly.length })}</span>
  return (
    <Panel id="files" title={p.files} help={p.helpFiles} icon={FileText} aside={isEmpty ? undefined : aside}>
      {isEmpty ? <Empty text={`${p.noFilesEdited} · ${countWord(s.trace?.length ?? 0, p)}`} /> : (
        <div className="flex flex-col gap-4">
          {g.toCheck.length ? <div data-testid="files-check"><Heading text={heading} count={g.toCheck.length} tone={g.tone} /><EditedRows rows={g.toCheck} tone={g.tone} now={now} p={p} cwd={s.session.cwd} /></div> : null}
          {g.beforeGreen.length ? <div data-testid="files-green"><Heading text={fill(p.beforeLastGreen, { t: dur(now - (g.greenAt ?? now)) })} count={g.beforeGreen.length} tone="good" /><EditedRows rows={g.beforeGreen} tone="good" now={now} p={p} cwd={s.session.cwd} /></div> : null}
          {g.readOnly.length ? (
            <div data-testid="files-read">
              <Heading text={p.onlyRead} count={g.readOnly.length} />
              <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
                {readRows.map(r => (
                  <li key={r.path} className="flex min-w-0 items-center gap-2" title={r.path}>
                    <span className="min-w-0 flex-1 text-ink-2 [overflow-wrap:anywhere]">{pathIn(r.path, s.session.cwd)}</span>
                    {r.isOften ? <span className="flex-none font-sans text-warn">{p.rereadOften}</span> : null}
                    {r.reads === undefined ? null : <span className="flex-none text-ink-2 tabular-nums">×{r.reads}</span>}
                  </li>
                ))}
              </ul>
              {g.readOnly.length > READ_ROWS_FOLDED ? <ShowAll isAll={isReadOpen} onToggle={() => setReadOpen(!isReadOpen)} p={p} /> : null}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  )
}
