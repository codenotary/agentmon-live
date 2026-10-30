import { expect, test } from 'claude-code/testing'

import { brief, describe, failLine, findCheck, findChecks, isNewer, mask, outcomeOf, percent, testsOf } from '../hooks/format'

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
  expect(mask('fix the token refresh bug')).toBe('fix the token refresh bug')
  expect(mask('the monkey patch breaks the keyboard handler')).toBe('the monkey patch breaks the keyboard handler')
  expect(mask('bearer abc123')).toBe('bearer ***')
  // camelCase and prefixed names.
  expect(mask('PGPASSWORD=hunter2 psql')).toBe('PGPASSWORD=*** psql')
  expect(mask('{"accessToken": "abc123def"}')).toBe('{"accessToken": "***"}')
  expect(mask('clientSecret: s3cr3tvalue')).toBe('clientSecret: ***')
  expect(mask('refreshToken=abc123')).toBe('refreshToken=***')
  expect(mask('maxTokens: 4000')).toBe('maxTokens: 4000')
  expect(mask('PGPASSWORD="my pass" psql')).toBe('PGPASSWORD="***" psql')
  expect(mask('{"clientSecret": "two words here"}')).toBe('{"clientSecret": "***"}')
})

test('mask hides flag secrets, cookies, quoted values with spaces and common key shapes', () => {
  expect(mask('curl -u admin:hunter2 https://x')).toBe('curl -u admin:*** https://x')
  expect(mask('mysql -h db -phunter2 app')).toBe('mysql -h db -p*** app')
  expect(mask('mkdir -p src/app')).toBe('mkdir -p src/app')
  expect(mask('curl -H "Cookie: session=abc; id=1" x')).toBe('curl -H "Cookie: ***" x')
  expect(mask('export API_TOKEN="two words"')).toBe('export API_TOKEN="***"')
  expect(mask('token="abc"')).toBe('token="***"')
  for (const s of ['sk_live_abcdefghijklmnop1234', 'glpat-abcdefghijklmnopqrstu', `AIza${'x'.repeat(35)}`, `npm_${'a'.repeat(36)}`, 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sig'])
    expect(mask(`use ${s} now`)).toBe('use *** now')
})

test('brief masks secrets', () => {
  expect(brief({ command: 'curl -H "Authorization: Bearer abc123" x' })).not.toContain('abc123')
})

test('mask hides tokens in env prefixes and URL credentials', () => {
  expect(mask('GITHUB_TOKEN=ghp_x npm test')).toBe('GITHUB_TOKEN=*** npm test')
  expect(mask('https://bob:hunter2@host/repo')).toBe('https://bob:***@host/repo')
  expect(describe('Bash', { command: 'git push https://x:ghp_abc@github.com/o/r' })).toBe('git push https://x:***@github.com/o/r')
})

test('a fail count an agent quoted from a file is no failed test', () => {
  expect(testsOf('package.json has `"test": "console.log(\'1 failing\')"`.')).toBe(undefined)
  expect(testsOf("The script prints '1 failing' and exits.")).toBe(undefined)
  expect(testsOf('```\n3 failing\n```\nThe file holds a sample report.')).toBe(undefined)
  expect(testsOf("I ran the suite: 2 tests failed, so it isn't done.")).toBe('FAIL')
  expect(failLine('quoted: "1 failing"\n3 failed in tests/a.ts')).toBe('3 failed in tests/a.ts')
})

test('a share never claims 100 % unless it is', () => {
  expect(percent(553_000, 555_000)).toBe('99.6')
  expect(percent(554_999, 555_000)).toBe('99.9')
  expect(percent(555_000, 555_000)).toBe('100')
  expect(percent(1, 3)).toBe('33')
  expect(percent(0, 10)).toBe('0')
})

test('isNewer compares release numbers, not text', () => {
  expect(isNewer('0.17.0', '0.16.0')).toBe(true)
  expect(isNewer('0.16.10', '0.16.9')).toBe(true)
  expect(isNewer('1.0.0', '0.99.99')).toBe(true)
  expect(isNewer('0.16.0', '0.16.0')).toBe(false)
  expect(isNewer('0.15.0', '0.16.0')).toBe(false)
  expect(isNewer('0.17.0', '')).toBe(false)
  expect(isNewer('latest', '0.16.0')).toBe(false)
})
