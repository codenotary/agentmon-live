// One key per session so sessions never overwrite each other; the padded start time makes keys sort oldest first.
const pad = (at: number) => String(Math.max(0, Math.floor(at))).padStart(15, '0')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type Kind = 'sess' | 'row'

export const sessKey = (cwd: string, r: { at: number; id: string }) => `sess:${cwd}:${pad(r.at)}:${r.id}`
export const rowKey = (cwd: string, r: { at: number; id: string }) => `row:${cwd}:${pad(r.at)}:${r.id}`

// The keys of one kind that belong to this project, oldest first.
export function keysOf(keys: readonly string[], kind: Kind, cwd: string): string[] {
  const re = new RegExp(`^${kind}:${escapeRe(cwd)}:\\d{15}:`)
  return keys.filter(k => re.test(k)).sort()
}

const timeOf = (key: string) => Number(key.match(/:(\d{15}):/)?.[1] ?? 0)

// Session and bench keys of other projects, oldest first: what a full store gives up first.
export function oldestOfOthers(keys: readonly string[], cwd: string, n: number): string[] {
  const mine = new Set([...keysOf(keys, 'sess', cwd), ...keysOf(keys, 'row', cwd)])
  return keys
    .filter(k => (k.startsWith('sess:') || k.startsWith('row:')) && !mine.has(k))
    .sort((a, b) => timeOf(a) - timeOf(b))
    .slice(0, Math.max(0, n))
}

// The keys to delete so that at most `keep` of this kind remain for the project.
export function toDrop(keys: readonly string[], kind: Kind, cwd: string, keep: number): string[] {
  const mine = keysOf(keys, kind, cwd)
  return mine.slice(0, Math.max(0, mine.length - keep))
}

// Keys of this project's kind for one session id, other than `except`.
export function sameId(keys: readonly string[], kind: Kind, cwd: string, id: string, except: string): string[] {
  return keysOf(keys, kind, cwd).filter(k => k !== except && k.endsWith(`:${id}`))
}
