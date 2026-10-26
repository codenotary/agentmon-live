import { expect, test } from 'claude-code/testing'

import { brief, findCheck, findChecks, mask, outcomeOf } from '../hooks/format'

test('findCheck on a 200 KB command of unterminated heredocs stays fast', () => {
  const command = 'npm test\n' + '<<A\n'.repeat(50_000)
  const t = performance.now()
  expect(findCheck(command)?.kind).toBe('test')
  expect(performance.now() - t).toBeLessThan(200)
})

test('outcomeOf reads the summary before test names', () => {
  const pass = ' ✓ reports 2 errors [1ms]\n ✓ fail path is handled\n ✖ FAIL label renders\n\n 3 pass\n 0 fail\nRan 3 tests across 1 files.'
  expect(outcomeOf(pass, 'test')).toBe('ok')
  expect(outcomeOf(pass.replace('3 pass\n 0 fail', '2 pass\n 1 fail'), 'test')).toBe('failed')
  const jest = 'PASS src/a.test.ts\n  ✓ shows 2 errors\n  ✓ fail is ok\n\nTests:       2 passed, 2 total\nTime:        1 s'
  expect(outcomeOf(jest, 'test')).toBe('ok')
  expect(outcomeOf(jest.replace('2 passed, 2 total', '1 failed, 1 passed, 2 total'), 'test')).toBe('failed')
  expect(outcomeOf('src/a.ts(1,1): error TS2322: x\nFound 1 error.', 'typecheck')).toBe('failed')
  expect(outcomeOf('', 'lint')).toBe('ok')
  expect(outcomeOf('', 'test')).toBe('unknown')
})

test('findChecks lists every check in command order', () => {
  expect(findChecks('npm run lint && npm test').map(c => c.kind)).toEqual(['lint', 'test'])
  expect(findCheck('npm run lint && npm test')?.part).toBe('npm run lint')
})

test('mask hides secret values', () => {
  expect(mask('curl -H "Authorization: Bearer abc123"')).toBe('curl -H "Authorization: Bearer ***"')
  expect(mask('export AWS_SECRET_ACCESS_KEY=xyz')).toBe('export AWS_SECRET_ACCESS_KEY=***')
  expect(mask('gh auth ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe('gh auth ***')
  expect(mask('cat src/token.ts')).toBe('cat src/token.ts')
})

test('brief masks secrets', () => {
  expect(brief({ command: 'curl -H "Authorization: Bearer abc123" x' })).not.toContain('abc123')
})
