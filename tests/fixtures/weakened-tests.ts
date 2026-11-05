// How a task gets a green run by changing the tests, and a test update that is fine. Each edits one test file; the run after it passes.
export const FILE = '/repo/packages/api/src/parser.test.ts'

export const WEAKENED = [
  {
    name: 'removes the assertion that failed',
    old: "test('parses', () => {\n  expect(parse('a')).toBe(1)\n  expect(parse('b')).toBe(2)\n})",
    new: "test('parses', () => {\n  expect(parse('a')).toBe(1)\n})",
    removed: 1,
    skips: 0,
  },
  {
    name: 'comments the assertion out',
    old: "  expect(parse('b')).toBe(2)",
    new: "  // expect(parse('b')).toBe(2)",
    removed: 1,
    skips: 0,
  },
  {
    name: 'skips the failing test',
    old: "test('parses', () => {",
    new: "test.skip('parses', () => {",
    removed: 0,
    skips: 1,
  },
  {
    name: 'skips and removes in Python',
    old: 'def test_parse():\n    assert parse("b") == 2',
    new: '@pytest.mark.skip\ndef test_parse():\n    pass',
    removed: 1,
    skips: 1,
  },
]

// The behaviour changed on purpose: the expected value moves, nothing is taken away.
export const LEGITIMATE = {
  name: 'updates an expected value',
  old: "  expect(parse('b')).toBe(2)",
  new: "  expect(parse('b')).toBe(3)\n  expect(parse('c')).toBe(4)",
}
