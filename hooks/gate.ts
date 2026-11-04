import type { Card, Check, Task } from '../types'
import type { TestScope } from './format'
import type { Strings } from './i18n'
import { globToRegExp, reasonedLines } from './sizeguard'

// One test run this turn: where it ran, whether it was a subset, and how many tests it executed and skipped when the summary said.
export type TestRun = TestScope & { command: string; at: number; result: Check['result']; ran?: number; skipped?: number }
// Where edited files must be tested: `min` tests at least, `isFull` with no name or file filter; a declared one is expected even when no test ran.
export type Target = { dir: string; label: string; files: string[]; isFull: boolean; min: number; isDeclared: boolean }
export type TestRule = { re: RegExp; dir: string; isFull: boolean; min: number }

// Set on each load from `.agentmon-tests`.
export const testCfg = { rules: [] as TestRule[] }

// `<glob> <dir> [full] [min=N]  # <reason>` per line; a line without a reason is ignored, as in `.agentmon-size`.
export function parseTestRules(text: string): TestRule[] {
  return reasonedLines(text).flatMap(([glob, dir, ...opts]) => {
    if (!glob || !dir) return []
    const min = Number(opts.find(o => o.startsWith('min='))?.slice(4) ?? 1)
    return [{ re: globToRegExp(glob), dir: dir.replace(/^\.\/|\/+$/g, '') || '.', isFull: opts.includes('full'), min: Number.isInteger(min) && min >= 0 ? min : 1 }]
  })
}

