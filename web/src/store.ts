import { useEffect, useState, useSyncExternalStore } from 'react'

import type { Call, WebSnapshot } from '../../types/index'
import { DEFAULT_VIEW } from './flow.ts'
import { parseIds } from './format.ts'
import { currentOf, silentIds, withLive, withoutSessions, withSnapshot, type SessionState } from './sessions.ts'

export { currentOf }

const PICK_KEY = 'agentmon-live-session'
const THEME_KEY = 'agentmon-live-theme'
const COLLAPSED_KEY = 'agentmon-live-collapsed'
const THEME_FADE_MS = 200
const NOTICE_MS = 2500
const NOTICE_BAD_MS = 10_000
// How often a session off screen, or a hidden tab, redraws the page.
const QUIET_MS = 5000
const WATCH_MS = 5000
// Two of the server's 15 s pings missed, and some margin.
const STALL_MS = 35_000

export type Theme = 'auto' | 'dark' | 'light'
// A row of the calls table or the waterfall, for the drawer.
export type Detail = Omit<Call, 'view'> & { view: string; ms?: number }
export type { Trend } from './sessions.ts'
export type State = SessionState & {
  isDown: boolean
  downAt: number
  // Sessions the server still lists that have posted nothing for too long.
  silent: ReadonlySet<string>
  onlyFailures: boolean
  // The page's sections folded by this viewer.
  collapsed: ReadonlySet<string>
  notice: { text: string; isBad: boolean } | null
  theme: Theme
  call: Detail | null
  isPaletteOpen: boolean
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* A private window keeps the choice for this page only. */
  }
}

const savedTheme = load(THEME_KEY)
let state: State = {
  sessions: new Map(),
  trends: new Map(),
  events: new Map(),
  receivedAt: new Map(),
  picked: load(PICK_KEY),
  shown: null,
  isDown: false,
  downAt: 0,
  silent: new Set(),
  onlyFailures: false,
  whoFilter: null,
  flowView: DEFAULT_VIEW,
  openAgents: new Set(),
  collapsed: new Set(parseIds(load(COLLAPSED_KEY))),
  notice: null,
  theme: savedTheme === 'light' || savedTheme === 'auto' ? savedTheme : 'dark',
  call: null,
  isPaletteOpen: false,
}
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let quietTimer: ReturnType<typeof setTimeout> | undefined
function emit(): void {
  clearTimeout(quietTimer)
  quietTimer = undefined
  for (const fn of listeners) fn()
}
function emitSoon(): void {
  quietTimer ??= setTimeout(emit, QUIET_MS)
}

export function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  emit()
}
export const useStore = () => useSyncExternalStore(subscribe, () => state)
// What a session last said can no longer be trusted.
export const hasNoSignal = (st: Pick<State, 'isDown' | 'silent'>, id: string) => st.isDown || st.silent.has(id)

