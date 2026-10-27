import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INIT, shapeInsights } from './state'

const insights = atom({ plugin: 'agentmon-live', key: 'insights' } as const, INIT.insights)

// About 5,000 tokens of code: a size heuristic for what a person or an agent can take in at once, not a token count.
export const SIZE_LIMIT = 20_000
const KEEP_PATHS = 100

// Maintained source; docs, data and binaries never count.
const SOURCE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|rb|php|c|h|cc|cpp|hpp|cs|scala|sh|sql|vue|svelte|css|scss|lua|dart|exs?|zig)$/i

// Files nobody maintains by hand: lockfiles, generated code, vendored code, build output and fixtures.
export const SIZE_EXCLUDE = [
  '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/bun.lock*', '**/Cargo.lock', '**/go.sum', '**/poetry.lock', '**/composer.lock', '**/Gemfile.lock',
  '**/*.min.*', '**/*.map', '**/*.generated.*', '**/*_pb2.py', '**/*.pb.go', '**/generated/**', '**/__generated__/**',
  '**/node_modules/**', '**/vendor/**', '**/third_party/**',
  '**/dist/**', '**/build/**', '**/out/**', '**/target/**', '**/.next/**', '**/coverage/**',
  '**/fixtures/**', '**/__snapshots__/**', '**/testdata/**', '**/*.snap',
]

// `**/` any directories (or none), `*` within one name, `?` one character; matched against the whole relative path.
export function globToRegExp(glob: string): RegExp {
  // Three or more stars mean no more than two; stacked `.*` groups backtrack without end.
  glob = glob.replace(/\*{3,}/g, '**')
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += glob[i + 2] === '/' ? 2 : 1
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

const MAX_WILDCARDS = 4

// `<glob>  # <reason>` per line; a line without a reason is no exception, so every exception says why.
export function parseExceptions(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .flatMap(l => {
      const [glob, reason] = l.split(/\s+#\s*/, 2)
      // A glob from the repo runs on every edit: past four wildcards it can backtrack for seconds.
      return glob && reason?.trim() && (glob.match(/[*?]/g) ?? []).length <= MAX_WILDCARDS ? [glob] : []
    })
}

// The path relative to the project, or undefined outside it.
export function relPath(path: string, cwd: string): string | undefined {
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`
  if (!path.startsWith('/')) return path.replace(/^\.\//, '')
  return cwd && path.startsWith(root) ? path.slice(root.length) : undefined
}

// Set on each load: the limit (0 is off) and every pattern that exempts a file.
export const sizeCfg = { limit: SIZE_LIMIT, patterns: SIZE_EXCLUDE.map(globToRegExp) }

export function configureSize(limit: unknown, extra: unknown, exceptions: string[] = []) {
  const n = Number(limit ?? SIZE_LIMIT)
  sizeCfg.limit = Number.isFinite(n) && n >= 0 ? n : SIZE_LIMIT
  const globs = String(extra ?? '').split(',').map(s => s.trim()).filter(Boolean)
  sizeCfg.patterns = [...SIZE_EXCLUDE, ...globs, ...exceptions].map(globToRegExp)
}

// The project-relative path when the guide watches this file, else undefined.
export function watched(path: string | undefined, cwd: string): string | undefined {
  if (!path || sizeCfg.limit === 0 || !SOURCE.test(path)) return undefined
  const rel = relPath(path, cwd)
  return rel !== undefined && !sizeCfg.patterns.some(p => p.test(rel)) ? rel : undefined
}

// Each path's size before its first edit this load (`null`: a new file); a reload starts over and keeps the stored baseline.
const baseline = new Map<string, number | null>()
export const forgetSizes = () => baseline.clear()

// Notes the size before the first edit of a path, once per path.
export async function noteSizeBefore($: EngineInterface, path: string) {
  if (baseline.has(path)) return
  baseline.set(path, await $.fs.stat(path).then(s => s.size, () => null))
}

export async function recordSize($: EngineInterface, path: string) {
  const now = await $.fs.stat(path).then(s => s.size, () => undefined)
  if (now === undefined) return
  const before = baseline.get(path)
  await update($, insights, raw => {
    const v = shapeInsights(raw)
    const prev = v.sizes[path]
    // A stored baseline wins; a new file has none, so any size over the limit counts as grown.
    const first = prev ? prev.first : (before ?? undefined)
    const { [path]: _, ...rest } = v.sizes
    const sizes = Object.fromEntries(Object.entries({ ...rest, [path]: { first, now } }).slice(-KEEP_PATHS))
    return { ...v, sizes }
  })
}

// Over the limit and grown since the session first saw it, or new.
export const isOversized = (s: { first?: number; now: number }) => sizeCfg.limit > 0 && s.now > sizeCfg.limit && (s.first === undefined || s.now > s.first)
