import type { Active, Card, Insights, TurnTime } from '../types'
import { decimal, kilo, shortPath } from './format'
import { isOversized, sizeCfg } from './sizeguard'
import { cfg } from './state'
import { isHigh } from './topology'

// Thresholds: what counts as long, big, often. Kept here so the rules read in one place.
export const LONG_CALL_MS = 60_000
export const LONG_FACTOR = 3
export const SILENT_AGENT_MS = 180_000
export const LOOP_FAILS = 3
export const BIG_RESULT_TOKENS = 10_000
export const BIG_RECENT_MS = 10 * 60_000
export const REREADS = 3
export const CHURN_EDITS = 6
export const WAIT_SHARE = 0.3
export const WAIT_MIN_MS = 30_000
export const LOW_CACHE = 0.4
export const CACHE_MIN_TOKENS = 30_000
export const SWITCHES = 8
export const SINK_SHARE = 0.6
export const SINK_MIN_MS = 60_000
export const CONTEXT_JUMP = 50_000
export const MCP_SHARE = 0.1
const KEEP_KEYS = 200
const KEEP_DURATIONS = 20

// 850 -> 0.9s, 12_400 -> 12s, 252_000 -> 4m12s, 3_840_000 -> 1h04m
export function dur(ms: number): string {
  const s = Math.max(0, ms) / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(Math.floor(s % 60)).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// What a tool result costs the context, roughly: four characters a token.
export function estTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function median(list: readonly number[]): number | undefined {
  if (list.length === 0) return undefined
  const s = [...list].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

const SPARK = '▁▂▃▄▅▆▇█'

// One cell per value, scaled to the largest; the last `width` values.
export function sparkline(values: readonly number[], width: number): string {
  const v = values.slice(-width)
  const top = Math.max(1, ...v)
  return v.map(x => SPARK[Math.min(7, Math.floor((x / top) * 7.999))] ?? '▁').join('')
}

// Folders that hold the project's real areas one level deeper.
const CONTAINERS = new Set(['src', 'packages', 'apps', 'lib', 'internal', 'cmd', 'pkg', 'services', 'crates', 'modules'])

// The part of the project a path is in: `hooks`, `src/api`, `.` for the root; outside it, its own folder.
export function areaOf(path: string, cwd: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = norm(path)
  const root = norm(cwd)
  const inside = root && (p === root || p.startsWith(`${root}/`))
  const rel = inside ? p.slice(root.length + 1) : p
  const dirs = rel.split('/').slice(0, -1).filter(Boolean)
  if (!inside) return shortPath(dirs.join('/') || '/')
  if (dirs.length === 0) return '.'
  return dirs.slice(0, CONTAINERS.has(dirs[0] ?? '') ? 2 : 1).join('/')
}

// The path a call works on, if it names one.
export function pathOf(call: object): string | undefined {
  const a = call as Record<string, unknown>
  const v = a.file_path ?? a.notebook_path ?? a.path
  return typeof v === 'string' && v ? v : undefined
}

// Keep the `n` keys with the highest counts, so a long session's maps stay small.
export function trimCounts(r: Record<string, number>, n = KEEP_KEYS): Record<string, number> {
  const entries = Object.entries(r)
  return entries.length <= n ? r : Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, n))
}

export function bump(r: Record<string, number>, key: string, by = 1): Record<string, number> {
  return trimCounts({ ...r, [key]: (r[key] ?? 0) + by })
}

export function pushDuration(r: Record<string, number[]>, tool: string, ms: number): Record<string, number[]> {
  return { ...r, [tool]: [...(r[tool] ?? []), ms].slice(-KEEP_DURATIONS) }
}

// A turn's buckets with the time not yet booked added to the bucket the clock is in.
export function liveBuckets(turn: TurnTime, now: number): Record<string, number> {
  if (!turn.mode || turn.since === undefined) return turn.buckets
  return { ...turn.buckets, [turn.mode]: (turn.buckets[turn.mode] ?? 0) + Math.max(0, now - turn.since) }
}

