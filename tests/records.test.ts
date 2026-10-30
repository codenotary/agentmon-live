import { expect, test } from 'claude-code/testing'

import { keysOf, oldestOfOthers, rowKey, sameId, sessKey, toDrop } from '../hooks/records'

const at = (n: number) => ({ at: n, id: `s${n}` })

test('a project lists only its own keys, oldest first, even when one path is a prefix of another', () => {
  const keys = [sessKey('/a/b', at(3)), sessKey('/a/b:c', at(1)), sessKey('/a/b', at(2)), rowKey('/a/b', at(2))]
  expect(keysOf(keys, 'sess', '/a/b')).toEqual([sessKey('/a/b', at(2)), sessKey('/a/b', at(3))])
  expect(keysOf(keys, 'sess', '/a/b:c')).toEqual([sessKey('/a/b:c', at(1))])
})

test('toDrop keeps the newest of a kind and leaves other projects alone', () => {
  const keys = [1, 2, 3, 4].map(n => sessKey('/p', at(n))).concat(sessKey('/q', at(0)))
  expect(toDrop(keys, 'sess', '/p', 2)).toEqual([sessKey('/p', at(1)), sessKey('/p', at(2))])
  expect(toDrop(keys, 'sess', '/p', 10)).toEqual([])
})

test('oldestOfOthers never names this project and goes by start time across projects', () => {
  const keys = [sessKey('/p', at(1)), sessKey('/q', at(5)), rowKey('/r', at(2)), sessKey('/q', at(3)), 'proj:/q']
  expect(oldestOfOthers(keys, '/p', 10)).toEqual([rowKey('/r', at(2)), sessKey('/q', at(3)), sessKey('/q', at(5))])
  expect(oldestOfOthers(keys, '/p', 1)).toEqual([rowKey('/r', at(2))])
})

test('sameId finds an older key of the same session, not one whose id only ends alike', () => {
  const keys = [sessKey('/p', { at: 1, id: 'abc' }), sessKey('/p', { at: 2, id: 'xabc' })]
  expect(sameId(keys, 'sess', '/p', 'abc', sessKey('/p', { at: 5, id: 'abc' }))).toEqual([sessKey('/p', { at: 1, id: 'abc' })])
})
