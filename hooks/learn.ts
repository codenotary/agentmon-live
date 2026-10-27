import type { Learned, MemFinding, SessionRecord, ToolTally } from '../types'
import { kilo } from './format'
import { median } from './insights'
import type { Insight } from './insights'
import { LEARN } from './learn-strings'
import { cfg } from './state'

// Sessions kept per project; older ones fall off, so what is learned follows how the project works now.
export const KEEP_SESSIONS = 30
// Tools kept per session record, the most called first, so the store stays small.
const KEEP_TOOLS = 60
// Evidence a learned item needs before it shows.
export const MIN_CALLS = 10
export const MIN_SESSIONS = 3
export const FLAKY_SHARE = 0.25
export const UNUSED_SESSIONS = 5
export const UNUSED_TOKENS = 1000
export const HABIT_BIG = 4
// Suggest a plan this far below where past sessions compacted; with no history, at this share of the window.
export const CTX_MARGIN = 0.9
export const CTX_FALLBACK = 0.7
export const BIG_TOKENS = 10_000

export const EMPTY_LEARNED: Learned = { current: '', sessions: [], mem: [] }

export const lt = () => LEARN[cfg.lang] ?? LEARN.en!

export function storeKey(cwd: string): string {
  return `proj:${cwd}`
}

// A store written by an older version, or by nothing yet, comes back as a valid shape.
export function shapeLearned(v: unknown): Learned {
  const o = (v ?? {}) as Partial<Learned>
  return { ...EMPTY_LEARNED, ...o, sessions: Array.isArray(o.sessions) ? o.sessions : [], mem: Array.isArray(o.mem) ? o.mem : [] }
}

export function newRecord(id: string, at: number): SessionRecord {
  return { id, at, model: '', effort: '', peak: 0, window: 0, compactAt: [], turns: 0, tools: {}, mcp: {} }
}

// Adds one call to a session record, in place: the record is the session's own working copy.
export function tally(rec: SessionRecord, tool: string, isError: boolean, error: string, resultTokens: number) {
  const t: ToolTally = (rec.tools[tool] ??= { calls: 0, errors: 0, big: 0 })
  t.calls += 1
  if (isError) {
    t.errors += 1
    t.lastErr = error.replace(/\s+/g, ' ').trim().slice(0, 120) || undefined
  }
  if (resultTokens >= BIG_TOKENS) t.big += 1
}

function trimTools(rec: SessionRecord): SessionRecord {
  const entries = Object.entries(rec.tools)
  if (entries.length <= KEEP_TOOLS) return rec
  return { ...rec, tools: Object.fromEntries(entries.sort((a, b) => b[1].calls - a[1].calls).slice(0, KEEP_TOOLS)) }
}

// Puts a session's record in place of its earlier one, oldest first, the last KEEP_SESSIONS kept.
export function upsert(learned: Learned, rec: SessionRecord): Learned {
  const sessions = [...learned.sessions.filter(s => s.id !== rec.id), trimTools(rec)].sort((a, b) => a.at - b.at).slice(-KEEP_SESSIONS)
  return { ...learned, sessions }
}

// A rejected call says nothing about the tool.
const REJECTED = /^The user doesn't want to proceed|tool use was rejected/i

// One transcript file (`<id>.jsonl`) as a session record, for the backfill. Lines that do not parse are skipped.
export function parseTranscript(id: string, text: string): SessionRecord {
  const rec = newRecord(id, 0)
  const names = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let o: Record<string, any>
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!rec.at && typeof o.timestamp === 'string') rec.at = Date.parse(o.timestamp) || 0
    const content = o.message?.content
    if (o.type === 'assistant' && o.message) {
      if (typeof o.message.model === 'string' && !o.message.model.startsWith('<')) rec.model = o.message.model
      const u = o.message.usage
      if (u && !o.isSidechain) rec.peak = Math.max(rec.peak, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0))
      for (const b of Array.isArray(content) ? content : []) {
        if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue
        names.set(b.id, b.name)
        tally(rec, b.name, false, '', 0)
      }
    } else if (o.type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type !== 'tool_result') continue
        const tool = names.get(b.tool_use_id)
        const t = tool === undefined ? undefined : rec.tools[tool]
        if (!t) continue
        const body = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c?.text ?? '').join('\n') : ''
        if (b.is_error && !REJECTED.test(body)) {
          t.errors += 1
          t.lastErr = body.replace(/\s+/g, ' ').trim().slice(0, 120) || undefined
        }
        if (Math.ceil(body.length / 4) >= BIG_TOKENS) t.big += 1
      }
    } else if (o.type === 'system' && o.subtype === 'compact_boundary') {
      const pre = Number(o.compactMetadata?.preTokens)
      if (pre > 0) rec.compactAt.push(pre)
    } else if (o.type === 'system' && o.subtype === 'turn_duration') {
      rec.turns += 1
    }
  }
  return rec
}

// The MCP server part of a tool's wire name: `mcp__github__create_issue` -> `mcp__github`.
export function serverOf(tool: string): string | undefined {
  if (!tool.startsWith('mcp__')) return undefined
  const cut = tool.lastIndexOf('__')
  return cut > 4 ? tool.slice(0, cut) : undefined
}

