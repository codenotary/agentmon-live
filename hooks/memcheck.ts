import type { MemFinding } from '../types'
import { kilo, shortPath } from './format'

// A memory or instruction file as read: `inDir` when it sits in the project's auto-memory folder.
export type MemFile = { path: string; text: string; inDir: boolean }

// A file past this many characters (about 10k tokens) costs every request that much.
export const BIG_CHARS = 40_000
// Lines shared by two files before it counts as copied content, and how long a line must be to count.
const DUP_LINES = 3
const DUP_MIN = 40
const MAX_REFS = 40

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

// Backticked absolute or home paths a file names, home expanded; globs and placeholders left out.
// A lone `/src` or `/docs` is a project folder convention, not an absolute path, so `/` needs two segments.
export function refsOf(files: readonly MemFile[], home: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of files) {
    for (const m of f.text.matchAll(/`(~\/[^\s`]+|\/[^\s`/]+\/[^\s`]+)`/g)) {
      const ref = m[1]!
      if (/[*<>${}]/.test(ref) || out.size >= MAX_REFS) continue
      out.set(ref.startsWith('~/') ? `${home}${ref.slice(1)}` : ref, f.path)
    }
  }
  return out
}

// The local rules. `dir` names the files in the memory folder; `missing` the refs that do not exist.
export function memRules(files: readonly MemFile[], dir: readonly string[], missing: ReadonlyMap<string, string>): MemFinding[] {
  const out: MemFinding[] = []
  const mem = files.filter(f => f.inDir)

  const byName = new Map<string, string[]>()
  for (const f of mem) {
    const name = f.text.match(/^name:\s*(.+)$/m)?.[1]?.trim()
    if (name) byName.set(name, [...(byName.get(name) ?? []), base(f.path)])
  }
  for (const [name, list] of byName) if (list.length > 1) out.push({ kind: 'dupName', file: list[0]!, detail: `${name} (${list.join(', ')})` })

  const index = mem.find(f => base(f.path) === 'MEMORY.md')
  if (index) {
    const linked = new Set([...index.text.matchAll(/\]\(([^)\s]+\.md)\)/g)].map(m => base(m[1]!)))
    for (const l of linked) if (!dir.includes(l)) out.push({ kind: 'missingIndex', file: index.path, detail: l })
    for (const d of dir) if (d.endsWith('.md') && d !== 'MEMORY.md' && !linked.has(d)) out.push({ kind: 'notIndexed', file: index.path, detail: d })
  }

  for (const [ref, file] of missing) out.push({ kind: 'staleRef', file, detail: `${shortPath(file)} → ${ref}` })

  for (const f of files) if (f.text.length > BIG_CHARS) out.push({ kind: 'tooBig', file: f.path, detail: `${shortPath(f.path)} ≈${kilo(Math.ceil(f.text.length / 4))}` })

  // The same long lines in two files: a copied section the model reads twice, and one copy goes stale.
  const seen = new Map<string, string>()
  const shared = new Map<string, number>()
  for (const f of files) {
    for (const line of new Set(f.text.split('\n').map(l => l.trim()))) {
      if (line.length < DUP_MIN || line.startsWith('```')) continue
      const first = seen.get(line)
      if (first === undefined) seen.set(line, f.path)
      else if (first !== f.path) shared.set(`${first}\n${f.path}`, (shared.get(`${first}\n${f.path}`) ?? 0) + 1)
    }
  }
  for (const [pair, n] of shared) {
    if (n < DUP_LINES) continue
    const [a, b] = pair.split('\n') as [string, string]
    out.push({ kind: 'dupLine', file: b, detail: `${shortPath(a)} ↔ ${shortPath(b)} (${n})` })
  }
  return out
}
