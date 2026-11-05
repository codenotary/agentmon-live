import { expect, test } from 'claude-code/testing'

import { coverageGaps } from '../hooks/gate'
import type { TestRun } from '../hooks/gate'
import { LANGUAGES } from '../hooks/i18n'
import { addTestEdit, isTestPath, needsReview, reviewText, weakening } from '../hooks/testreview'
import type { TestEdit } from '../types'
import { LEGITIMATE, WEAKENED } from './fixtures/weakened-tests'

const en = LANGUAGES.en!

test('test files are told from source files', () => {
  for (const path of ['/r/a.test.ts', '/r/a.spec.tsx', '/r/tests/a.py', '/r/__tests__/a.js', '/r/a_test.go', '/r/test_a.py', '/r/spec/a_spec.rb']) expect(isTestPath(path)).toBe(true)
  for (const path of ['/r/src/a.ts', '/r/latest.ts', '/r/contest/a.ts', '/r/test.md.bak/x']) expect(isTestPath(path)).toBe(false)
})

test('each weakened fixture counts what it took out', () => {
  for (const w of WEAKENED) expect({ name: w.name, ...weakening(w.old, w.new) }).toEqual({ name: w.name, removed: w.removed, skips: w.skips })
})

test('a legitimate test update counts nothing', () => {
  expect(weakening(LEGITIMATE.old, LEGITIMATE.new)).toEqual({ removed: 0, skips: 0 })
})

test('a run needs review only when green and something was taken out', () => {
  const edit = (removed: number, skips = 0): TestEdit => ({ path: '/r/a.test.ts', removed, skips, at: 1 })
  expect(needsReview({ files: [edit(1)], dropped: [], isGreen: true })).toBe(true)
  expect(needsReview({ files: [edit(0, 1)], dropped: [], isGreen: true })).toBe(true)
  expect(needsReview({ files: [edit(1)], dropped: [], isGreen: false })).toBe(false)
  expect(needsReview({ files: [edit(0)], dropped: [], isGreen: true })).toBe(false)
  expect(needsReview({ files: [edit(0)], dropped: [{ command: 'npm test', ran: 2, skipped: 0, ranNow: 1, skippedNow: 0 }], isGreen: true })).toBe(true)
})

test('edits of one file add up, and the review names the file and the run', () => {
  const edits = new Map<string, TestEdit>()
  addTestEdit(edits, '/r/a.test.ts', { removed: 1, skips: 0 }, 1)
  addTestEdit(edits, '/r/a.test.ts', { removed: 1, skips: 1 }, 2)
  expect(edits.get('/r/a.test.ts')).toEqual({ path: '/r/a.test.ts', removed: 2, skips: 1, at: 2 })
  const text = reviewText(en, { files: [...edits.values()], dropped: [{ command: 'npm test', ran: 40, skipped: 0, ranNow: 38, skippedNow: 2 }], isGreen: true })
  expect(text).toContain(en.testEditLine('a.test.ts', 2, 1))
  expect(text).toContain(en.gapDropped('npm test', 40, 0, 38, 2))
})

test('a dropped run sends back unless the task edited tests', () => {
  const run = (at: number, ran: number): TestRun => ({ dir: '/repo', isFocused: false, command: 'npm test', at, result: 'ok', ran, skipped: 0 })
  expect(coverageGaps(en, [run(5, 40), run(20, 35)], [], 10)).toEqual([en.gapDropped('npm test', 40, 0, 35, 0)])
  expect(coverageGaps(en, [run(5, 40), run(20, 35)], [], 10, false, true)).toEqual([])
})