export type Totals = {
  tools: Record<string, ToolTally & { sessions: number }>
  servers: Record<string, { loaded: number; used: number; tokens: number }>
  compactAt: number[]
}

// Sums the records; `compactAt` from the past sessions only, so this session's own compactions do not set its threshold.
export function totals(learned: Learned): Totals {
  const out: Totals = { tools: {}, servers: {}, compactAt: [] }
  for (const s of learned.sessions) {
    if (s.id !== learned.current) out.compactAt.push(...s.compactAt)
    const used = new Set<string>()
    for (const [tool, t] of Object.entries(s.tools)) {
      const sum = (out.tools[tool] ??= { calls: 0, errors: 0, big: 0, sessions: 0 })
      sum.calls += t.calls
      sum.errors += t.errors
      sum.big += t.big
      sum.sessions += 1
      if (t.lastErr) sum.lastErr = t.lastErr
      const server = serverOf(tool)
      if (server) used.add(server)
    }
    for (const [server, tokens] of Object.entries(s.mcp)) {
      const sum = (out.servers[server] ??= { loaded: 0, used: 0, tokens: 0 })
      sum.loaded += 1
      sum.tokens = tokens
      if (used.has(server)) sum.used += 1
    }
  }
  return out
}

export function errorShare(t: ToolTally): number {
  return t.calls > 0 ? t.errors / t.calls : 0
}

export function isFlaky(t: ToolTally & { sessions: number }): boolean {
  return t.calls >= MIN_CALLS && t.sessions >= MIN_SESSIONS && errorShare(t) >= FLAKY_SHARE
}

// Where past sessions compacted, as a share of the window, rounded to a percent; undefined with no history.
export function typicalCompact(sum: Totals, window: number): number | undefined {
  const m = median(sum.compactAt)
  return m === undefined || window <= 0 ? undefined : Math.min(100, Math.round((m / window) * 100))
}

export type Live = { percent?: number; window: number; model: string; effort: string }

// What past sessions say about this one, as Focus items. Suggestions only: nothing here changes the session.
export function learnedItems(learned: Learned, live: Live): Insight[] {
  // Learning off, or not started: nothing to say.
  if (!learned.current) return []
  const t = lt()
  const out: Insight[] = []
  const sum = totals(learned)
  const past = learned.sessions.filter(s => s.id !== learned.current && s.compactAt.length > 0).length

  const { percent, window } = live
  if (percent !== undefined && window > 0) {
    const m = median(sum.compactAt)
    // Past sessions on a larger window compacted later than this one can.
    const limit = m === undefined ? window * CTX_FALLBACK : Math.min(m, window) * CTX_MARGIN
    if ((percent / 100) * window >= limit) {
      const tips = [t.tipCompact]
      if (/^(high|xhigh|max)$/.test(live.effort)) tips.push(t.tipEffort)
      if (/opus|fable/i.test(live.model)) tips.push(t.tipModel)
      out.push({
        key: `ctxplan:${Math.floor(percent / 5)}`,
        score: 85,
        tag: t.tag.plan,
        color: 'red',
        text: t.ctxPlan(percent, tips.join(' · '), past, typicalCompact(sum, window)),
        prompt: cfg.t.ins.promptContext(percent),
      })
    }
  }

  const flaky = Object.entries(sum.tools)
    .filter(([, v]) => isFlaky(v))
    .sort((a, b) => errorShare(b[1]) - errorShare(a[1]))
    .slice(0, 2)
  for (const [tool, v] of flaky) {
    const pct = Math.round(errorShare(v) * 100)
    out.push({ key: `flaky:${tool}`, score: 38, tag: t.tag.flaky, color: 'yellow', text: t.flaky(tool, pct, v.calls, v.sessions, v.lastErr) })
  }

  for (const [server, v] of Object.entries(sum.servers)) {
    if (v.loaded >= UNUSED_SESSIONS && v.used === 0 && v.tokens >= UNUSED_TOKENS) {
      out.push({ key: `unused:${server}`, score: 20, tag: t.tag.unused, color: 'blue', text: t.unused(server.slice(5), v.loaded, kilo(v.tokens)) })
    }
  }

  const habit = Object.entries(sum.tools)
    .filter(([, v]) => v.big >= HABIT_BIG && v.sessions >= MIN_SESSIONS)
    .sort((a, b) => b[1].big - a[1].big)[0]
  if (habit) out.push({ key: `habit:${habit[0]}`, score: 18, tag: t.tag.habit, color: 'blue', text: t.habit(habit[0], habit[1].big, habit[1].sessions) })

  for (const f of learned.mem) out.push(memItem(f))
  return out
}

function memItem(f: MemFinding): Insight {
  const t = lt()
  const text = t.mem[f.kind](f.detail)
  return { key: `mem:${f.kind}:${f.file}:${f.detail}`, score: f.kind === 'missingIndex' || f.kind === 'staleRef' ? 32 : 22, tag: t.tag.memory, color: 'yellow', text, prompt: t.promptMemory(f.file, text) }
}