// Buckets largest first, as `[name, ms, share]`, zero buckets left out.
export function shares(buckets: Record<string, number>): [string, number, number][] {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0)
  if (total <= 0) return []
  return Object.entries(buckets)
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, ms]) => [k, ms, ms / total])
}

// Splits `width` cells over shares by largest remainder, so the parts always add up to the width.
export function cells(fractions: readonly number[], width: number): number[] {
  const raw = fractions.map(f => f * width)
  const out = raw.map(Math.floor)
  let left = width - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left -= 1
  }
  return out
}

export const BUCKET_COLOR: Record<string, string> = {
  model: 'magenta',
  you: 'yellow',
  idle: 'gray',
  shell: 'green',
  git: 'yellow',
  agents: 'cyan',
  web: 'blue',
  edit: 'red',
  read: 'white',
  search: 'white',
  mcp: 'blue',
  browser: 'blue',
  computer: 'blue',
  skills: 'yellow',
  other: 'gray',
}

export function bucketName(k: string): string {
  const t = cfg.t
  return t.ins.bucket[k] ?? (t.cat as Record<string, string>)[k] ?? k
}

// One thing worth looking at: `score` orders the list, `tag` is its chip, `prompt` drafts a question about it.
export type Insight = { key: string; score: number; tag: string; color: string; text: string; prompt?: string }

export type FocusInput = {
  ins: Insights
  doing: readonly Active[]
  agents: readonly Card[]
  percent?: number
  window: number
  now: number
  // What past sessions say (learn.ts); a context plan from it replaces the plain context warning.
  learned?: readonly Insight[]
}

