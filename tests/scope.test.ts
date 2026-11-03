import { expect, test } from 'claude-code/testing'

import { findChecks, joinPath, testCounts, testScope } from '../hooks/format'
import { parseTestRules } from '../hooks/gate'

const scope = (command: string, shell = '/repo') => testScope(command, findChecks(command).find(c => c.kind === 'test')!.part, shell)

test('a test run says where it ran and whether it ran a subset', () => {
  expect(joinPath('/repo/a', '../b/./c')).toBe('/repo/b/c')
  expect(joinPath('/repo', '/abs')).toBe('/abs')
  expect(scope('npm test')).toEqual({ dir: '/repo', isFocused: false })
  expect(scope('npm test', '/repo/packages/web')).toEqual({ dir: '/repo/packages/web', isFocused: false })
  expect(scope('cd packages/web && npm test')).toEqual({ dir: '/repo/packages/web', isFocused: false })
  expect(scope('cd packages && cd api; npx vitest run')).toEqual({ dir: '/repo/packages/api', isFocused: false })
  expect(scope('npm --prefix packages/api test')).toEqual({ dir: '/repo/packages/api', isFocused: false })
  expect(scope('pnpm --filter @acme/web test')).toEqual({ dir: '/repo', pkg: 'web', isFocused: false })
  expect(scope('yarn workspace web test')).toEqual({ dir: '/repo', pkg: 'web', isFocused: false })
  expect(scope('cargo test -p api')).toEqual({ dir: '/repo', pkg: 'api', isFocused: false })
  expect(scope('go test ./internal/api/...')).toEqual({ dir: '/repo/internal/api', isFocused: false })
  expect(scope('go test ./...')).toEqual({ dir: '/repo', isFocused: false })
  expect(scope('npx vitest packages/api')).toEqual({ dir: '/repo/packages/api', isFocused: false })
  expect(scope('npx vitest -t login')).toEqual({ dir: '/repo', isFocused: true })
  expect(scope('npm test -- --testNamePattern=login')).toEqual({ dir: '/repo', isFocused: true })
  expect(scope('pytest tests/api/test_auth.py::test_login')).toEqual({ dir: '/repo/tests/api', isFocused: true })
  expect(scope('go test -run TestLogin ./api/...')).toEqual({ dir: '/repo/api', isFocused: true })
  // `-w` is vitest's watch mode, not a workspace.
  expect(scope('npx vitest -w')).toEqual({ dir: '/repo', isFocused: false })
})

test('the runner summary says how many tests ran and were skipped; an empty run is zero', () => {
  expect(testCounts('Test Suites: 2 passed, 2 total\nTests:       1 skipped, 4 passed, 5 total')).toEqual({ ran: 4, skipped: 1 })
  expect(testCounts(' Test Files  1 passed (1)\n      Tests  3 passed | 1 skipped (4)')).toEqual({ ran: 3, skipped: 1 })
  expect(testCounts('# tests 4\n# pass 3\n# fail 1\n# skipped 0')).toEqual({ ran: 4, skipped: 0 })
  expect(testCounts('==== 3 passed, 1 skipped in 0.12s ====')).toEqual({ ran: 3, skipped: 1 })
  expect(testCounts('test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out\ntest result: ok. 2 passed; 0 failed; 0 ignored')).toEqual({ ran: 5, skipped: 1 })
  expect(testCounts(' 188 pass\n 0 fail\nRan 188 tests across 13 files.')).toEqual({ ran: 188, skipped: 0 })
  expect(testCounts('No test files found, exiting with code 0')).toEqual({ ran: 0, skipped: 0 })
  expect(testCounts('No tests found, exiting with code 0')).toEqual({ ran: 0, skipped: 0 })
  expect(testCounts('collected 0 items\n\n=== no tests ran in 0.01s ===')).toEqual({ ran: 0, skipped: 0 })
  expect(testCounts('?   \texample.com/web\t[no test files]')).toEqual({ ran: 0, skipped: 0 })
  // go prints no counts for a package that ran.
  expect(testCounts('ok  \texample.com/api\t0.012s\n?   \texample.com/web\t[no test files]')).toBe(undefined)
  expect(testCounts('done')).toBe(undefined)
})

test('declared test targets need a reason; full and min are read', () => {
  const rules = parseTestRules('packages/api/** packages/api  # api unit tests\npackages/core/** ./packages/core/ full min=5 # shared code\npackages/web/** packages/web\n# a comment')
  expect(rules.map(r => ({ dir: r.dir, isFull: r.isFull, min: r.min }))).toEqual([
    { dir: 'packages/api', isFull: false, min: 1 },
    { dir: 'packages/core', isFull: true, min: 5 },
  ])
  expect(rules[0]!.re.test('packages/api/src/a.ts')).toBe(true)
  expect(rules[0]!.re.test('packages/web/src/a.ts')).toBe(false)
})

test('review findings: subshell cd, unknown folders, flags without a value, long cargo output', () => {
  expect(scope('(cd api && npm test)')).toEqual({ dir: '/repo/api', isFocused: false })
  // `~` and variables are unknown folders: the run reaches no package.
  expect(scope('cd ~/r/api && npm test').dir).toBe('?')
  expect(scope('cd $PKG && npm test').dir).toBe('?')
  expect(scope('cd $PKG && cd sub && npm test').dir).toBe('?')
  expect(scope('cargo test --workspace')).toEqual({ dir: '/repo', isFocused: false })
  expect(scope('cargo test --workspace --lib')).toEqual({ dir: '/repo', isFocused: false })
  expect(scope('pnpm -w run test')).toEqual({ dir: '/repo', isFocused: false })
  expect(scope('npm -w packages/api test')).toEqual({ dir: '/repo', pkg: 'api', isFocused: false })
  const crate = (n: number) => `     Running unittests src/lib.rs\n${'test t ... ok\n'.repeat(5)}\ntest result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n`
  const doc = '   Doc-tests c\n\nrunning 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n\n'
  expect(testCounts(Array.from({ length: 8 }, crate).join('') + doc.repeat(8))).toEqual({ ran: 40, skipped: 0 })
})
