import type { WebFocus } from '../../types/index'

export type FeedEvent = WebFocus & { at: number; clearedAt?: number }

// An approval waits for the person: amber. Something that failed is red.
export const isAsk = (e: { key: string }) => e.key.startsWith('ask:')
export function alertOf(open: readonly FeedEvent[]): 'bad' | 'warn' | undefined {
  const urgent = open.filter(e => e.isUrgent)
  return urgent.length === 0 ? undefined : urgent.some(e => !isAsk(e)) ? 'bad' : 'warn'
}

// What needs the person on top; everything else newest first, open or cleared, so the times read in order.
export function splitEvents(list: readonly FeedEvent[]): { attention: FeedEvent[]; rest: FeedEvent[] } {
  const needs = (e: FeedEvent) => e.isUrgent && e.clearedAt === undefined
  return { attention: list.filter(needs), rest: list.filter(e => !needs(e)).sort((a, b) => b.at - a.at) }
}

// These items carry a number that moves in their key, as in `context:16`: a new number is the same problem grown, not a cleared one and a new one.
const GROWS = /^(context|reread|churn|loop|sameErr|size):/
const familyOf = (key: string) => (GROWS.test(key) ? key.slice(0, key.lastIndexOf(':')) : key)
const isReplaced = (live: ReadonlyMap<string, WebFocus>, families: ReadonlySet<string>) => (e: FeedEvent) => e.clearedAt === undefined && GROWS.test(e.key) && !live.has(e.key) && families.has(familyOf(e.key))

// What needs the person, from the snapshot's Focus list: an item that leaves it stays here, cleared. Open ones first, then newest.
// shortcut: the feed starts when the page opens, so an item already open shows that time; keep it on the server if people want it across reloads.
export function nextEvents(list: readonly FeedEvent[], focus: readonly WebFocus[], now: number, cap: number): FeedEvent[] {
  const live = new Map(focus.map(f => [f.key, f]))
  const known = new Set(list.map(e => e.key))
  const liveFamilies = new Set(focus.map(f => familyOf(f.key)))
  const grown = new Map(list.filter(isReplaced(live, liveFamilies)).map(e => [familyOf(e.key), e.at]))
  const kept = list.filter(e => !isReplaced(live, liveFamilies)(e)).map((e): FeedEvent => {
    const f = live.get(e.key)
    return f ? { ...f, at: e.at } : { ...e, clearedAt: e.clearedAt ?? now }
  })
  const fresh = focus.filter(f => !known.has(f.key)).map(f => ({ ...f, at: grown.get(familyOf(f.key)) ?? now }))
  const isOpen = (e: FeedEvent) => e.clearedAt === undefined
  return [...fresh, ...kept].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.at - a.at).slice(0, cap)
}
