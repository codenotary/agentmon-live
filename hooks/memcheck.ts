import type { MemFinding } from '../types'
import { kilo, shortPath } from './format'
import { estTokens } from './insights'

// A memory or instruction file as read: `inDir` when it sits in the project's auto-memory folder.
export type MemFile = { path: string; text: string; inDir: boolean }

// A file past this many characters (about 10k tokens) costs every request that much.
export const BIG_CHARS = 40_000
// Lines shared by two files before it counts as copied content, and how long a line must be to count.
const DUP_LINES = 3
const DUP_MIN = 40
const MAX_REFS = 40
// The memory guide's line budget for an instruction file, and how many emphasised lines count as piled on.
export const LONG_LINES = 200
export const EMPHASIS_LINES = 5
const EMPHASIS = /\b(IMPORTANT|CRITICAL|MUST|NEVER|ALWAYS|MANDATORY|ABSOLUTE)\b/

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

// Backticked absolute or home paths a file names, home expanded; globs and placeholders left out.
// A lone `/src` or `/docs` is a project folder convention, not an absolute path, so `/` needs two segments.
// A system path (`/etc/app`, `/opt/app`) usually describes the host the project deploys to, not this machine.
const SYSTEM = /^\/(etc|opt|var|usr|srv|run|root|proc|sys|dev|boot|lib|lib64|bin|sbin)\//
export function refsOf(files: readonly MemFile[], home: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of files) {
    for (const m of f.text.matchAll(/`(~\/[^\s`]+|\/[^\s`/]+\/[^\s`]+)`/g)) {
      // `a.ts:42` and `x.md#setup` name the file, not a file of that name.
      const ref = m[1]!.replace(/(?::\d+)+$|#[^/]*$/, '')
      if (/[*<>${}]/.test(ref) || SYSTEM.test(ref) || out.size >= MAX_REFS) continue
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
    // Only the frontmatter's name; a `name: CI` in a quoted snippet is not one.
    const name = f.text.match(/^---\n[\s\S]*?\n---/)?.[0].match(/^name:\s*(.+)$/m)?.[1]?.trim()
    if (name) byName.set(name, [...(byName.get(name) ?? []), base(f.path)])
  }
  for (const [name, list] of byName) if (list.length > 1) out.push({ kind: 'dupName', file: list[0]!, detail: `${name} (${list.join(', ')})` })

  const index = mem.find(f => base(f.path) === 'MEMORY.md')
  if (index) {
    // Links to the web or into subfolders are not entries of this folder.
    const linked = new Set([...index.text.matchAll(/\]\(([^)\s/]+\.md)\)/g)].map(m => m[1]!))
    for (const l of linked) if (!dir.includes(l)) out.push({ kind: 'missingIndex', file: index.path, detail: l })
    for (const d of dir) if (d.endsWith('.md') && d !== 'MEMORY.md' && !linked.has(d)) out.push({ kind: 'notIndexed', file: index.path, detail: d })
  }

  for (const [ref, file] of missing) out.push({ kind: 'staleRef', file, detail: `${shortPath(file)} → ${ref}` })

  for (const f of files) if (f.text.length > BIG_CHARS) out.push({ kind: 'tooBig', file: f.path, detail: `${shortPath(f.path)} ≈${kilo(estTokens(f.text))}` })

  // Instruction files (CLAUDE.md and the like), not the memory folder's notes: long ones and shouted rules.
  for (const f of files) {
    if (f.inDir) continue
    const lines = f.text.split('\n')
    if (lines.length > LONG_LINES && f.text.length <= BIG_CHARS) out.push({ kind: 'longFile', file: f.path, detail: `${shortPath(f.path)} (${lines.length})` })
    const loud = lines.filter(l => EMPHASIS.test(l)).length
    if (loud >= EMPHASIS_LINES) out.push({ kind: 'emphasis', file: f.path, detail: `${shortPath(f.path)} (${loud})` })
  }

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
