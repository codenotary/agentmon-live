import type { Labels } from './labels.ts'

export function dur(ms: number | undefined): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`
}
// A call under a second keeps its milliseconds: `dur` would say 0s.
export const callTime = (ms: number | undefined) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} ms` : dur(ms))
export const time = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const hhmm = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const kilo = (n: number | undefined) => (n === undefined ? '0' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 100_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))
export const short = (path: string) => path.split('/').slice(-3).join('/')
// A path as the person knows it: inside an agent's worktree as inside the project, then relative to the project; elsewhere its last parts.
export function pathIn(path: string, cwd: string | undefined): string {
  const inTree = path.replace(/^.*\/\.claude\/worktrees\/[^/]+\//, `${cwd ?? ''}/`)
  const root = cwd ? `${cwd.replace(/\/+$/, '')}/` : undefined
  return root && inTree.startsWith(root) ? inTree.slice(root.length) : short(path)
}
// A list of ids as a browser kept it; anything else is an empty list, since local storage can hold what an older page wrote.
export function parseIds(text: string | null): string[] {
  try {
    const list: unknown = JSON.parse(text ?? '[]')
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// What the turns waited on you, over the session and in the turn under way, and its share of their time.
export function blockedOf(s: { insights: { session?: Record<string, number>; sessionWall?: number }; turns: readonly { wallMs: number; buckets: Record<string, number>; isLive?: boolean }[] }): { ms: number; pct: number } {
  const live = s.turns.at(-1)?.isLive ? s.turns.at(-1) : undefined
  const ms = (s.insights.session?.you ?? 0) + (live?.buckets.you ?? 0)
  const wall = (s.insights.sessionWall ?? 0) + (live?.wallMs ?? 0)
  return { ms, pct: wall > 0 ? Math.round((ms / wall) * 100) : 0 }
}

// When the tests last passed: a run still under way or cut off keeps the pass before it, a failed run does not.
export function lastGreenAt(checks: readonly { kind: string; at: number; result: string; greenAt?: number }[]): number | undefined {
  const test = checks.find(c => c.kind === 'test')
  return test?.result === 'ok' ? test.at : test?.result === 'failed' ? undefined : test?.greenAt
}

// Edited after the last test run that passed: what a reviewer wants to know before merging. Undefined while no passing run is known.
export function editsSinceGreen(files: { editedTimes?: Record<string, number> }, checks: readonly { kind: string; at: number; result: string; greenAt?: number }[]): number | undefined {
  const green = lastGreenAt(checks)
  if (green === undefined) return undefined
  return Object.values(files.editedTimes ?? {}).filter(at => at > green).length
}

// A call with no end that the session no longer runs was lost, for example to a module reload.
export const traceResult = (c: { isFailed?: boolean; ms?: number }, isActive: boolean) => (c.isFailed ? 'failed' : c.ms !== undefined ? 'ok' : isActive ? 'running' : 'unknown')
export const firstLine = (text: string) => text.split('\n')[0] ?? ''

// `g` then a letter goes to a section.
export const SECTION_KEYS: Readonly<Record<string, string>> = { o: 'overview', c: 'calls', v: 'verification', a: 'agents', f: 'files', l: 'log' }
// The row `j` or `k` moves to; from no row, the first.
export const nextRow = (at: number, length: number, step: 1 | -1) => (length === 0 ? -1 : at < 0 ? 0 : Math.min(length - 1, Math.max(0, at + step)))

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
  const sameWords = new Map<string, number>()
  for (const { full } of fulls) sameWords.set(full, (sameWords.get(full) ?? 0) + 1)
  const seen = new Map<string, number>()
  return new Map(fulls.map(({ id, full }) => {
    const prefix = prefixOf(full)
    const short = tailOf(prefix && (shared.get(prefix) ?? 0) > 1 && full.length > prefix.length ? full.slice(prefix.length) : full)
    // Agents started on one task share its words, and the filter and the lanes go by this name: a number keeps them apart.
    if ((sameWords.get(full) ?? 0) < 2) return [id, { full, short }]
    const nth = (seen.get(full) ?? 0) + 1
    seen.set(full, nth)
    return [id, { full, short: `${short} #${nth}` }]
  }))
}
// A session of an older version sends no `agentId`, and an old finished agent may be gone: `who` still names them.
// Who a call belongs to, for filters: names change as agents arrive and the main session's follows the language.
export const MAIN_KEY = 'main'
export const whoKey = (x: { who: string; agentId?: string }, agentTypes: ReadonlySet<string>) => x.agentId ?? (agentTypes.has(x.who) ? x.who : MAIN_KEY)
// A filter's own value stays on offer, so it can be cleared when its rows have gone.
export const chipsWith = (values: readonly string[], active: string | null) => (active !== null && !values.includes(active) ? [...values, active] : [...values])
export const whoOf = (x: { who: string; agentId?: string }, names: ReadonlyMap<string, AgentName>) => (x.agentId === undefined ? undefined : names.get(x.agentId)?.short) ?? x.who

// What a session is doing: something asks you (a call waiting for approval, a subagent waiting), it works, or it rests.
export type SessionState = 'waiting' | 'active' | 'idle'
export function stateOf(s: { main: { turnLive?: unknown }; active: readonly { isAsking?: boolean }[]; agents: readonly { status: string }[] }): SessionState {
  if (s.active.some(a => a.isAsking) || s.agents.some(a => a.status === 'waiting')) return 'waiting'
  // A background agent works on after the main turn has ended.
  return s.main.turnLive || s.active.length > 0 || s.agents.some(a => a.status === 'running') ? 'active' : 'idle'
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

export function titleFor(focus: readonly { key?: string; tag: string; text: string; isUrgent: boolean }[]): string {
  const first = focus.find(f => f.isUrgent)
  if (!first) return 'AgentMon Live'
  const what = `${first.tag} ${first.text}`
  // A wait is not a failure.
  return `${first.key?.startsWith('ask:') ? '⏸' : '✖'} ${what.length > 40 ? `${what.slice(0, 39)}…` : what} · AgentMon`
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

// An MCP tool goes by its server, so one server's tools share one filter button: `mcp__github__get_issue` is `mcp github`.
export function toolGroup(tool: string): string {
  const [head, server] = tool.split('__')
  return head === 'mcp' && server ? `mcp ${server}` : tool
}
