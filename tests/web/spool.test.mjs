import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readSpool } from '../../server/spool.mjs'

const TTL = 90_000
const shot = (id, extra = {}) => JSON.stringify({ session: { id }, turns: [], ...extra })
const folder = () => mkdtempSync(join(tmpdir(), 'agentmon-spool-'))
const ids = live => live.map(([id]) => id)

test('a snapshot in the folder is a session, under its file name', () => {
  const dir = folder()
  writeFileSync(join(dir, 'box-1.json'), shot('box-1'))
  writeFileSync(join(dir, 'notes.txt'), 'x')
  writeFileSync(join(dir, 'bad name.json'), shot('x'))
  const [[id, snapshot]] = readSpool(dir, 1000, TTL, new Map())
  assert.equal(id, 'box-1')
  assert.equal(snapshot.session.id, 'box-1')
  assert.equal(snapshot.session.place, 'sandbox')
  assert.deepEqual(readSpool(join(dir, 'missing'), 1000, TTL, new Map()), [])
})

test('a file that stops changing leaves like a crashed session, and is removed', () => {
  const dir = folder()
  const cache = new Map()
  writeFileSync(join(dir, 'a.json'), shot('a'))
  assert.deepEqual(ids(readSpool(dir, 1000, TTL, cache)), ['a'])
  assert.deepEqual(ids(readSpool(dir, 1000 + TTL, TTL, cache)), ['a'])
  assert.deepEqual(readSpool(dir, 1001 + TTL, TTL, cache), [])
  assert.equal(existsSync(join(dir, 'a.json')), false)
})

test('a change keeps it alive whatever the file\'s own time says', () => {
  const dir = folder()
  const cache = new Map()
  writeFileSync(join(dir, 'a.json'), shot('a'))
  readSpool(dir, 1000, TTL, cache)
  writeFileSync(join(dir, 'a.json'), shot('a', { now: 2 }))
  assert.equal(readSpool(dir, 1000 + TTL, TTL, cache)[0][1].now, 2)
  assert.deepEqual(ids(readSpool(dir, 1000 + 2 * TTL, TTL, cache)), ['a'])
})

test('the ended mark removes the session and its file', () => {
  const dir = folder()
  const cache = new Map()
  writeFileSync(join(dir, 'a.json'), shot('a'))
  readSpool(dir, 1000, TTL, cache)
  writeFileSync(join(dir, 'a.json'), '{"ended":true}')
  assert.deepEqual(readSpool(dir, 1001, TTL, cache), [])
  assert.equal(existsSync(join(dir, 'a.json')), false)
})

test('a half-written file keeps the last snapshot; what is no snapshot is no session', () => {
  const dir = folder()
  const cache = new Map()
  writeFileSync(join(dir, 'a.json'), shot('a', { now: 1 }))
  readSpool(dir, 1000, TTL, cache)
  writeFileSync(join(dir, 'a.json'), '{"session":{"id"')
  assert.equal(readSpool(dir, 1001, TTL, cache)[0][1].now, 1)
  writeFileSync(join(dir, 'b.json'), '{"turns":"x"}')
  writeFileSync(join(dir, 'c.json'), '[]')
  assert.deepEqual(ids(readSpool(dir, 1002, TTL, cache)), ['a'])
})

test('a link in the folder is not followed', { skip: process.platform === 'win32' }, () => {
  const dir = folder()
  const outside = join(folder(), 'secret.json')
  writeFileSync(outside, shot('secret'))
  symlinkSync(outside, join(dir, 'a.json'))
  assert.deepEqual(readSpool(dir, 1000, TTL, new Map()), [])
  assert.equal(existsSync(outside), true)
})

test('past the cap the same files are read every round, and the rest move up as files leave', () => {
  const dir = folder()
  const cache = new Map()
  const name = i => `s${String(i).padStart(3, '0')}`
  for (let i = 0; i < 70; i += 1) writeFileSync(join(dir, `${name(i)}.json`), shot(name(i)))
  const first = ids(readSpool(dir, 1000, TTL, cache))
  assert.equal(first.length, 64)
  assert.deepEqual(ids(readSpool(dir, 2000, TTL, cache)), first)
  writeFileSync(join(dir, `${name(0)}.json`), '{"ended":true}')
  const next = ids(readSpool(dir, 3000, TTL, cache))
  assert.equal(next.includes(name(0)), false)
  assert.equal(readSpool(dir, 4000, TTL, cache).length, 64)
})

test('a folder session carries no pane state, so the page offers no pane button', () => {
  const dir = folder()
  writeFileSync(join(dir, 'a.json'), shot('a', { isPaneOpen: true }))
  assert.equal(JSON.parse(JSON.stringify(readSpool(dir, 1000, TTL, new Map())[0][1])).isPaneOpen, undefined)
})
