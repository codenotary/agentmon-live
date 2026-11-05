import { useEffect, useState, useSyncExternalStore } from 'react'

import type { Call, WebSnapshot } from '../../types/index'
import { nextEvents, type FeedEvent } from './events.ts'
import { pushPoint } from './format.ts'

const PICK_KEY = 'agentmon-live-session'
const THEME_KEY = 'agentmon-live-theme'
const HISTORY_POINTS = 600
const KEEP_EVENTS = 100

export type Theme = 'auto' | 'dark' | 'light'
// A row of the calls table or the waterfall, for the drawer.
export type Detail = Omit<Call, 'view'> & { view: string; ms?: number }
export type Trend = { ctx: number[]; usd: number[] }
export type State = {
  sessions: ReadonlyMap<string, WebSnapshot>
  // shortcut: the trend starts when the page opens, keep it on the server if people want it across reloads.
  trends: ReadonlyMap<string, Trend>
  events: ReadonlyMap<string, FeedEvent[]>
  receivedAt: ReadonlyMap<string, number>
  picked: string | null
  isDown: boolean
  downAt: number
  onlyFailures: boolean
  // The agent Tool calls is narrowed to, by the name it shows; the agent table sets it too.
  whoFilter: string | null
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
  isDown: false,
  downAt: 0,
  onlyFailures: false,
  whoFilter: null,
  theme: savedTheme === 'dark' || savedTheme === 'auto' ? savedTheme : 'light',
  call: null,
  isPaletteOpen: false,
}
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}
export const useStore = () => useSyncExternalStore(subscribe, () => state)

export const currentOf = (st: State): WebSnapshot | undefined => (st.picked ? st.sessions.get(st.picked) : undefined) ?? [...st.sessions.values()].at(-1)

export function pick(id: string): void {
  save(PICK_KEY, id)
  set({ picked: id, whoFilter: null })
}

export function setTheme(theme: Theme): void {
  save(THEME_KEY, theme)
  set({ theme })
}

// Between snapshots the session's clock runs on, from when the last one came; with the server gone it stops.
export function clockOf(s: WebSnapshot): number {
  const got = state.receivedAt.get(s.session.id) ?? Date.now()
  return s.now + (state.isDown ? state.downAt : Date.now()) - got
}

export function useClock(s: WebSnapshot, everyMs = 1000): number {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return clockOf(s)
}

function received(id: string, snapshot: WebSnapshot): void {
  const base = {
    sessions: new Map(state.sessions).set(id, { ...snapshot, session: { ...snapshot.session, id } }),
    receivedAt: new Map(state.receivedAt).set(id, Date.now()),
  }
  // Another version's snapshot may have none of the fields below; the page only shows that it needs an update.
  if (snapshot.v !== 1) return set(base)
  const old = state.trends.get(id) ?? { ctx: [], usd: [] }
  const trend = {
    ctx: snapshot.usage.ctxPct === undefined ? old.ctx : pushPoint(old.ctx, snapshot.usage.ctxPct, HISTORY_POINTS),
    usd: pushPoint(old.usd, snapshot.usage.usd, HISTORY_POINTS),
  }
  set({
    ...base,
    trends: new Map(state.trends).set(id, trend),
    events: new Map(state.events).set(id, nextEvents(state.events.get(id) ?? [], snapshot.focus, snapshot.now, KEEP_EVENTS)),
  })
}

// The session applies it within a second and says so in its next snapshot, which moves the button.
export function requestPane(id: string, isOpen: boolean): void {
  void fetch(`/pane/${encodeURIComponent(id)}/${isOpen ? 'open' : 'close'}`, { method: 'POST' }).catch(() => undefined)
}

export function connect(): void {
  const events = new EventSource('/events')
  let build: string | undefined
  // A newer server took over: this tab still runs the old page.
  events.addEventListener('build', e => {
    if (build !== undefined && build !== e.data) location.reload()
    build = e.data
  })
  // A `removed` sent while the connection was down is lost; the server replays every live session right after this.
  events.addEventListener('open', () => set({ isDown: false, sessions: new Map() }))
  events.addEventListener('error', () => {
    if (!state.isDown) set({ isDown: true, downAt: Date.now() })
  })
  events.addEventListener('snapshot', e => {
    const { id, snapshot } = JSON.parse(e.data) as { id: string; snapshot: WebSnapshot }
    received(id, snapshot)
  })
  events.addEventListener('removed', e => {
    const { id } = JSON.parse(e.data) as { id: string }
    const sessions = new Map(state.sessions)
    sessions.delete(id)
    set({ sessions })
  })
}
