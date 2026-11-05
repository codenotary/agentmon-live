import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, Command, Monitor, Moon, PanelRightClose, PanelRightOpen, Sun, X } from 'lucide-react'

import type { WebSnapshot } from '../../types/index'
import { sessionNames, stateOf } from './format.ts'
import { labelsOf, type Page } from './labels.ts'
import { pick, requestPane, set, setTheme, useStore, type Theme } from './store.ts'

const NEXT: Record<Theme, Theme> = { auto: 'dark', dark: 'light', light: 'auto' }

const whereOf = (s: WebSnapshot) => `${s.session.cwd}${s.session.branch ? ` · ${s.session.branch}` : ''}`

const stateWord = (x: WebSnapshot, p: Page) => ({ waiting: labelsOf(x).status.waiting ?? 'waiting', active: p.live, idle: p.idle })[stateOf(x)]

function StateDot({ s, p }: { s: WebSnapshot; p: Page }) {
  // An older version's snapshot may lack what this reads.
  return s.v === 1 ? <i className={`state-dot ${stateOf(s)}`} title={stateWord(s, p)} aria-hidden /> : null
}

// What sets a session apart in the list, besides its folder.
function detailOf(x: WebSnapshot, p: Page): string {
  if (x.v !== 1) return ''
  const urgent = x.focus.filter(f => f.isUrgent).length
  return [stateWord(x, p), x.main.model, urgent ? `${p.events}: ${urgent}` : '', x.build ?? ''].filter(Boolean).join(' · ')
}

// With several sessions the working directory is the switch between them.
function SessionPicker({ s, p, sessions }: { s: WebSnapshot; p: Page; sessions: ReadonlyMap<string, WebSnapshot> }) {
  const names = sessionNames(sessions)
  return (
    <Select.Root value={s.session.id} onValueChange={pick}>
      <Select.Trigger className="select-trigger" id="picker" aria-label={`${whereOf(s)}, ${s.v === 1 ? stateWord(s, p) : ''}`} title={whereOf(s)}>
        <StateDot s={s} p={p} />
        <span className="min-w-0 flex-1 truncate text-left"><Select.Value>{whereOf(s)}</Select.Value></span>
        <Select.Icon><ChevronDown size={14} className="flex-none text-ink-3" aria-hidden /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-menu" position="popper" sideOffset={4}>
          <Select.Viewport>
            {[...sessions].map(([id, x]) => (
              <Select.Item key={id} value={id} className="select-item" title={whereOf(x)}>
                <Select.ItemIndicator className="select-check"><Check size={14} aria-hidden /></Select.ItemIndicator>
                <StateDot s={x} p={p} />
                <Select.ItemText>{names.get(id)}</Select.ItemText>
                <span className="select-detail">{detailOf(x, p)}</span>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

export function TopBar({ s, p }: { s: WebSnapshot | undefined; p: Page }) {
  const st = useStore()
  // Only a current snapshot is sure to hold these.
  const live = s?.v === 1 ? s : undefined
  const now = live ? stateOf(live) : 'idle'
  const isLive = now === 'active'
  const state = st.isDown ? { text: <X size={12} aria-label={p.disconnected} />, cls: 'text-bad', dot: 'var(--bad)' } : live && now === 'waiting' ? { text: stateWord(live, p), cls: 'text-warn', dot: 'var(--warn)' } : isLive ? { text: p.live, cls: 'text-signal', dot: 'var(--signal-bright)' } : { text: p.idle, cls: 'text-ink-3', dot: 'var(--ink-3)' }
  const themeLabel = { auto: p.themeAuto, dark: p.themeDark, light: p.themeLight }[st.theme]
  const ThemeIcon = { auto: Monitor, dark: Moon, light: Sun }[st.theme]
  return (
    <header className="z-30 border-b border-line bg-header lg:sticky lg:top-0">
      <div className="flex flex-wrap items-center gap-x-4 lg:flex-nowrap gap-y-1.5 px-4 py-2.5 sm:px-6">
        <span className="font-display text-[15px] font-extrabold whitespace-nowrap">AgentMon Live</span>
        {live?.build ? <span className="font-mono text-[11px] whitespace-nowrap text-ink-3" data-testid="build">{live.build}</span> : null}
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[.09em] uppercase ${state.cls}`} role="status">
          <i className={`size-1.5 rounded-full ${isLive && !st.isDown ? 'rec' : ''}`} style={{ background: state.dot }} aria-hidden />
          {state.text}
        </span>
        {live ? <span className="text-[13px] font-bold text-signal">{live.main.model}{live.main.effort ? ` (${live.main.effort})` : ''}</span> : null}
        {s && st.sessions.size > 1 ? <SessionPicker s={s} p={p} sessions={st.sessions} /> : s ? <span className="min-w-0 font-mono text-xs text-ink-2 [overflow-wrap:anywhere] lg:truncate">{whereOf(s)}</span> : null}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {live?.isPaneOpen === undefined ? null : (
            <button type="button" className="icon-btn" aria-pressed={live.isPaneOpen} aria-label={live.isPaneOpen ? p.paneHide : p.paneShow} title={live.isPaneOpen ? p.paneHide : p.paneShow} data-testid="pane-toggle" onClick={() => requestPane(live.session.id, !live.isPaneOpen)}>
              {live.isPaneOpen ? <PanelRightClose size={14} aria-hidden /> : <PanelRightOpen size={14} aria-hidden />}
            </button>
          )}
          <button type="button" className="icon-btn" aria-label={p.commands} onClick={() => set({ isPaletteOpen: true })}>
            <Command size={13} aria-hidden /><span className="max-sm:hidden">{p.commands}</span><kbd className="max-sm:hidden">⌘K</kbd>
          </button>
          <button type="button" className="icon-btn" aria-label={themeLabel} title={themeLabel} onClick={() => setTheme(NEXT[st.theme])}><ThemeIcon size={14} aria-hidden /></button>
        </div>
      </div>
    </header>
  )
}
