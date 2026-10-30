import type { TurnTime } from '../types'

// The main loop's turn clock: every moment of a turn goes to one bucket. A call waiting on an
// approval puts the time on `you`; running calls share it by category; a request streaming with
// no call running puts it on `model`; the rest is `idle`.
export type TurnClock = {
  inTurn: boolean
  startedAt: number
  since: number
  stepping: boolean
  steps: number
  calls: Map<string, { cat: string; isAsking: boolean }>
  buckets: Record<string, number>
  ctxStart?: number
  ctxEnd?: number
}

export function newClock(now: number, inTurn: boolean): TurnClock {
  return { inTurn, startedAt: now, since: now, stepping: false, steps: 0, calls: new Map(), buckets: {} }
}

// The buckets the time since the clock last moved goes to, with each share: the approval wait takes all, running calls split it.
function shares(c: TurnClock): [string, number][] {
  const running = [...c.calls.values()]
  if (running.some(x => x.isAsking)) return [['you', 1]]
  if (running.length > 0) return running.map(x => [x.cat, 1 / running.length])
  return [[c.stepping ? 'model' : 'idle', 1]]
}

function clockMode(c: TurnClock): string {
  return shares(c)[0]![0]
}

// Books the time since the clock last moved to the buckets it was in.
export function book(c: TurnClock, now: number) {
  if (!c.inTurn) return
  const ms = Math.max(0, now - c.since)
  c.since = Math.max(c.since, now)
  if (ms === 0) return
  for (const [k, share] of shares(c)) c.buckets[k] = (c.buckets[k] ?? 0) + ms * share
}

export function snapshot(c: TurnClock): TurnTime {
  return { startedAt: c.startedAt, wallMs: c.since - c.startedAt, buckets: { ...c.buckets }, steps: c.steps, ctxStart: c.ctxStart, ctxEnd: c.ctxEnd, mode: clockMode(c), since: c.since }
}
