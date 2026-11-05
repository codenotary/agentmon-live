import type { WebFocus } from '../../types/index'

export type FeedEvent = WebFocus & { at: number; clearedAt?: number }

// What needs the person, from the snapshot's Focus list: an item that leaves it stays here, cleared. Open ones first, then newest.
// shortcut: the feed starts when the page opens, so an item already open shows that time; keep it on the server if people want it across reloads.
export function nextEvents(list: readonly FeedEvent[], focus: readonly WebFocus[], now: number, cap: number): FeedEvent[] {
  const live = new Map(focus.map(f => [f.key, f]))
  const known = new Set(list.map(e => e.key))
  const kept = list.map((e): FeedEvent => {
    const f = live.get(e.key)
    return f ? { ...f, at: e.at } : { ...e, clearedAt: e.clearedAt ?? now }
  })
  const fresh = focus.filter(f => !known.has(f.key)).map(f => ({ ...f, at: now }))
  const isOpen = (e: FeedEvent) => e.clearedAt === undefined
  return [...fresh, ...kept].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.at - a.at).slice(0, cap)
}
