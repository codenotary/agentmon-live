import type { EngineInterface } from 'claude-code'

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
  if (fetch) await git($, ['fetch', '--quiet', '--no-tags', 'origin', base.replace(/^origin\//, '')]).catch(() => undefined)
  const counts = parseCounts((await git($, ['rev-list', '--left-right', '--count', `HEAD...${base}`])) ?? '')
  if (!counts) return undefined
  // Unquoted, so names with non-ASCII characters read as they are.
  const names = counts.behind > 0 ? ((await git($, ['-c', 'core.quotePath=false', 'diff', '--name-only', `HEAD...${base}`])) ?? '') : ''
  return { base, ...counts, files: names.split('\n').filter(Boolean).map(f => `${root}/${f}`) }
}
