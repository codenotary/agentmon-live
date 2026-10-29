import type { Card, Check, Task } from '../types'
import type { Strings } from './i18n'

// `before` is the checks as they stood when the prompt came in; `codeEditAt` and `lastCodeEditAt` the turn's first and last edit of a file that is not a doc.
// `answer` is Claude's final answer, to catch a claim that checks pass with nothing run to back it.
export type GateInput = { checks: readonly Check[]; before: readonly Check[]; tasks: readonly Task[]; agents: readonly Card[]; since: number; codeEditAt?: number; lastCodeEditAt?: number; answer?: string }

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
export function doneGaps(t: Strings, { checks, before, tasks, agents, since, codeEditAt, lastCodeEditAt, answer = '' }: GateInput): string[] {
  const gaps: string[] = []
  for (const c of checks) {
    if (c.at < since || c.result === 'running') continue
    // A failure this turn cannot have caused was there before the task: it already failed at the prompt, or no code changed before it ran.
    const isOld = before.some(b => b.kind === c.kind && b.result === 'failed') || codeEditAt === undefined || codeEditAt > c.at
    if (c.result === 'failed' && !isOld) gaps.push(t.gapFailed(t.check[c.kind], c.command))
    else if ((lastCodeEditAt ?? 0) > c.at) gaps.push(t.gapStale(t.check[c.kind], c.command))
  }
  // Code changed, the answer says the checks pass, and nothing ran after the change: the claim has no evidence.
  const claim = lastCodeEditAt === undefined || gaps.length > 0 ? undefined : claimOf(answer)
  if (claim && !checks.some(c => c.at >= lastCodeEditAt! && c.result !== 'running')) gaps.push(t.gapClaim(claim))
  const open = tasks.filter(k => k.status !== 'completed')
  // A list left from an earlier turn is not this turn's unfinished work.
  if (open.length > 0 && tasks.some(k => (k.at ?? 0) >= since)) gaps.push(t.gapTodos(open.length, open.slice(0, 3).map(k => k.subject).join('; ')))
  for (const a of agents) if (a.tests === 'FAIL' && (a.endedAt ?? 0) >= since) gaps.push(t.gapAgent(a.type, a.testsWhy ?? 'FAIL'))
  return gaps
}