export function pick(id: string): void {
  save(PICK_KEY, id)
  // A section's link in the address belongs to the session being left.
  history.replaceState(null, '', location.pathname + location.search)
  set({ picked: id, shown: id, whoFilter: null, flowView: DEFAULT_VIEW, openAgents: new Set() })
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined
export function notify(text: string, isBad = false): void {
  clearTimeout(noticeTimer)
  set({ notice: { text, isBad } })
  // A failed copy shows the text to copy by hand: it stays longer.
  noticeTimer = setTimeout(() => set({ notice: null }), isBad ? NOTICE_BAD_MS : NOTICE_MS)
}

export function setCollapsed(id: string, isCollapsed: boolean): void {
  if (state.collapsed.has(id) === isCollapsed) return
  const collapsed = new Set(state.collapsed)
  if (isCollapsed) collapsed.add(id)
  else collapsed.delete(id)
  save(COLLAPSED_KEY, JSON.stringify([...collapsed]))
  set({ collapsed })
}

export function setTheme(theme: Theme): void {
  save(THEME_KEY, theme)
  document.documentElement.classList.add('theme-fade')
  setTimeout(() => document.documentElement.classList.remove('theme-fade'), THEME_FADE_MS)
  set({ theme })
}

// Between snapshots the session's clock runs on, from when the last one came; with no signal it stands at that last update.
export function clockOf(s: WebSnapshot): number {
  const got = state.receivedAt.get(s.session.id) ?? Date.now()
  return hasNoSignal(state, s.session.id) ? s.now : s.now + Date.now() - got
}

export function dismiss(id: string): void {
  const silent = new Set(state.silent)
  silent.delete(id)
  state = { ...withoutSessions(state, x => x === id), silent }
  emit()
}

export function useClock(s: WebSnapshot, everyMs = 1000): number {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return clockOf(s)
}

const focusKeys = (s: WebSnapshot | undefined) => s?.focus?.map(f => f.key).join('\n')

// Only the session on screen redraws at once; a hidden tab waits too, unless what needs the person changed, which the tab title shows.
function received(id: string, snapshot: WebSnapshot, age = 0): void {
  const before = focusKeys(state.sessions.get(id))
  const now = Date.now()
  state = withSnapshot(state, id, snapshot, now - age)
  // At once, not on the next watch: a fresh snapshot ends "no signal", and an old replay starts it.
  state = { ...state, silent: silentIds(state.receivedAt, now) }
  const isShown = currentOf(state)?.session.id === id
  if (isShown && (!document.hidden || focusKeys(snapshot) !== before)) emit()
  else emitSoon()
}

// The session applies it within a second and says so in its next snapshot, which moves the button.
export function requestPane(id: string, isOpen: boolean): void {
  void fetch(`/pane/${encodeURIComponent(id)}/${isOpen ? 'open' : 'close'}`, { method: 'POST' }).catch(() => undefined)
}

export function connect(): void {
  let build: string | undefined
  let lastEventAt = Date.now()
  const open = () => {
    const events = new EventSource('/events')
    const seen = () => {
      lastEventAt = Date.now()
    }
    for (const name of ['open', 'ping', 'build', 'sessions', 'snapshot', 'removed']) events.addEventListener(name, seen)
    // A newer server took over: this tab still runs the old page.
    events.addEventListener('build', e => {
      if (build !== undefined && build !== e.data) location.reload()
      build = e.data
    })
    // A `removed` sent while the connection was down is lost: the server names who is left first thing, and keeps panels and their filters mounted through a reconnect.
    events.addEventListener('open', () => set({ isDown: false }))
    events.addEventListener('sessions', e => {
      state = withLive(state, JSON.parse(e.data) as string[], Date.now())
      emit()
    })
    events.addEventListener('error', () => {
      if (!state.isDown) set({ isDown: true, downAt: Date.now() })
    })
    events.addEventListener('snapshot', e => {
      const { id, snapshot, age } = JSON.parse(e.data) as { id: string; snapshot: WebSnapshot; age?: number }
      received(id, snapshot, age)
    })
    events.addEventListener('removed', e => {
      const { id, isSilent } = JSON.parse(e.data) as { id: string; isSilent?: boolean }
      // A session that went silent stays on the page with its last state, until the person dismisses it.
      if (isSilent) return
      state = withoutSessions(state, x => x === id)
      emit()
    })
    return events
  }
  let events = open()
  setInterval(() => {
    const now = Date.now()
    // A connection that hangs without closing fires no `error`, and one the browser gave up on never retries.
    if (now - lastEventAt > STALL_MS) {
      events.close()
      lastEventAt = now
      if (!state.isDown) set({ isDown: true, downAt: now })
      events = open()
    }
    const silent = silentIds(state.receivedAt, now)
    if ([...silent].join('\n') !== [...state.silent].join('\n')) set({ silent })
  }, WATCH_MS)
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden && quietTimer !== undefined) emit() })
