import { ChevronRight } from 'lucide-react'
import { Component, memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

import type { WebSnapshot } from '../../types/index'

import { CallDetail } from './CallDetail.tsx'
import type { FeedEvent } from './events.ts'
import { nextRow, SECTION_KEYS, titleFor } from './format.ts'
import { labelsOf, lastKnown, pageOf, type Labels, type Page } from './labels.ts'
import { jumpTo, Nav, sectionsOf, type Section } from './Nav.tsx'
import { Palette } from './Palette.tsx'
import { Calls } from './panels/Calls.tsx'
import { Events } from './panels/Events.tsx'
import { Instruments } from './panels/Instruments.tsx'
import { Log } from './panels/Log.tsx'
import { Agents } from './panels/Agents.tsx'
import { Flow } from './panels/Flow.tsx'
import { Files } from './panels/Files.tsx'
import { Checks, Insights, Running, Tasks } from './panels/Side.tsx'
import { TurnClock } from './panels/TurnClock.tsx'
import { Waterfall } from './panels/Waterfall.tsx'
import { currentOf, dismiss, getState, hasNoSignal, set, setCollapsed, useStore, type Trend } from './store.ts'
import { LastUpdate, TopBar } from './TopBar.tsx'

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

// One panel that throws (a snapshot of another version, say) must not blank the page. The next snapshot gets a new try.
class PartGuard extends Component<{ s: WebSnapshot; text: string; children: ReactNode }, { isFailed: boolean }> {
  state = { isFailed: false }
  static getDerivedStateFromError() {
    return { isFailed: true }
  }
  componentDidUpdate(before: { s: WebSnapshot }) {
    if (this.state.isFailed && before.s !== this.props.s) this.setState({ isFailed: false })
  }
  render() {
    return this.state.isFailed ? <div className="panel !border-warn bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn" role="status" data-testid="panel-failed">{this.props.text}</div> : this.props.children
  }
}

const NO_EVENTS: FeedEvent[] = []

// Skips the redraw when the store changed in a part no panel here reads through its props (a drag on the flow chart sets the store at pointer rate).
const Part = memo(function Part({ view, s, l, p, events, trend }: { view: string; s: WebSnapshot; l: Labels; p: Page; events: FeedEvent[]; trend: Trend | undefined }) {
  switch (view) {
    case 'calls':
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
          <div className="min-w-0"><Calls s={s} l={l} /></div>
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
      return <Log s={s} l={l} />
    default:
      return (
        <>
          <Instruments s={s} p={p} trend={trend} />
          <Flow s={s} l={l} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
            <div className="flex min-w-0 flex-col gap-4"><Waterfall s={s} l={l} /><TurnClock s={s} l={l} /></div>
            <div className="flex min-w-0 flex-col gap-4 max-xl:order-first">
              <Events list={events} p={p} />
              <Running s={s} p={p} />
            </div>
          </div>
        </>
      )
  }
})

// A heading that folds what a rail item leads to. Folded stays mounted: a typed filter or a chosen sort is still there on opening. The count stays in sight, so a folded section can still say it needs you.
function PageSection({ x, isCollapsed, children }: { x: Section; isCollapsed: boolean; children: ReactNode }) {
  const { id, label, icon: Icon, count, alert } = x
  return (
    <div id={`section-${id}`} className="section">
      <h2>
        <button type="button" className="section-head" aria-expanded={!isCollapsed} onClick={() => setCollapsed(id, !isCollapsed)}>
          <ChevronRight size={14} className={`chevron ${isCollapsed ? '' : 'open'}`} aria-hidden />
          <Icon size={14} aria-hidden />
          {label}
          {count ? <span className={`nav-count !ml-0 ${alert ?? ''}`}>{count}</span> : null}
        </button>
      </h2>
      <div className={isCollapsed ? 'hidden' : 'flex min-w-0 flex-col gap-4'}>{children}</div>
    </div>
  )
}

export function App() {
  const st = useStore()
  const s = currentOf(st)
  const isStopped = s !== undefined && hasNoSignal(st, s.session.id)
  const isCurrent = s?.v === 1
  // Stable between snapshots, so `Part` can skip.
  const l = useMemo(() => {
    const known = s && isCurrent ? labelsOf(s) : undefined
    return known && isStopped ? lastKnown(known) : known
  }, [s, isCurrent, isStopped])
  const p = useMemo(() => l?.page ?? pageOf(s), [l, s])
  const events = (s && st.events.get(s.session.id)) || NO_EVENTS
  const sections = s && l ? sectionsOf(s, p, events) : []
  const isFirstDraw = useRef(true)
  const wasG = useRef(false)

  // The first draw comes after the page loaded, too late for the browser to follow a link's hash.
  useEffect(() => {
    if (sections.length === 0 || !isFirstDraw.current) return
    isFirstDraw.current = false
    if (location.hash) {
      setCollapsed(location.hash.replace('#section-', ''), false)
      document.getElementById(location.hash.slice(1))?.scrollIntoView()
    }
  }, [sections.length])

  useEffect(() => {
    if (st.theme === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = st.theme
  }, [st.theme])

  const isQuiet = st.isDown || st.silent.size > 0
  useEffect(() => {
    document.documentElement.lang = s?.lang ?? 'en'
    // A tab left in the background must not read as all well.
    document.title = `${isQuiet ? '⚠ ' : ''}${isCurrent && s ? titleFor(s.focus) : 'AgentMon Live'}`
  }, [s, isCurrent, isQuiet])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        set({ isPaletteOpen: true })
      // An open drawer or palette has the keys: nothing moves behind it.
      } else if (!isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && !getState().call && !getState().isPaletteOpen) {
        if (wasG.current) {
          wasG.current = false
          const section = SECTION_KEYS[e.key]
          if (section) jumpTo(section)
        } else if (e.key === 'g') {
          wasG.current = true
        } else if (e.key === 'j' || e.key === 'k') {
          e.preventDefault()
          const rows = [...document.querySelectorAll<HTMLElement>('main tr[tabindex]')].filter(el => el.offsetParent !== null)
          rows[nextRow(rows.indexOf(document.activeElement as HTMLElement), rows.length, e.key === 'j' ? 1 : -1)]?.focus()
        } else if (e.key === '/') {
          e.preventDefault()
          // Drawn at once: a hidden field takes no focus.
          flushSync(() => setCollapsed('log', false))
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
      <div className="flex flex-col lg:flex-row">
      {sections.length ? <Nav sections={sections} label={p.jumpTo} /> : null}
      <main className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-[26px] pb-10 sm:px-8" data-no-signal={isStopped || undefined}>
        {st.isDown ? <div className="panel !border-bad bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad" role="status">{p.disconnected}{s ? <> <LastUpdate s={s} p={p} className="lg:hidden" /></> : null}</div> : null}
        {s && !st.isDown && isStopped ? <div className="panel flex flex-wrap items-center gap-x-3 gap-y-1 !border-warn bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn" role="status" data-testid="silent-banner">{p.sessionSilent} <LastUpdate s={s} p={p} className="lg:hidden" /><button type="button" className="ml-auto underline" data-testid="dismiss" onClick={() => dismiss(s.session.id)}>{p.dismiss}</button></div> : null}
        {s && !isCurrent ? <div className="panel !border-warn bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn" role="status">{p.update}</div> : null}
        {!s && !st.isDown ? <Standby text={p.noSessions} /> : null}
        {s && l ? <div key={s.session.id} className="fade-in flex min-w-0 flex-col gap-4">{sections.map(x => <PageSection key={x.id} x={x} isCollapsed={st.collapsed.has(x.id)}><PartGuard s={s} text={p.update}><Part view={x.id} s={s} l={l} p={p} events={events} trend={st.trends.get(s.session.id)} /></PartGuard></PageSection>)}</div> : null}
      </main>
      </div>
      <Palette s={s} p={p} sections={sections} />
      <CallDetail l={l} s={s} />
      {st.notice ? <div className={`notice ${st.notice.isBad ? 'bad' : ''}`} role="status" data-testid="notice">{st.notice.text}</div> : null}
    </>
  )
}
