import type { Card, Check, Task } from '../types'
import type { Strings } from './i18n'

// `before` is the checks as they stood when the prompt came in; `codeEditAt` and `lastCodeEditAt` the turn's first and last edit of a file that is not a doc.
export type GateInput = { checks: readonly Check[]; before: readonly Check[]; tasks: readonly Task[]; agents: readonly Card[]; since: number; codeEditAt?: number; lastCodeEditAt?: number }

// Prose cannot break a test, lint, typecheck or build.
const DOC = /\.(md|mdx|markdown|txt|rst|adoc)$/i
export const isDoc = (path: string) => DOC.test(path)

// What visibly is not finished when Claude is about to stop: facts the session recorded, no model involved.
// `since` is when the turn started; only this turn's checks and subagents count, open todos always do.
export function doneGaps(t: Strings, { checks, before, tasks, agents, since, codeEditAt, lastCodeEditAt }: GateInput): string[] {
  const gaps: string[] = []
  for (const c of checks) {
    if (c.at < since || c.result === 'running') continue
    // A failure this turn cannot have caused was there before the task: it already failed at the prompt, or no code changed before it ran.
    const isOld = before.some(b => b.kind === c.kind && b.result === 'failed') || codeEditAt === undefined || codeEditAt > c.at
    if (c.result === 'failed' && !isOld) gaps.push(t.gapFailed(t.check[c.kind], c.command))
    else if ((lastCodeEditAt ?? 0) > c.at) gaps.push(t.gapStale(t.check[c.kind], c.command))
  }
  const open = tasks.filter(k => k.status !== 'completed')
  // A list left from an earlier turn is not this turn's unfinished work.
  if (open.length > 0 && tasks.some(k => (k.at ?? 0) >= since)) gaps.push(t.gapTodos(open.length, open.slice(0, 3).map(k => k.subject).join('; ')))
  for (const a of agents) if (a.tests === 'FAIL' && (a.endedAt ?? 0) >= since) gaps.push(t.gapAgent(a.type, a.testsWhy ?? 'FAIL'))
  return gaps
}
