import { Bot, FileText, History, LayoutDashboard, ScrollText, ShieldCheck, Terminal, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { WebSnapshot } from '../../types/index'
import type { FeedEvent } from './events.ts'
import type { Page } from './labels.ts'

export type Section = { id: string; label: string; icon: LucideIcon; count?: number; isAlert?: boolean }

// The page's sections: the rail and the page both follow this order. The palette goes to the same list.
export function sectionsOf(s: WebSnapshot, p: Page, events: readonly FeedEvent[]): Section[] {
  const open = events.filter(e => e.clearedAt === undefined)
  const all: (Section | false)[] = [
    { id: 'overview', label: p.overview, icon: LayoutDashboard, count: open.length, isAlert: open.some(e => e.isUrgent) },
    { id: 'calls', label: p.toolCalls, icon: Terminal, count: s.active.length },
    { id: 'verification', label: p.verification, icon: ShieldCheck },
    { id: 'agents', label: p.subagents, icon: Bot, count: s.agents.length },
    { id: 'files', label: p.files, icon: FileText },
    { id: 'log', label: p.log, icon: ScrollText },
    (s.learned.sessions > 0 || s.learned.bench.length > 0) && { id: 'learning', label: p.learning, icon: History },
  ]
  return all.filter(x => x !== false)
}

const domId = (id: string) => `section-${id}`

export function jumpTo(id: string): void {
  location.hash = domId(id)
  document.getElementById(domId(id))?.scrollIntoView()
}

// The section under a band just below the header is the one you are reading.
function useActive(ids: string): string {
  const [active, setActive] = useState('')
  useEffect(() => {
    const list = ids.split(' ')
    const seen = new Set<string>()
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) seen.add(e.target.id)
        else seen.delete(e.target.id)
      }
      const first = list.find(id => seen.has(domId(id)))
      if (first) setActive(first)
    }, { rootMargin: '-69px 0px -75% 0px' })
    for (const id of list) {
      const el = document.getElementById(domId(id))
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [ids])
  return active
}

export function Nav({ sections, label }: { sections: Section[]; label: string }) {
  const active = useActive(sections.map(x => x.id).join(' '))
  const nav = useRef<HTMLElement>(null)
  // On a phone the strip scrolls sideways: keep the marked item in it.
  useEffect(() => {
    const item = nav.current?.querySelector<HTMLElement>('[aria-current]')
    if (item) nav.current?.scrollTo({ left: item.offsetLeft - 16 })
  }, [active])
  return (
    <nav ref={nav} className="side-nav" aria-label={label} data-testid="nav">
      {sections.map(({ id, label: name, icon: Icon, count, isAlert }) => (
        <a key={id} href={`#${domId(id)}`} className="nav-item" aria-current={active === id ? 'location' : undefined}>
          <Icon size={14} className="flex-none" aria-hidden />
          <span className="truncate">{name}</span>
          {count ? <span className={`nav-count ${isAlert ? 'alert' : ''}`}>{count}</span> : null}
        </a>
      ))}
    </nav>
  )
}
