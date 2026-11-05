import type { EngineInterface } from 'claude-code'

import type { TestEdit, TestLine, TestReview } from '../types'
import { mask } from './format'
import type { Strings } from './i18n'

const TEST_PATH = /(?:^|\/)(?:__tests__|tests?|spec)\/|(?:\.|_)(?:test|spec)\.\w+$|(?:^|\/)test_[^/]*\.py$/i
export const isTestPath = (path: string) => TEST_PATH.test(path)

const ASSERT = /\b(?:expect|assert\w*|should|require\.\w+|self\.assert\w+|t\.(?:Error|Fatal)\w*)\s*[(.!]|^\s*assert\s/g
const SKIP = /\.(?:skip|only|todo)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(|@pytest\.mark\.(?:skip|xfail)|@unittest\.skip|\bt\.Skip\w*\(|#\[ignore|@Ignore\b|@Disabled\b/g
const COMMENT = /^\s*(?:\/\/|#(?!\[)|\*)/

const KEEP_LINES = 5
const LINE_ROOM = 160
const KEEP_FILES = 20

const codeLines = (text: string) => text.split('\n').map(line => line.trim()).filter(line => line && !COMMENT.test(line))
const isAssert = (line: string) => line.search(ASSERT) >= 0
const skipCount = (lines: readonly string[]) => lines.reduce((n, line) => n + (line.match(SKIP)?.length ?? 0), 0)
const shown = (line: string) => mask(line).slice(0, LINE_ROOM)

// The lines of `a` not matched by one in `b`, so one of two equal assertions going is seen.
function minus(a: readonly string[], b: readonly string[]): string[] {
  const left = [...b]
  return a.filter(line => {
    const i = left.indexOf(line)
    if (i < 0) return true
    left.splice(i, 1)
    return false
  })
}

export type Weakening = { removed: number; skips: number; changed: number; lines: TestLine[] }

// An assertion on a line the edit took away, with one it put in: edited, so the test may have been made to pass. Only added lines are quiet.
// shortcut: patterns, not a parser; this only asks for a look, so upgrade only if it misleads.
export function weakening(before: string, after: string): Weakening {
  const old = codeLines(before)
  const now = codeLines(after)
  const gone = minus(old, now).filter(isAssert)
  const added = minus(now, old).filter(isAssert)
  const changed = Math.min(gone.length, added.length)
  const skipped = minus(now, old).filter(line => line.search(SKIP) >= 0)
  const lines: TestLine[] = [
    ...gone.map((line, i) => ({ before: shown(line), ...(i < changed ? { after: shown(added[i]!) } : {}) })),
    ...skipped.map(line => ({ after: shown(line) })),
  ]
  return { removed: gone.length - changed, skips: Math.max(0, skipCount(now) - skipCount(old)), changed, lines: lines.slice(0, KEEP_LINES) }
}

// What an edit call takes out of a test file, read before it runs. An edit's strings can be a fragment (`toBe(5)`), so the whole file is compared when it can be read.
// A shell command that edits a file is not seen.
export async function weakeningOf($: EngineInterface, e: { tool: string }, path: string): Promise<Weakening> {
  const input = e as { old_string?: unknown; new_string?: unknown; edits?: unknown; content?: unknown; replace_all?: unknown }
  const text = (x: unknown) => String(x ?? '')
  const file = await $.fs.read(path).catch(() => '')
  if (e.tool === 'Write') return weakening(file, text(input.content))
  const edits = Array.isArray(input.edits) ? (input.edits as (typeof input)[]) : [input]
  if (file && edits.every(x => file.includes(text(x.old_string)))) {
    const after = edits.reduce((now, x) => (x.replace_all ? now.replaceAll(text(x.old_string), () => text(x.new_string)) : now.replace(text(x.old_string), () => text(x.new_string))), file)
    return weakening(file, after)
  }
  return weakening(edits.map(x => text(x.old_string)).join('\n'), edits.map(x => text(x.new_string)).join('\n'))
}

export const NOTHING: Weakening = { removed: 0, skips: 0, changed: 0, lines: [] }

// Edits of one file add up, across turns, until the person puts the list away.
export function mergeEdit(files: readonly TestEdit[], path: string, found: Weakening, at: number): TestEdit[] {
  const old = files.find(f => f.path === path)
  const merged: TestEdit = {
    path,
    at,
    removed: (old?.removed ?? 0) + found.removed,
    skips: (old?.skips ?? 0) + found.skips,
    changed: (old?.changed ?? 0) + found.changed,
    lines: [...(old?.lines ?? []), ...found.lines].slice(-KEEP_LINES),
  }
  return [...files.filter(f => f !== old), merged].slice(-KEEP_FILES)
}

export const isFlagged = (f: TestEdit) => f.removed > 0 || f.skips > 0 || (f.changed ?? 0) > 0

// Worth a person's look: a passing run after test edits that removed or changed checks, or that ran fewer tests than before.
export const needsReview = (r: TestReview) => r.isGreen && (r.dropped.length > 0 || r.files.some(isFlagged))

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export function editLine(t: Strings, f: TestEdit): string {
  const parts = [[t.testEdit.removed, f.removed], [t.testEdit.changed, f.changed ?? 0], [t.testEdit.skips, f.skips]].filter(([, n]) => Number(n) > 0).map(([word, n]) => `${word} ${n}`)
  return `${fileName(f.path)}: ${parts.join(', ') || t.testEdit.plain}`
}
export const lineText = (l: TestLine) => [l.before !== undefined ? `- ${l.before}` : '', l.after !== undefined ? `+ ${l.after}` : ''].filter(Boolean)
export const droppedLines = (t: Strings, r: TestReview) => r.dropped.map(d => t.gapDropped(d.command, d.ran, d.skipped, d.ranNow, d.skippedNow))
export const reviewText = (t: Strings, r: TestReview) => [...r.files.filter(isFlagged).map(f => editLine(t, f)), ...droppedLines(t, r)].join('; ')
// The question for Claude also carries the lines, so it can answer about them.
export const reviewLines = (r: TestReview) => r.files.filter(isFlagged).flatMap(f => (f.lines ?? []).flatMap(lineText)).join('\n')
