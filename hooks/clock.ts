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

function clockMode(c: TurnClock): string {
  const running = [...c.calls.values()]
  if (running.some(x => x.isAsking)) return 'you'
  if (running.length > 0) return running[0]!.cat
  return c.stepping ? 'model' : 'idle'
}

// Books the time since the clock last moved to the bucket it was in.
export function book(c: TurnClock, now: number) {
  if (!c.inTurn) return
  const ms = Math.max(0, now - c.since)
  c.since = Math.max(c.since, now)
  if (ms === 0) return
  const running = [...c.calls.values()]
  const add = (k: string, v: number) => (c.buckets[k] = (c.buckets[k] ?? 0) + v)
  if (running.some(x => x.isAsking)) add('you', ms)
  else if (running.length > 0) for (const x of running) add(x.cat, ms / running.length)
  else add(c.stepping ? 'model' : 'idle', ms)
}

export function snapshot(c: TurnClock): TurnTime {
  return { startedAt: c.startedAt, wallMs: c.since - c.startedAt, buckets: { ...c.buckets }, steps: c.steps, ctxStart: c.ctxStart, ctxEnd: c.ctxEnd, mode: clockMode(c), since: c.since }
}
