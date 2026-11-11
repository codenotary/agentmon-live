import { useSyncExternalStore } from 'react'

import type { Call, WebSnapshot } from '../../types/index'
import { keepEvents, keptEvents } from './events.ts'
import { DEFAULT_VIEW } from './flow.ts'
import { parseIds } from './format.ts'
import { currentOf, sessionOfSlot, silentIds, withLive, withoutSessions, withSnapshot, type SessionState } from './sessions.ts'

export { currentOf }

const PICK_KEY = 'agentmon-live-session'
const THEME_KEY = 'agentmon-live-theme'
const COLLAPSED_KEY = 'agentmon-live-collapsed'
// Each session's events, so a reload keeps their history.
const EVENTS_KEY = 'agentmon-live-events'
const PASS_KEY = 'agentmon-live-pass'
const KEEP_EVENT_SESSIONS = 10
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

// For a listener that outlives the render it was made in.
export const getState = (): State => state
export function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  emit()
}
// With a selector, a panel redraws only when its own part changes: pick one field per call, so the value compares by identity.
export function useStore(): State
export function useStore<T>(pick: (st: State) => T): T
export function useStore<T>(pick?: (st: State) => T): T | State {
  return useSyncExternalStore(subscribe, () => (pick ? pick(state) : state))
}
// What a session last said can no longer be trusted.
export const hasNoSignal = (st: Pick<State, 'isDown' | 'silent'>, id: string) => st.isDown || st.silent.has(id)

export function pick(id: string, isSaved = true): void {
  if (isSaved) save(PICK_KEY, id)
  // A section's link in the address belongs to the session being left; Kiro Crew's `#kiro=` stays, so a reload opens the same chat.
  if (isSaved) history.replaceState(null, '', location.pathname + location.search)
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

// One timer for every panel's clock, and none of it in a hidden tab.
const CLOCK_MS = 1000
const clocks = new Set<() => void>()
let ticks = 0
let clockTimer: ReturnType<typeof setInterval> | undefined
function tick(): void {
  if (document.hidden) return
  ticks += 1
  for (const fn of clocks) fn()
}
function onTick(fn: () => void): () => void {
  clocks.add(fn)
  clockTimer ??= setInterval(tick, CLOCK_MS)
  return () => {
    clocks.delete(fn)
    if (clocks.size > 0) return
    clearInterval(clockTimer)
    clockTimer = undefined
  }
}

export function useClock(s: WebSnapshot): number {
  useSyncExternalStore(onTick, () => ticks)
  return clockOf(s)
}

// In Kiro Crew's tab, the chat beside it, from `#kiro=<slot>`: picked once when its session is here, so a pick by hand afterwards stays.
let wantSlot = ''
const readSlot = () => {
  const slot = new URLSearchParams(location.hash.slice(1)).get('kiro')
  if (slot) wantSlot = slot
}
function followSlot(): void {
  const id = wantSlot ? sessionOfSlot(state.sessions, wantSlot) : undefined
  if (id === undefined) return
  wantSlot = ''
  if (state.picked !== id) pick(id, false)
}
if (typeof window !== 'undefined') {
  readSlot()
  window.addEventListener('hashchange', () => {
    readSlot()
    followSlot()
  })
}

const focusKeys = (s: WebSnapshot | undefined) => s?.focus?.map(f => f.key).join('\n')

// Only the session on screen redraws at once; a hidden tab waits too, unless what needs the person changed, which the tab title shows.
const savedEvents = new Map<string, string>()
function received(id: string, snapshot: WebSnapshot, age = 0): void {
  const before = focusKeys(state.sessions.get(id))
  const now = Date.now()
  if (!state.events.has(id)) {
    const kept = keptEvents(load(EVENTS_KEY), id)
    if (kept.length) state = { ...state, events: new Map(state.events).set(id, kept) }
  }
  state = withSnapshot(state, id, snapshot, now - age)
  // Saved when an event comes, goes or clears; texts that count up every second (a quiet agent's time) are no reason to write.
  const list = state.events.get(id)
  const shape = list?.map(e => `${e.key}|${e.at}|${e.clearedAt ?? ''}`).join('\n')
  if (list && shape !== savedEvents.get(id)) {
    savedEvents.set(id, shape ?? '')
    save(EVENTS_KEY, keepEvents(load(EVENTS_KEY), id, list, KEEP_EVENT_SESSIONS))
  }
  // At once, not on the next watch: a fresh snapshot ends "no signal", and an old replay starts it.
  state = { ...state, silent: silentIds(state.receivedAt, now) }
  const isShown = currentOf(state)?.session.id === id
  if (isShown && (!document.hidden || focusKeys(snapshot) !== before)) emit()
  else emitSoon()
  followSlot()
}

// The session applies it within a second and says so in its next snapshot, which moves the button.
export function requestPane(id: string, isOpen: boolean): void {
  void fetch(`/pane/${encodeURIComponent(id)}/${isOpen ? 'open' : 'close'}`, { method: 'POST', headers: { 'x-agentmon-pass': pass } }).catch(() => undefined)
}

// What lets this tab read: the server gives it to a browser of its own account, or for the one-time code in the address a session opened.
// Kept for a later visit where only the code can get it; in this page's own storage, which no other port's page reads.
let pass = ''
async function enter(): Promise<void> {
  const code = new URLSearchParams(location.search).get('c')
  if (code) history.replaceState(null, '', location.pathname + location.hash)
  const r = await fetch('/enter', { method: 'POST', headers: code ? { 'x-agentmon-code': code } : {} }).catch(() => undefined)
  if (r?.ok) {
    pass = ((await r.json()) as { pass: string }).pass
    save(PASS_KEY, pass)
  } else pass = load(PASS_KEY) ?? ''
}

export function connect(): void {
  let build: string | undefined
  let lastEventAt = Date.now()
  const open = () => {
    const events = new EventSource(`/events?p=${encodeURIComponent(pass)}`)
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
  let events: EventSource | undefined
  const reopen = () => void enter().then(() => (events = open()))
  reopen()
  setInterval(() => {
    const now = Date.now()
    // A connection that hangs without closing fires no `error`, and one the browser gave up on never retries. A refused one (a new secret) needs a new pass too.
    if (now - lastEventAt > STALL_MS) {
      events?.close()
      lastEventAt = now
      if (!state.isDown) set({ isDown: true, downAt: now })
      reopen()
    }
    const silent = silentIds(state.receivedAt, now)
    if ([...silent].join('\n') !== [...state.silent].join('\n')) set({ silent })
  }, WATCH_MS)
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  if (quietTimer !== undefined) emit()
  // The clocks stood still while hidden.
  tick()
})