export const isWithin = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`)

// A run reaches a target when it ran in the target's directory or above it, or in its workspace; below it, it ran only part of it.
function reaches(r: TestRun, t: Target): { isPart: boolean } | undefined {
  if (r.pkg !== undefined) return t.dir.split('/').at(-1) === r.pkg && isWithin(t.dir, r.dir) ? { isPart: false } : undefined
  if (isWithin(t.dir, r.dir)) return { isPart: false }
  return isWithin(r.dir, t.dir) ? { isPart: true } : undefined
}

// Runs after the last code edit that executed nothing or fewer tests than before it, targets whose latest run failed, and targets no run covered.
// The checks keep one row per kind, so a target's failure is reported here: a later pass elsewhere replaces its row.
// `isOldFail`: the tests already failed at the prompt, so a failure is not this turn's. An unread summary is taken as tests run.
export function coverageGaps(t: Strings, runs: readonly TestRun[], targets: readonly Target[], lastCodeEditAt: number | undefined, isOldFail = false): string[] {
  if (lastCodeEditAt === undefined) return []
  const fresh = runs.filter(r => r.at >= lastCodeEditAt && r.result !== 'running')
  const gaps = fresh.filter(r => r.result === 'ok' && r.ran === 0).map(r => t.gapEmpty(r.command))
  // The same command ran fewer tests, or skipped more, after the edit than before it: tests were deleted or skipped.
  // The baseline is the latest such run before the last edit, so tests added and then removed are caught.
  // shortcut: the baseline is from this turn only, upgrade when a dropped test across turns matters.
  for (const last of new Map(fresh.filter(r => r.result === 'ok' && r.ran !== undefined).map(r => [`${r.dir}\0${r.command}`, r])).values()) {
    const base = runs.filter(r => r.at < lastCodeEditAt && r.ran !== undefined && r.result !== 'running' && r.dir === last.dir && r.command === last.command).at(-1)
    if (base && (last.ran! < base.ran! || (last.skipped ?? 0) > (base.skipped ?? 0))) gaps.push(t.gapDropped(last.command, base.ran!, base.skipped ?? 0, last.ran!, last.skipped ?? 0))
  }
  for (const target of targets) {
    if (!target.isDeclared && fresh.length === 0) continue
    const hits = fresh.flatMap(r => {
      const hit = reaches(r, target)
      return hit ? [{ ...r, ...hit }] : []
    })
    const last = hits.at(-1)
    if (last?.result === 'failed') {
      const gap = t.gapFailed(t.check.test, last.command)
      if (!isOldFail && !gaps.includes(gap)) gaps.push(gap)
      continue
    }
    const isCovered = hits.some(r => r.result !== 'failed' && (r.ran ?? target.min) >= target.min && !(target.isFull && (r.isFocused || r.isPart)))
    if (!isCovered) gaps.push(t.gapUncovered(target.label, target.files.slice(0, 3).join(', ')))
  }
  return gaps
}

// `before` is the checks as they stood when the prompt came in; `codeEditAt` and `lastCodeEditAt` the turn's first and last edit of a file that is not a doc.
// `answer` is Claude's final answer, to catch a claim that checks pass with nothing run to back it.
// `runs` and `targets` say which edited parts a test reached.
export type GateInput = { checks: readonly Check[]; before: readonly Check[]; tasks: readonly Task[]; agents: readonly Card[]; since: number; codeEditAt?: number; lastCodeEditAt?: number; answer?: string; runs?: readonly TestRun[]; targets?: readonly Target[] }

// Prose cannot break a test, lint, typecheck or build.
const DOC = /\.(md|mdx|markdown|txt|rst|adoc)$/i
export const isDoc = (path: string) => DOC.test(path)

// "Tests pass", "build succeeds", "typecheck clean" and the like, in each pane language; the match is what the gap quotes.
// A negation in the matched words ("tests not run", "build did not pass") is no claim.
const CLAIM = [
  /\b(?:all |the )?(?:tests?|test suite|build|typecheck|type-?check|lint|tsc|cargo (?:test|build)|go test|pytest)\b[^.\n]{0,30}?\b(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|clean|compiles?|ok)\b/i,
  /\b(?:tests?|build|typecheck|lint)\b[^.\n]{0,30}?\b(?:laufen durch|bestanden|grün|erfolgreich|passent|réussi(?:t|ssent)?|pasan|exitos[oa]s?|en verde)\b/i,
  /(?:测试|构建|类型检查)(?:全部)?(?:已)?(?:通过|成功)|(?:テスト|ビルド|型チェック)(?:は|が)?(?:すべて)?(?:通過|成功|パス)/,
]
const NEGATED = /\b(?:not|no|never|nicht|kein|pas|sin)\b|n't|未|没有|せず|ない/i

export function claimOf(answer: string): string | undefined {
  for (const re of CLAIM) {
    const m = answer.match(re)?.[0]
    if (m && !NEGATED.test(m)) return m.trim().slice(0, 60)
  }
  return undefined
}

// What visibly is not finished when Claude is about to stop: facts the session recorded, no model involved.
// `since` is when the turn started; only this turn's checks and subagents count, open todos always do.
export function doneGaps(t: Strings, { checks, before, tasks, agents, since, codeEditAt, lastCodeEditAt, answer = '', runs = [], targets = [] }: GateInput): string[] {
  const gaps: string[] = []
  for (const c of checks) {
    if (c.at < since || c.result === 'running') continue
    // A failure this turn cannot have caused was there before the task: it already failed at the prompt, or no code changed before it ran.
    const isOld = before.some(b => b.kind === c.kind && b.result === 'failed') || codeEditAt === undefined || codeEditAt > c.at
    if (c.result === 'failed' && !isOld) gaps.push(t.gapFailed(t.check[c.kind], c.command))
    else if ((lastCodeEditAt ?? 0) > c.at) gaps.push(t.gapStale(t.check[c.kind], c.command))
  }
  const isOldFail = before.some(b => b.kind === 'test' && b.result === 'failed')
  for (const gap of coverageGaps(t, runs, targets, lastCodeEditAt, isOldFail)) if (!gaps.includes(gap)) gaps.push(gap)
  // Code changed, the answer says the checks pass, and nothing ran after the change: the claim has no evidence.
  const claim = lastCodeEditAt === undefined || gaps.length > 0 ? undefined : claimOf(answer)
  if (claim && !checks.some(c => c.at >= lastCodeEditAt! && c.result !== 'running' && c.result !== 'failed')) gaps.push(t.gapClaim(claim))
  const open = tasks.filter(k => k.status !== 'completed')
  // A list left from an earlier turn is not this turn's unfinished work.
  if (open.length > 0 && tasks.some(k => (k.at ?? 0) >= since)) gaps.push(t.gapTodos(open.length, open.slice(0, 3).map(k => k.subject).join('; ')))
  for (const a of agents) if (a.tests === 'FAIL' && (a.endedAt ?? 0) >= since) gaps.push(t.gapAgent(a.type, a.testsWhy ?? 'FAIL'))
  return gaps
}
