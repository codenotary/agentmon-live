import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, Command, Monitor, Moon, PanelRightClose, PanelRightOpen, Sun, X } from 'lucide-react'

import type { WebSnapshot } from '../../types/index'
import { dur, sessionNames, stateOf, time } from './format.ts'
import { fill } from './kpi.ts'
import { labelsOf, type Page } from './labels.ts'
import { hasNoSignal, pick, requestPane, set, setTheme, useClock, useStore, type State, type Theme } from './store.ts'

const NEXT: Record<Theme, Theme> = { auto: 'dark', dark: 'light', light: 'auto' }

const START_ITEM = 'agentmon-start'
const START_URL = 'https://codenotary.com/agentmon-start'

// A Select item, not a link: Radix keeps keyboard focus on its items, so a plain link there could not be reached.
function choose(id: string) {
  if (id === START_ITEM) window.open(START_URL, '_blank', 'noopener')
  else pick(id)
}

const whereOf = (s: WebSnapshot) => `${s.session.cwd}${s.session.branch ? ` · ${s.session.branch}` : ''}`

const stateWord = (x: WebSnapshot, p: Page, st: State) => hasNoSignal(st, x.session.id) ? p.noSignal : ({ waiting: labelsOf(x).status.waiting ?? 'waiting', active: p.live, idle: p.idle })[stateOf(x)]

// When the session last said anything; `useClock` only makes the age tick.
export function LastUpdate({ s, p, className }: { s: WebSnapshot; p: Page; className: string }) {
  useClock(s)
  const at = useStore().receivedAt.get(s.session.id)
  return at === undefined ? null : <span className={className} data-testid="last-update">{fill(p.lastUpdate, { at: time(at), t: dur(Date.now() - at) })}</span>
}

function StateDot({ s, p }: { s: WebSnapshot; p: Page }) {
  const st = useStore()
  // An older version's snapshot may lack what this reads.
  return s.v === 1 ? <i className={`state-dot ${hasNoSignal(st, s.session.id) ? 'silent' : stateOf(s)}`} title={stateWord(s, p, st)} aria-hidden /> : null
}

// What sets a session apart in the list, besides its folder.
function detailOf(x: WebSnapshot, p: Page, st: State): string {
  if (x.v !== 1) return ''
  const urgent = x.focus.filter(f => f.isUrgent).length
  return [stateWord(x, p, st), x.main.model, urgent ? `${p.events}: ${urgent}` : '', x.build ?? ''].filter(Boolean).join(' · ')
}

// With several sessions the working directory is the switch between them.
function SessionPicker({ s, p, sessions }: { s: WebSnapshot; p: Page; sessions: ReadonlyMap<string, WebSnapshot> }) {
  const st = useStore()
  const names = sessionNames(sessions)
  return (
    <Select.Root value={s.session.id} onValueChange={choose}>
      <Select.Trigger className="select-trigger" id="picker" aria-label={`${whereOf(s)}, ${s.v === 1 ? stateWord(s, p, st) : ''}`} title={whereOf(s)}>
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
                <span className="select-detail">{detailOf(x, p, st)}</span>
              </Select.Item>
            ))}
            <Select.Item value={START_ITEM} className="select-item select-foot" data-testid="start-link"><Select.ItemText>{p.startLink}</Select.ItemText></Select.Item>
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
  const isSilent = live !== undefined && st.silent.has(live.session.id)
  const isLive = now === 'active' && !isSilent
  const state = st.isDown ? { text: <><X size={12} aria-hidden /><span title={p.disconnected}>{p.disconnectedWord}</span></>, cls: 'text-bad', dot: 'var(--bad)' } : isSilent ? { text: p.noSignal, cls: 'text-warn', dot: 'var(--warn)' } : live && now === 'waiting' ? { text: stateWord(live, p, st), cls: 'text-signal', dot: 'var(--signal-bright)' } : isLive ? { text: p.live, cls: 'text-good', dot: 'var(--good)' } : { text: p.idle, cls: 'text-ink-3', dot: 'var(--ink-3)' }
  // A result from before this prompt says nothing about the turn under way.
  const gate = live?.gate && live.gate.at >= (live.main.turnAt ?? 0) ? live.gate : undefined
  const themeLabel = { auto: p.themeAuto, dark: p.themeDark, light: p.themeLight }[st.theme]
  const ThemeIcon = { auto: Monitor, dark: Moon, light: Sun }[st.theme]
  return (
    <header className="z-30 border-b border-line bg-header lg:sticky lg:top-0">
      <div className="flex flex-wrap items-center gap-x-4 lg:flex-nowrap gap-y-1.5 px-4 py-2.5 sm:px-6">
        <span className="font-display text-[15px] font-extrabold whitespace-nowrap">AgentMon Live</span>
        {live?.build ? <span className="font-mono text-[11px] whitespace-nowrap text-ink-3" data-testid="build">{live.build}</span> : null}
        <span className={`inline-flex min-w-[88px] items-center gap-1.5 text-[11px] font-bold tracking-[.09em] uppercase ${state.cls}`} role="status">
          <i className={`size-2 rounded-full ${isLive && !st.isDown ? 'rec' : ''}`} style={{ background: state.dot }} aria-hidden />
          {state.text}
        </span>
        {s && hasNoSignal(st, s.session.id) ? <LastUpdate s={s} p={p} className="hidden font-mono text-[11px] whitespace-nowrap text-ink-2 lg:inline" /> : null}
        {live ? <span className="text-[13px] font-bold text-signal">{live.main.model}{live.main.effort ? ` (${live.main.effort})` : ''}</span> : null}
        {s && st.sessions.size > 1 ? <SessionPicker s={s} p={p} sessions={st.sessions} /> : s ? <span className="min-w-0 font-mono text-xs text-ink-2 [overflow-wrap:anywhere] lg:truncate">{whereOf(s)}</span> : null}
        {gate ? <span className={`font-mono text-[11px] whitespace-nowrap ${gate.ok ? 'text-good' : 'text-warn'}`} title={gate.text || undefined} data-testid="gate-chip">{gate.ok ? p.gatePassed : gate.isSent ? p.gateSent : p.gateOpen}</span> : null}
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
