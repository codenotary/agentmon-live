import type { EngineInterface } from 'claude-code'

import type { TestEdit, TestReview } from '../types'
import type { Strings } from './i18n'

const TEST_PATH = /(?:^|\/)(?:__tests__|tests?|spec)\/|(?:\.|_)(?:test|spec)\.\w+$|(?:^|\/)test_[^/]*\.py$/i
export const isTestPath = (path: string) => TEST_PATH.test(path)

const ASSERT = /\b(?:expect|assert\w*|should|require\.\w+|self\.assert\w+|t\.(?:Error|Fatal)\w*)\s*[(.!]|^\s*assert\s/g
const SKIP = /\.(?:skip|only|todo)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(|@pytest\.mark\.(?:skip|xfail)|@unittest\.skip|\bt\.Skip\w*\(|#\[ignore|@Ignore\b|@Disabled\b/g
const COMMENT = /^\s*(?:\/\/|#(?!\[)|\*)/

const asserts = (text: string) => text.split('\n').filter(line => !COMMENT.test(line)).reduce((n, line) => n + (line.match(ASSERT)?.length ?? 0), 0)
const skips = (text: string) => text.split('\n').filter(line => !COMMENT.test(line)).reduce((n, line) => n + (line.match(SKIP)?.length ?? 0), 0)

// shortcut: patterns, not a parser, and `replace_all` counts one replacement; this only asks for a look, so upgrade only if it misleads.
export function weakening(before: string, after: string): { removed: number; skips: number } {
  return { removed: Math.max(0, asserts(before) - asserts(after)), skips: Math.max(0, skips(after) - skips(before)) }
}

// What an edit call takes out of a test file, read before it runs. A shell command that edits a file is not seen.
export async function weakeningOf($: EngineInterface, e: { tool: string }, path: string): Promise<{ removed: number; skips: number }> {
  const input = e as { old_string?: unknown; new_string?: unknown; edits?: unknown; content?: unknown }
  const text = (x: unknown) => String(x ?? '')
  if (e.tool === 'Write') return weakening(await $.fs.read(path).catch(() => ''), text(input.content))
  const edits = Array.isArray(input.edits) ? (input.edits as { old_string?: unknown; new_string?: unknown }[]) : [input]
  return weakening(edits.map(x => text(x.old_string)).join('\n'), edits.map(x => text(x.new_string)).join('\n'))
}

export function addTestEdit(edits: Map<string, TestEdit>, path: string, found: { removed: number; skips: number }, at: number): void {
  const old = edits.get(path)
  edits.set(path, { path, removed: (old?.removed ?? 0) + found.removed, skips: (old?.skips ?? 0) + found.skips, at })
}

// Worth a person's look: a passing run after test edits that removed checks, or that ran fewer tests than before.
export const needsReview = (r: TestReview) => r.isGreen && (r.dropped.length > 0 || r.files.some(f => f.removed > 0 || f.skips > 0))

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const editLine = (t: Strings, f: TestEdit) => t.testEditLine(fileName(f.path), f.removed, f.skips)
export const droppedLines = (t: Strings, r: TestReview) => r.dropped.map(d => t.gapDropped(d.command, d.ran, d.skipped, d.ranNow, d.skippedNow))
export const reviewText = (t: Strings, r: TestReview) => [...r.files.filter(f => f.removed > 0 || f.skips > 0).map(f => editLine(t, f)), ...droppedLines(t, r)].join('; ')
