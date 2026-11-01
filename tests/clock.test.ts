import { expect, test } from 'claude-code/testing'

import { book, newClock, snapshot } from '../hooks/clock'

test('the turn clock books each moment to what ran: the model, running calls by share, an approval wait, or idle', () => {
  const c = newClock(0, true)
  c.stepping = true
  book(c, 100)
  c.stepping = false
  c.calls.set('a', { cat: 'read', isAsking: false })
  c.calls.set('b', { cat: 'shell', isAsking: false })
  book(c, 300)
  c.calls.get('b')!.isAsking = true
  book(c, 400)
  c.calls.clear()
  book(c, 450)
  // The clock never runs backwards.
  book(c, 440)
  const s = snapshot(c)
  expect(s.buckets).toEqual({ model: 100, read: 100, shell: 100, you: 100, idle: 50 })
  expect(s.wallMs).toBe(450)
  expect(s.mode).toBe('idle')
  const off = newClock(0, false)
  book(off, 100)
  expect(snapshot(off).buckets).toEqual({})
})
