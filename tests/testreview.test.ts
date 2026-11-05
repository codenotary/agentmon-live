import { expect, test } from 'claude-code/testing'

import { coverageGaps } from '../hooks/gate'
import type { TestRun } from '../hooks/gate'
import { LANGUAGES } from '../hooks/i18n'
import { editLine, isTestPath, mergeEdit, needsReview, NOTHING, reviewLines, reviewText, weakening } from '../hooks/testreview'
import type { TestEdit } from '../types'
import { LEGITIMATE, WEAKENED } from './fixtures/weakened-tests'

const en = LANGUAGES.en!

test('test files are told from source files', () => {
  for (const path of ['/r/a.test.ts', '/r/a.spec.tsx', '/r/tests/a.py', '/r/__tests__/a.js', '/r/a_test.go', '/r/test_a.py', '/r/spec/a_spec.rb']) expect(isTestPath(path)).toBe(true)
  for (const path of ['/r/src/a.ts', '/r/latest.ts', '/r/contest/a.ts', '/r/test.md.bak/x']) expect(isTestPath(path)).toBe(false)
})

test('each weakened fixture counts what it took out', () => {
  for (const w of WEAKENED) {
    const { removed, skips, changed } = weakening(w.old, w.new)
    expect({ name: w.name, removed, skips, changed }).toEqual({ name: w.name, removed: w.removed, skips: w.skips, changed: w.changed })
  }
})

test('a legitimate test update counts nothing', () => {
  expect(weakening(LEGITIMATE.old, LEGITIMATE.new)).toEqual(NOTHING)
})

test('only a runner call or marker counts as a skip, not a property of that name', () => {
  expect(weakening('', 'const cfg = { only: true }\nrun(cfg.only, list.skip)\nexpect(state.todo).toBe(1)').skips).toBe(0)
  expect(weakening('', 'describe.only("x", () => {})\ntest.describe.skip("y", () => {})\nthis.skip()\npytest.skip("z")').skips).toBe(4)
})

test('a run needs review only when green and something was taken out', () => {
  const edit = (removed: number, skips = 0): TestEdit => ({ path: '/r/a.test.ts', removed, skips, at: 1 })
  expect(needsReview({ files: [edit(1)], dropped: [], isGreen: true })).toBe(true)
  expect(needsReview({ files: [edit(0, 1)], dropped: [], isGreen: true })).toBe(true)
  expect(needsReview({ files: [edit(1)], dropped: [], isGreen: false })).toBe(false)
  expect(needsReview({ files: [edit(0)], dropped: [], isGreen: true })).toBe(false)
  expect(needsReview({ files: [{ ...edit(0), changed: 1 }], dropped: [], isGreen: true })).toBe(true)
  expect(needsReview({ files: [edit(0)], dropped: [{ command: 'npm test', ran: 2, skipped: 0, ranNow: 1, skippedNow: 0 }], isGreen: true })).toBe(true)
})

test('edits of one file add up, and the review names the file, the lines and the run', () => {
  const first = mergeEdit([], '/r/a.test.ts', weakening('expect(a).toBe(1)', 'expect(a).toBe(2)'), 1)
  const files = mergeEdit(first, '/r/a.test.ts', weakening('expect(b).toBe(1)\nit("x")', 'it.skip("x")'), 2)
  expect(files).toHaveLength(1)
  expect(files[0]).toMatchObject({ removed: 1, skips: 1, changed: 1, at: 2 })
  const review = { files, dropped: [{ command: 'npm test', ran: 40, skipped: 0, ranNow: 38, skippedNow: 2 }], isGreen: true }
  const text = reviewText(en, review)
  expect(text).toContain(editLine(en, files[0]!))
  expect(text).toContain(en.gapDropped('npm test', 40, 0, 38, 2))
  expect(reviewLines(review)).toContain('- expect(a).toBe(1)\n+ expect(a).toBe(2)')
  expect(reviewLines(review)).toContain('+ it.skip("x")')
})

test('one of two equal assertions going is seen', () => {
  expect(weakening('expect(a).toBe(1)\nexpect(a).toBe(1)', 'expect(a).toBe(1)').removed).toBe(1)
})

test('a stored edit from before these fields still reads', () => {
  const old = { path: '/r/a.test.ts', removed: 0, skips: 1, at: 1 }
  expect(editLine(en, old)).toContain(en.testEdit.skips)
  expect(mergeEdit([old], old.path, NOTHING, 2)[0]).toMatchObject({ skips: 1, changed: 0, lines: [] })
})

test('a secret in a test line is masked, and a long line is cut', () => {
  const key = 'sk-ant-' + 'a'.repeat(40)
  const { lines } = weakening(`expect(login('${key}')).toBe(1)`, `expect(login('${key}')).toBe(2)`)
  expect(JSON.stringify(lines)).not.toContain(key)
  const long = weakening(`expect(a).toBe('${'x'.repeat(500)}')`, '').lines[0]!.before!
  expect(long.length).toBeLessThanOrEqual(160)
})

test('a dropped run sends back unless the task edited tests', () => {
  const run = (at: number, ran: number): TestRun => ({ dir: '/repo', isFocused: false, command: 'npm test', at, result: 'ok', ran, skipped: 0 })
  expect(coverageGaps(en, [run(5, 40), run(20, 35)], [], 10)).toEqual([en.gapDropped('npm test', 40, 0, 35, 0)])
  expect(coverageGaps(en, [run(5, 40), run(20, 35)], [], 10, { isTestEdited: true })).toEqual([])
})
