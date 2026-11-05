import { Bot, FileText, History, LayoutDashboard, ScrollText, ShieldCheck, Terminal, type LucideIcon } from 'lucide-react'

import type { WebSnapshot } from '../../types/index'
import type { FeedEvent } from './events.ts'
import type { Page } from './labels.ts'

export type Section = { id: string; label: string; icon: LucideIcon; count?: number; isAlert?: boolean }

// The page's views, in rail order. The palette goes to the same list.
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

export function Nav({ sections, view, label }: { sections: Section[]; view: string; label: string }) {
  return (
    <nav className="side-nav" aria-label={label} data-testid="nav">
      {sections.map(({ id, label: name, icon: Icon, count, isAlert }) => (
        <a key={id} href={`#/${id}`} className="nav-item" aria-current={view === id ? 'page' : undefined}>
          <Icon size={14} className="flex-none" aria-hidden />
          <span className="truncate">{name}</span>
          {count ? <span className={`nav-count ${isAlert ? 'alert' : ''}`}>{count}</span> : null}
        </a>
      ))}
    </nav>
  )
}