// Everything worth a look, most important first. Pure: the pane draws it, the tests read it.
export function focusList({ ins, doing, agents, percent, window, now, learned = [] }: FocusInput): Insight[] {
  const t = cfg.t.ins
  const out: Insight[] = [...learned]
  const top = <V>(r: Record<string, V>, by: (v: V) => number) => Object.entries(r).sort((a, b) => by(b[1]) - by(a[1]))[0]

  // A call running far past what it usually takes.
  for (const a of doing) {
    if (a.isAsking) continue
    const ran = now - a.startedAt
    const usual = median(ins.durations[a.tool] ?? [])
    if (ran >= LONG_CALL_MS && (usual === undefined || ran >= LONG_FACTOR * usual)) {
      out.push({
        key: `slow:${a.id}`,
        score: 90,
        tag: t.tag.slow,
        color: 'yellow',
        text: t.slow(a.tool, a.what, dur(ran), usual === undefined ? undefined : dur(usual)),
        prompt: t.promptSlow(a.tool, a.what, dur(ran)),
      })
    }
  }

  // A subagent with no tool call or request for a while.
  for (const a of agents) {
    if (a.status !== 'running') continue
    const quiet = now - (a.lastAt ?? a.startedAt)
    if (quiet >= SILENT_AGENT_MS) {
      out.push({ key: `silent:${a.id}:${a.lastAt ?? 0}`, score: 75, tag: t.tag.silent, color: 'yellow', text: t.silent(a.type, dur(quiet), a.tools) })
    }
  }

  // The same call failing again and again.
  const loop = top(ins.fails, v => v)
  if (loop && loop[1] >= LOOP_FAILS) {
    out.push({ key: `loop:${loop[0]}:${loop[1]}`, score: 80, tag: t.tag.loop, color: 'red', text: t.loop(loop[1], loop[0]), prompt: t.promptLoop(loop[1], loop[0]) })
  }

  const biggest = [...ins.big].sort((a, b) => b.tokens - a.tokens)[0]
  if (percent !== undefined && isHigh(percent) && !learned.some(x => x.key.startsWith('ctxplan:'))) {
    out.push({
      key: `context:${Math.floor(percent / 5)}`,
      score: 85,
      tag: t.tag.context,
      color: 'red',
      text: t.contextHigh(percent, biggest ? `${biggest.tool} ${biggest.what} ≈${kilo(biggest.tokens)}` : undefined),
      prompt: t.promptContext(percent),
    })
  }

  const last = ins.last
  if (last && last.ctxStart !== undefined && last.ctxEnd !== undefined && last.ctxEnd - last.ctxStart >= CONTEXT_JUMP) {
    out.push({ key: `jump:${last.startedAt}`, score: 50, tag: t.tag.context, color: 'yellow', text: t.contextJump(kilo(last.ctxEnd - last.ctxStart)) })
  }

  for (const b of ins.big) {
    if (b.tokens >= BIG_RESULT_TOKENS && now - b.at < BIG_RECENT_MS) {
      out.push({ key: `big:${b.at}`, score: 55, tag: t.tag.big, color: 'yellow', text: t.big(b.tool, b.what, kilo(b.tokens)) })
    }
  }

  const reread = top(ins.reads, v => v)
  if (reread && reread[1] >= REREADS) {
    out.push({ key: `reread:${reread[0]}:${reread[1]}`, score: 45, tag: t.tag.reread, color: 'yellow', text: t.rereadText(shortPath(reread[0]), reread[1]), prompt: t.promptReread(reread[0], reread[1]) })
  }

  const churn = top(ins.edits, v => v)
  if (churn && churn[1] >= CHURN_EDITS) {
    out.push({ key: `churn:${churn[0]}:${churn[1]}`, score: 40, tag: t.tag.churn, color: 'yellow', text: t.churn(shortPath(churn[0]), churn[1]), prompt: t.promptChurn(churn[0], churn[1]) })
  }

  // A maintained source file past the size guide that grew this session, or a new one.
  const kb = (n: number) => decimal(n / 1000)
  const tokensK = Math.round(sizeCfg.limit / 4000)
  for (const [path, s] of Object.entries(ins.sizes)) {
    if (!isOversized(s)) continue
    out.push({
      key: `size:${path}:${s.now}`,
      score: 42,
      tag: t.tag.size,
      color: 'yellow',
      text: t.size(shortPath(path), kb(s.now), kb(sizeCfg.limit), tokensK),
      prompt: t.promptSize(path, kb(s.now), sizeCfg.limit, tokensK),
    })
  }

  if (last) {
    const you = last.buckets.you ?? 0
    if (you >= WAIT_MIN_MS && last.wallMs > 0 && you / last.wallMs >= WAIT_SHARE) {
      const asked = Object.entries(ins.asked).sort((a, b) => b[1] - a[1]).slice(0, 3)
      const list = asked.map(([k, n]) => `${k} (${n}×)`).join(', ')
      out.push({ key: `wait:${last.startedAt}`, score: 58, tag: t.tag.wait, color: 'yellow', text: t.wait(dur(you), dur(last.wallMs), asked[0]?.[0]), prompt: list ? t.promptWait(list) : undefined })
    }
    // A tool category that ate most of the turn.
    const sink = shares(last.buckets).find(([k]) => k !== 'model' && k !== 'you' && k !== 'idle')
    if (sink && sink[2] >= SINK_SHARE && sink[1] >= SINK_MIN_MS) {
      out.push({ key: `sink:${last.startedAt}`, score: 30, tag: t.tag.sink, color: 'blue', text: t.sink(bucketName(sink[0]), Math.round(sink[2] * 100), dur(sink[1])) })
    }
  }

  if (ins.cacheTotal >= CACHE_MIN_TOKENS && ins.ctx.length > 2 && ins.cacheRead / ins.cacheTotal < LOW_CACHE) {
    out.push({ key: `cache:${ins.ctx.length}`, score: 40, tag: t.tag.cache, color: 'yellow', text: t.cache(Math.round((ins.cacheRead / ins.cacheTotal) * 100)) })
  }

  if (ins.turnSwitches >= SWITCHES) {
    out.push({ key: `switches:${ins.turnSwitches}`, score: 35, tag: t.tag.switches, color: 'blue', text: t.switches(ins.turnSwitches, Object.keys(ins.turnAreas).length) })
  }

  if (ins.mcpTokens && window > 0 && ins.mcpTokens / window >= MCP_SHARE) {
    out.push({ key: 'mcp', score: 25, tag: t.tag.mcp, color: 'blue', text: t.mcp(kilo(ins.mcpTokens), Math.round((ins.mcpTokens / window) * 100)) })
  }

  return out.sort((a, b) => b.score - a.score)
}
