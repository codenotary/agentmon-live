import { useEffect } from 'react'
import { flushSync } from 'react-dom'

import type { WebSnapshot } from '../../types/index'

import { CallDetail } from './CallDetail.tsx'
import type { FeedEvent } from './events.ts'
import { titleFor } from './format.ts'
import { labelsOf, pageOf, type Labels, type Page } from './labels.ts'
import { Nav, sectionsOf } from './Nav.tsx'
import { Palette } from './Palette.tsx'
import { Calls } from './panels/Calls.tsx'
import { Events } from './panels/Events.tsx'
import { Instruments } from './panels/Instruments.tsx'
import { Learning } from './panels/Learning.tsx'
import { Log } from './panels/Log.tsx'
import { Agents, Checks, Files, Insights, Running, Tasks } from './panels/Side.tsx'
import { TurnClock } from './panels/TurnClock.tsx'
import { Waterfall } from './panels/Waterfall.tsx'
import { currentOf, goTo, set, useStore, type Trend } from './store.ts'
import { TopBar } from './TopBar.tsx'

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

function Standby({ text }: { text: string }) {
  return (
    <div className="panel relative mt-[12vh] overflow-hidden px-6 py-14 text-center">
      <div className="absolute top-1/2 right-0 left-0 h-px bg-line" />
      <div className="flat-sweep now-line !right-auto" />
      <p className="relative inline-block bg-surface px-4 text-ink-2">{text}</p>
    </div>
  )
}

// shortcut: a view's own state (log search, picked turn) resets on leaving it, move it to the store if people miss it.
function View({ view, s, l, p, events, trend }: { view: string; s: WebSnapshot; l: Labels; p: Page; events: FeedEvent[]; trend: Trend | undefined }) {
  switch (view) {
    case 'calls':
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <TurnClock s={s} l={l} />
            <Calls s={s} l={l} />
          </div>
          <Insights s={s} p={p} />
        </div>
      )
    case 'verification':
      return (
        <div className="grid items-start gap-4 grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))]">
          <Checks s={s} l={l} />
          <Tasks s={s} l={l} />
        </div>
      )
    case 'agents':
      return <Agents s={s} l={l} />
    case 'files':
      return <Files s={s} p={p} />
    case 'log':
      return <Log s={s} p={p} />
    case 'learning':
      return <Learning s={s} p={p} />
    default:
      return (
        <>
          <Instruments s={s} p={p} trend={trend} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
            <div className="min-w-0"><Waterfall s={s} l={l} /></div>
            <div className="flex min-w-0 flex-col gap-4 max-xl:order-first">
              <Events list={events} p={p} />
              <Running s={s} p={p} />
            </div>
          </div>
        </>
      )
  }
}

export function App() {
  const st = useStore()
  const s = currentOf(st)
  const p = pageOf(s)
  const isCurrent = s?.v === 1
  const l = s && isCurrent ? labelsOf(s) : undefined
  const events = s ? (st.events.get(s.session.id) ?? []) : []
  const sections = s && l ? sectionsOf(s, p, events) : []
  // A link to a view this session lacks, such as Learning with no past sessions, shows the overview.
  const view = sections.some(x => x.id === st.view) ? st.view : 'overview'

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  useEffect(() => {
    if (st.theme === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = st.theme
  }, [st.theme])

  useEffect(() => {
    document.documentElement.lang = s?.lang ?? 'en'
    document.title = isCurrent && s ? titleFor(s.focus) : 'AgentMon Live'
  }, [s, isCurrent])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        set({ isPaletteOpen: true })
      } else if (!isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === '/') {
          e.preventDefault()
          flushSync(() => goTo('log'))
          document.getElementById('q')?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <TopBar s={s} p={p} />
      <div className="mx-auto flex max-w-[1720px] flex-col lg:flex-row">
      {sections.length ? <Nav sections={sections} view={view} label={p.jumpTo} /> : null}
      <main className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-10 sm:px-6 lg:pl-4">
        {st.isDown ? <div className="panel !border-bad bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad" role="status">{p.disconnected}</div> : null}
        {s && !isCurrent ? <div className="panel !border-warn bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn" role="status">{p.update}</div> : null}
        {!s && !st.isDown ? <Standby text={p.noSessions} /> : null}
        {s && l ? <View view={view} s={s} l={l} p={p} events={events} trend={st.trends.get(s.session.id)} /> : null}
      </main>
      </div>
      <Palette s={s} p={p} sections={sections} />
      <CallDetail l={l} />
    </>
  )
}
