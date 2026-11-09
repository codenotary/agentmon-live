import type { WebFocus } from '../../types/index'

export type FeedEvent = WebFocus & { at: number; clearedAt?: number }

// An approval waits for the person: amber. Something that failed is red.
export const isAsk = (e: { key: string }) => e.key.startsWith('ask:')
export function alertOf(open: readonly FeedEvent[]): 'bad' | 'warn' | undefined {
  const urgent = open.filter(e => e.isUrgent)
  return urgent.length === 0 ? undefined : urgent.some(e => !isAsk(e)) ? 'bad' : 'warn'
}

// The kind an event is, by its key's prefix (its tag is translated text): what the filter buttons go by.
// A prefix nobody mapped is `other`, so a new kind of event never drops out of a filter.
export type EventKind = 'failures' | 'waiting' | 'context' | 'memory' | 'other'
export const EVENT_KINDS: readonly EventKind[] = ['failures', 'waiting', 'context', 'memory', 'other']
const KIND_OF: Record<string, EventKind> = {
  ...Object.fromEntries(['check', 'agent', 'streak', 'loop', 'sameErr', 'testReview', 'flaky', 'recur', 'gate', 'redo'].map(k => [k, 'failures'])),
  ...Object.fromEntries(['ask', 'wait', 'silent', 'slow', 'long'].map(k => [k, 'waiting'])),
  ...Object.fromEntries(['context', 'jump', 'big', 'fresh', 'cache', 'cold', 'ctxplan', 'mcp', 'unused'].map(k => [k, 'context'])),
  mem: 'memory',
}
export const kindOf = (key: string): EventKind => KIND_OF[key.split(':')[0] ?? ''] ?? 'other'

// What needs the person on top; everything else newest first, open or cleared, so the times read in order.
export function splitEvents(list: readonly FeedEvent[]): { attention: FeedEvent[]; rest: FeedEvent[] } {
  const needs = (e: FeedEvent) => e.isUrgent && e.clearedAt === undefined
  return { attention: list.filter(needs), rest: list.filter(e => !needs(e)).sort((a, b) => b.at - a.at) }
}

// These items carry a number that moves in their key, as in `context:16`: a new number is the same problem grown, not a cleared one and a new one.
const GROWS = /^(context|ctxplan|long|reread|churn|loop|sameErr|size):/
const familyOf = (key: string) => (GROWS.test(key) ? key.slice(0, key.lastIndexOf(':')) : key)
const isReplaced = (live: ReadonlyMap<string, WebFocus>, families: ReadonlySet<string>) => (e: FeedEvent) => e.clearedAt === undefined && GROWS.test(e.key) && !live.has(e.key) && families.has(familyOf(e.key))

// What needs the person, from the snapshot's Focus list: an item that leaves it stays here, cleared. Open ones first, then newest.
// shortcut: the feed is kept in this browser (`keepEvents`), so another browser starts when it opens; keep it on the server if people want it everywhere.
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

const isEvent = (e: unknown): e is FeedEvent => {
  const x = e as Partial<FeedEvent> | null
  return typeof x?.key === 'string' && typeof x.tag === 'string' && typeof x.text === 'string' && typeof x.at === 'number' && (x.clearedAt === undefined || typeof x.clearedAt === 'number')
}

function keptOf(raw: string | null): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw ?? '{}')
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// A session's feed as this browser kept it; anything malformed is left out.
export function keptEvents(raw: string | null, id: string): FeedEvent[] {
  const list = keptOf(raw)[id]
  return Array.isArray(list) ? list.filter(isEvent).map(e => ({ key: e.key, tag: e.tag, text: e.text, isUrgent: e.isUrgent === true, at: e.at, ...(e.clearedAt === undefined ? {} : { clearedAt: e.clearedAt }) })) : []
}

// The kept feeds with this session's replaced, newest session last; only the last `sessions` stay, so ended sessions do not pile up.
export function keepEvents(raw: string | null, id: string, list: readonly FeedEvent[], sessions: number): string {
  const { [id]: _, ...rest } = keptOf(raw)
  return JSON.stringify(Object.fromEntries([...Object.entries(rest), [id, list]].slice(-sessions)))
}
