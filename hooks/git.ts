import type { EngineInterface } from 'claude-code'

import { DOC_TYPES } from './gate'

// Where the branch stands against its base: `behind` commits on the base HEAD lacks, `files` the base changed since they split (absolute paths, as the session sees them).
export type BaseDrift = { base: string; ahead: number; behind: number; files: string[] }

// `git rev-list --left-right --count HEAD...<base>` prints "<ahead>\t<behind>".
export function parseCounts(out: string): { ahead: number; behind: number } | undefined {
  const m = out.trim().match(/^(\d+)\s+(\d+)$/)
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : undefined
}

// Files this session edited that the base changed too: where a rebase meets conflicts.
export function overlap(baseFiles: readonly string[], edited: readonly string[]): string[] {
  const changed = new Set(baseFiles)
  return edited.filter(p => changed.has(p))
}

// The repo root as the session sees it: `cwd` less `git rev-parse --show-prefix`, so a repo opened through a symlink keeps its path.
export function repoRoot(cwd: string, prefix: string): string | undefined {
  const dir = cwd.replace(/\/+$/, '')
  const sub = prefix.replace(/\/+$/, '')
  if (!sub) return dir
  return dir.endsWith(`/${sub}`) ? dir.slice(0, -sub.length - 1) : undefined
}

// No prompt for credentials: a fetch that needs one fails instead of hanging.
async function git($: EngineInterface, args: string[]): Promise<string | undefined> {
  const r = await $.process.run(['git', ...args], { env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 20_000 })
  return r.exitCode === 0 ? r.stdout.trim() : undefined
}

// The base is the remote's default branch, else origin/main; no repo or no remote gives undefined.
// `fetch` first updates the base's remote-tracking ref; without it the last fetch, by hand or otherwise, counts.
export async function readBase($: EngineInterface, cwd: string, fetch: boolean): Promise<BaseDrift | undefined> {
  const prefix = await git($, ['rev-parse', '--show-prefix'])
  if (prefix === undefined) return undefined
  const root = repoRoot(cwd, prefix) ?? (await git($, ['rev-parse', '--show-toplevel']))
  const base = (await git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])) || 'origin/main'
  if (fetch) await git($, ['fetch', '--quiet', '--no-tags', 'origin', `refs/heads/${base.replace(/^origin\//, '')}`]).catch(() => undefined)
  const counts = parseCounts((await git($, ['rev-list', '--left-right', '--count', `HEAD...${base}`])) ?? '')
  if (!counts) return undefined
  // Unquoted, so names with non-ASCII characters read as they are.
  const names = counts.behind > 0 ? ((await git($, ['-c', 'core.quotePath=false', 'diff', '--name-only', `HEAD...${base}`])) ?? '') : ''
  return { base, ...counts, files: names.split('\n').filter(Boolean).map(f => `${root}/${f}`) }
}

// The commit and what tracked files differ from it, docs left out (untracked build or test output is no edit): compared at a turn's start and end to see edits no edit tool made.
export type WorkState = { head: string; text: string; diff: string }
const NOT_DOCS = ['.', ...DOC_TYPES.map(x => `:!*.${x}`)]

// Undefined when it cannot say: no repo, no commit, a timeout, or more output than the host hands over. No optional locks: a status must not get in the way of Claude's own git.
export async function workState($: EngineInterface, cwd: string): Promise<WorkState | undefined> {
  const run = (args: string[]) => $.process.run(['git', '--no-optional-locks', ...args], { cwd, timeoutMs: 3000 })
  const [head, status, diff] = await Promise.all([run(['rev-parse', 'HEAD']), run(['status', '--porcelain', '--untracked-files=no', '--', ...NOT_DOCS]), run(['diff', 'HEAD', '--relative', '--no-ext-diff', '--no-color', '--', ...NOT_DOCS])])
  if ([head, status, diff].some(r => r.exitCode !== 0 || r.isStdoutTruncated)) return undefined
  return { head: head.stdout.trim(), text: `${status.stdout}\n${diff.stdout}`, diff: diff.stdout }
}

// A new commit moves the diff without any edit: that says nothing.
export const isWorkChanged = (a: WorkState | undefined, b: WorkState | undefined): b is WorkState => a !== undefined && b !== undefined && a.head === b.head && a.text !== b.text

// Each file's part of a `git diff --relative`, by its path in the session folder.
// shortcut: a path git quotes (spaces, non-ASCII) has no part here, so the edit counts but its name is missing; upgrade when such names matter.
function partsByFile(diff: string): Map<string, string> {
  return new Map(diff.split(/^(?=diff --git )/m).flatMap(part => {
    const path = part.match(/^diff --git a\/(.+?) b\//)?.[1]
    return path === undefined ? [] : [[path, part] as const]
  }))
}

// The files whose diff against the commit changed between two states: what the turn edited, by any means.
export function changedFiles(a: WorkState, b: WorkState): string[] {
  const [x, y] = [partsByFile(a.diff), partsByFile(b.diff)]
  return [...new Set([...x.keys(), ...y.keys()])].filter(path => x.get(path) !== y.get(path))
}
