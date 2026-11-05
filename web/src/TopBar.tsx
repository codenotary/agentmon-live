import * as Select from '@radix-ui/react-select'
import { ChevronDown, Command, Monitor, Moon, PanelRightClose, PanelRightOpen, Sun, X } from 'lucide-react'

import type { WebSnapshot } from '../../types/index'
import { short } from './format.ts'
import type { Page } from './labels.ts'
import { pick, requestPane, set, setTheme, useStore, type Theme } from './store.ts'

const NEXT: Record<Theme, Theme> = { auto: 'dark', dark: 'light', light: 'auto' }

export const sessionName = (id: string, s: WebSnapshot) => `${short(s.session.cwd ?? id)}${s.session.branch ? ` · ${s.session.branch}` : ''}`

function SessionPicker({ s }: { s: WebSnapshot }) {
  const { sessions } = useStore()
  if (sessions.size < 2) return null
  return (
    <Select.Root value={s.session.id} onValueChange={pick}>
      <Select.Trigger className="icon-btn max-w-full min-w-0 !justify-between" id="picker" aria-label={sessionName(s.session.id, s)}>
        <span className="truncate"><Select.Value /></span>
        <Select.Icon><ChevronDown size={12} aria-hidden /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="pop z-50 !max-w-[min(420px,calc(100vw-32px))] !p-1" position="popper" sideOffset={6}>
          <Select.Viewport>
            {[...sessions.entries()].map(([id, x]) => (
              <Select.Item key={id} value={id} className="select-item">
                <Select.ItemText>{sessionName(id, x)}</Select.ItemText>
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
  const isLive = !!live && (!!live.main.turnLive || live.active.length > 0)
  const state = st.isDown ? { text: <X size={12} aria-label={p.disconnected} />, cls: 'text-bad', dot: 'var(--bad)' } : isLive ? { text: p.live, cls: 'text-signal', dot: 'var(--signal-bright)' } : { text: p.idle, cls: 'text-ink-3', dot: 'var(--ink-3)' }
  const themeLabel = { auto: p.themeAuto, dark: p.themeDark, light: p.themeLight }[st.theme]
  const ThemeIcon = { auto: Monitor, dark: Moon, light: Sun }[st.theme]
  return (
    <header className="z-30 border-b border-line bg-header lg:sticky lg:top-0">
      <div className="mx-auto flex max-w-[1720px] flex-wrap items-center gap-x-4 lg:flex-nowrap gap-y-1.5 px-4 py-2.5 sm:px-6">
        <span className="font-display text-[15px] font-extrabold whitespace-nowrap">AgentMon Live</span>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[.09em] uppercase ${state.cls}`} role="status">
          <i className={`size-1.5 rounded-full ${isLive && !st.isDown ? 'rec' : ''}`} style={{ background: state.dot }} aria-hidden />
          {state.text}
        </span>
        {live ? <span className="text-[13px] font-bold text-signal">{live.main.model}{live.main.effort ? ` (${live.main.effort})` : ''}</span> : null}
        {s ? <span className="min-w-0 font-mono text-xs text-ink-2 [overflow-wrap:anywhere] lg:truncate">{s.session.cwd}{s.session.branch ? ` · ${s.session.branch}` : ''}</span> : null}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {s ? <SessionPicker s={s} /> : null}
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
