import { ScrollText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { WebSnapshot } from '../../../types/index'
import { time, tone } from '../format.ts'
import type { Page } from '../labels.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { toneVar } from '../ui/Pill.tsx'

const END_SLACK_PX = 24

function Marked({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const at = text.toLowerCase().indexOf(q)
  if (at < 0) return <>{text}</>
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + q.length)}</mark><Marked text={text.slice(at + q.length)} q={q} /></>
}

export function Log({ s, p }: { s: WebSnapshot; p: Page }) {
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const q = query.toLowerCase()
  const rows = s.log.filter(x => !q || `${x.who} ${x.what} ${x.result}`.toLowerCase().includes(q))

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [follow, rows.at(-1)?.at])

  const aside = (
    <>
      <input id="q" className="field !h-[26px] !w-48" type="search" aria-label={p.search} placeholder={`${p.search}  /`} value={query} onChange={e => setQuery(e.target.value)} />
      <button type="button" className="chip" aria-pressed={follow} onClick={() => setFollow(!follow)}>{p.follow}</button>
    </>
  )
  return (
    <Panel id="log" title={p.log} help={p.helpLog} icon={ScrollText} aside={aside}>
      {rows.length === 0 ? <Empty text={q ? p.noMatch : p.none} /> : (
        <div
          ref={box}
          className="log flex max-h-[360px] flex-col gap-0.5 overflow-auto font-mono text-xs"
          onScroll={e => {
            const el = e.currentTarget
            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < END_SLACK_PX
            if (atEnd !== follow) setFollow(atEnd)
          }}
        >
          {rows.map(x => (
            <div key={`${x.at}:${x.who}:${x.what}`} className="row-in grid grid-cols-[76px_minmax(0,1fr)] gap-x-2.5 rounded px-1 py-0.5 sm:grid-cols-[84px_110px_minmax(0,1fr)_auto]">
              <span className="whitespace-nowrap text-ink-3">{time(x.at)}</span>
              <span className="truncate text-signal"><Marked text={x.who} q={q} /></span>
              <span className="max-sm:col-start-2 [overflow-wrap:anywhere]"><Marked text={x.what} q={q} /></span>
              <span className="max-sm:col-start-2" style={{ color: toneVar(tone(x.result)) }}><Marked text={x.result} q={q} /></span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
