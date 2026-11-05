import type { Labels } from './labels.ts'

export function dur(ms: number | undefined): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`
}
export const time = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const hhmm = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const day = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
export const kilo = (n: number | undefined) => (n === undefined ? '0' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 100_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))
export const short = (path: string) => path.split('/').slice(-3).join('/')
export const countWord = (n: number, p: { call: string; calls: string }) => `${n} ${n === 1 ? p.call : p.calls}`

// The end of a long name is what tells it apart: `Refactor review: cmd/server/main.go`.
const NAME_ROOM = 32
export const tailOf = (text: string, room = NAME_ROOM) => (text.length > room ? `…${text.slice(1 - room)}` : text)
export const prefixOf = (name: string) => {
  const at = name.indexOf(': ')
  return at < 0 ? '' : name.slice(0, at + 2)
}

// A subagent goes by its description, not its type, which ten parallel agents share. A prefix several share says nothing, so `short` leaves it out.
export type AgentName = { full: string; short: string }
export function agentNames(agents: readonly { id: string; type: string; task: string }[]): Map<string, AgentName> {
  const fulls = agents.map(a => ({ id: a.id, full: a.task || a.type }))
  const shared = new Map<string, number>()
  for (const { full } of fulls) shared.set(prefixOf(full), (shared.get(prefixOf(full)) ?? 0) + 1)
  return new Map(fulls.map(({ id, full }) => {
    const prefix = prefixOf(full)
    return [id, { full, short: tailOf(prefix && (shared.get(prefix) ?? 0) > 1 ? full.slice(prefix.length) : full) }]
  }))
}
// A session of an older version sends no `agentId`, and an old finished agent may be gone: `who` still names them.
export const whoOf = (x: { who: string; agentId?: string }, names: ReadonlyMap<string, AgentName>) => (x.agentId === undefined ? undefined : names.get(x.agentId)?.short) ?? x.who
// The session under way counts up to the last second; a row of an older version has only the main loop's figure.
export const rowUsd = (row: { id: string; usd?: number; totalUsd?: number }, s: { session: { id: string }; usage: { usd: number } }) => (row.id === s.session.id ? s.usage.usd : (row.totalUsd ?? row.usd))

// What a session is doing: something asks you (a call waiting for approval, a subagent waiting), it works, or it rests.
export type SessionState = 'waiting' | 'active' | 'idle'
export function stateOf(s: { main: { turnLive?: unknown }; active: readonly { isAsking?: boolean }[]; agents: readonly { status: string }[] }): SessionState {
  if (s.active.some(a => a.isAsking) || s.agents.some(a => a.status === 'waiting')) return 'waiting'
  return s.main.turnLive || s.active.length > 0 ? 'active' : 'idle'
}

// One name per session for the switch; two sessions in one folder and branch get the start of their id to tell them apart.
export function sessionNames(sessions: ReadonlyMap<string, { session: { cwd?: string; branch?: string } }>): Map<string, string> {
  const base = [...sessions].map(([id, s]) => [id, `${short(s.session.cwd ?? id)}${s.session.branch ? ` · ${s.session.branch}` : ''}`] as const)
  return new Map(base.map(([id, name]) => [id, base.filter(x => x[1] === name).length > 1 ? `${name} · ${id.slice(0, 6)}` : name]))
}

export type Tone = 'good' | 'warn' | 'bad' | ''
export const tone = (result: string): Tone => (/^(ok|done|completed)$/i.test(result) ? 'good' : /fail|error/i.test(result) ? 'bad' : /run|wait|unknown/i.test(result) ? 'warn' : '')

// `raw` is a check's result word or a call's, which is already in the session's language.
export function resultOf(raw: string, l: Pick<Labels, 'result'>): { text: string; tone: Tone } {
  const words = l.result ?? {}
  const key = raw in words ? raw : Object.keys(words).find(k => words[k] === raw)
  const tones: Record<string, Tone> = { ok: 'good', failed: 'bad', running: 'warn', unknown: 'warn' }
  return { text: (key && words[key]) || raw, tone: (key && tones[key]) || '' }
}

// Same line as `isHigh` in hooks/format.ts, so a gauge turns red where Focus starts warning.
export const levelOf = (pct: number | undefined): Tone => (pct === undefined ? '' : pct >= 80 ? 'bad' : pct >= 60 ? 'warn' : 'good')

export function pushPoint(list: readonly number[], value: number, cap: number): number[] {
  return list.at(-1) === value ? [...list] : [...list, value].slice(-cap)
}

export function titleFor(focus: readonly { tag: string; text: string; isUrgent: boolean }[]): string {
  const first = focus.find(f => f.isUrgent)
  if (!first) return 'AgentMon Live'
  const what = `${first.tag} ${first.text}`
  return `✖ ${what.length > 40 ? `${what.slice(0, 39)}…` : what} · AgentMon`
}

// Largest buckets take the ramp in order and the rest share the grey tail, as the dashboard's charts do.
export const RAMP_STEPS = 5
export function rankBuckets(turns: readonly { buckets: Record<string, number> }[]): string[] {
  const totals = new Map<string, number>()
  for (const t of turns) for (const [k, v] of Object.entries(t.buckets)) totals.set(k, (totals.get(k) ?? 0) + v)
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}
export function rampColour(ranked: readonly string[], key: string): string {
  const i = ranked.indexOf(key)
  return i >= 0 && i < RAMP_STEPS ? `var(--ramp-${i + 1})` : 'var(--ramp-other)'
}
