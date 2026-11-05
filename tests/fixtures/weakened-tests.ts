// How a task gets a green run by changing the tests, and a test update that is fine. Each edits one test file; the run after it passes.
export const FILE = '/repo/packages/api/src/parser.test.ts'

export const WEAKENED = [
  {
    name: 'changes the expected value to pass',
    old: "  expect(parse('b')).toBe(2)",
    new: "  expect(parse('b')).toBe(3)",
    removed: 0,
    skips: 0,
    changed: 1,
  },
  {
    name: 'loosens the assertion',
    old: "  expect(parse('b')).toBe(2)",
    new: "  expect(parse('b')).toBeTruthy()",
    removed: 0,
    skips: 0,
    changed: 1,
  },
  {
    name: 'removes the assertion that failed',
    old: "test('parses', () => {\n  expect(parse('a')).toBe(1)\n  expect(parse('b')).toBe(2)\n})",
    new: "test('parses', () => {\n  expect(parse('a')).toBe(1)\n})",
    removed: 1,
    skips: 0,
    changed: 0,
  },
  {
    name: 'comments the assertion out',
    old: "  expect(parse('b')).toBe(2)",
    new: "  // expect(parse('b')).toBe(2)",
    removed: 1,
    skips: 0,
    changed: 0,
  },
  {
    name: 'skips the failing test',
    old: "test('parses', () => {",
    new: "test.skip('parses', () => {",
    removed: 0,
    skips: 1,
    changed: 0,
  },
  {
    name: 'skips and removes in Python',
    old: 'def test_parse():\n    assert parse("b") == 2',
    new: '@pytest.mark.skip\ndef test_parse():\n    pass',
    removed: 1,
    skips: 1,
    changed: 0,
  },
]

// New checks and a reformat: nothing that was asserted before is touched.
export const LEGITIMATE = {
  name: 'adds an assertion and reindents another',
  old: "    expect(parse('b')).toBe(2)",
  new: "  expect(parse('b')).toBe(2)\n  expect(parse('c')).toBe(4)",
}
