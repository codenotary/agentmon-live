import type { WebSnapshot } from '../../types/index'
import { nextEvents, type FeedEvent } from './events.ts'
import { DEFAULT_VIEW, type FlowView } from './flow.ts'
import { pushPoint } from './format.ts'

const HISTORY_POINTS = 600
const KEEP_EVENTS = 100
// An idle session posts every 30 s, a live turn every 3 s.
// shortcut: one threshold, so a dead busy session reads live for up to this long; a faster one for busy sessions needs care, since a background agent posts at the idle rate.
const SILENT_MS = 45_000

export type Trend = { ctx: number[]; usd: number[] }
// The state that follows the session list. Pure, so the page's state changes can be tested without a browser.
export type SessionState = {
  sessions: ReadonlyMap<string, WebSnapshot>
  // shortcut: the trend starts when the page opens, keep it on the server if people want it across reloads.
  trends: ReadonlyMap<string, Trend>
  events: ReadonlyMap<string, FeedEvent[]>
  receivedAt: ReadonlyMap<string, number>
  picked: string | null
  // The session on screen: with none picked, a session started elsewhere does not take the page over.
  shown: string | null
  // The agent Tool calls is narrowed to, by `whoKey`; the agent table sets it too.
  whoFilter: string | null
  // The time the flow chart and the waterfall show.
  flowView: FlowView
  // Agent rows folded open: the flow chart's lane labels open them too.
  openAgents: ReadonlySet<string>
}

// Sessions that have posted nothing for too long, though the server may still list them.
export function silentIds(receivedAt: ReadonlyMap<string, number>, now: number): Set<string> {
  return new Set([...receivedAt].filter(([, at]) => now - at > SILENT_MS).map(([id]) => id))
}

// A `shown` session not here yet is on its way, in the replay after `withLive`.
export const currentOf = (st: Pick<SessionState, 'sessions' | 'picked' | 'shown'>): WebSnapshot | undefined =>
  (st.picked ? st.sessions.get(st.picked) : undefined) ?? (st.shown ? st.sessions.get(st.shown) : [...st.sessions.values()].at(-1))

// The session of a Kiro Crew chat; a resumed chat has several, and the one with the latest turn is the chat now, a fresh one with no turn yet the newest.
export function sessionOfSlot(sessions: ReadonlyMap<string, WebSnapshot>, slot: string): string | undefined {
  if (!slot) return undefined
  const lastTurn = (s: WebSnapshot) => s.turns.at(-1)?.startedAt ?? Number.MAX_SAFE_INTEGER
  return [...sessions.values()].filter(s => s.session.slot === slot).sort((a, b) => lastTurn(a) - lastTurn(b)).at(-1)?.session.id
}

// What belongs to the session being left goes with it.
const left = { whoFilter: null, flowView: DEFAULT_VIEW, openAgents: new Set<string>() }

function settled<T extends SessionState>(st: T): T {
  const id = currentOf(st)?.session.id
  if (id === undefined || id === st.shown) return st
  return st.shown === null ? { ...st, shown: id } : { ...st, ...left, shown: id }
}

export function withSnapshot<T extends SessionState>(st: T, id: string, snapshot: WebSnapshot, at: number): T {
  const base = {
    ...st,
    sessions: new Map(st.sessions).set(id, { ...snapshot, session: { ...snapshot.session, id } }),
    receivedAt: new Map(st.receivedAt).set(id, at),
  }
  // Another version's snapshot may have none of the fields below; the page only shows that it needs an update.
  if (snapshot.v !== 1) return settled(base)
  const old = st.trends.get(id) ?? { ctx: [], usd: [] }
  const trend = {
    ctx: snapshot.usage.ctxPct === undefined ? old.ctx : pushPoint(old.ctx, snapshot.usage.ctxPct, HISTORY_POINTS),
    usd: pushPoint(old.usd, snapshot.usage.usd, HISTORY_POINTS),
  }
  return settled({
    ...base,
    trends: new Map(st.trends).set(id, trend),
    events: new Map(st.events).set(id, nextEvents(st.events.get(id) ?? [], snapshot.focus, snapshot.now, KEEP_EVENTS)),
  })
}

export function withoutSessions<T extends SessionState>(st: T, isGone: (id: string) => boolean): T {
  const keep = <V>(map: ReadonlyMap<string, V>) => new Map([...map].filter(([id]) => !isGone(id)))
  const next = { ...st, sessions: keep(st.sessions), trends: keep(st.trends), events: keep(st.events), receivedAt: keep(st.receivedAt) }
  if (st.shown === null || !isGone(st.shown)) return settled(next)
  return settled({ ...next, ...left, shown: [...next.sessions.keys()].at(-1) ?? null })
}

// Who the server says is live, first thing on a connection: the rest goes, and a page just opened shows the newest, not whichever replays first.
// A session already silent stays, so a person can see where it stopped.
export function withLive<T extends SessionState>(st: T, ids: readonly string[], now = 0): T {
  const live = new Set(ids)
  const silent = silentIds(st.receivedAt, now)
  const next = withoutSessions(st, id => !live.has(id) && !silent.has(id))
  return next.shown === null ? { ...next, shown: ids.at(-1) ?? null } : next
}
