import type { Bench, BenchRow, GapKind, PromptBench, SessionRecord } from '../types'
import { decimal, findCheck, kilo } from './format'
import { isDoc } from './gate'
import { LANGUAGES } from './i18n'
import type { Strings } from './i18n'
import { median } from './insights'
import { LEARN } from './learn-strings'
import { cfg } from './state'

// Rows kept per project for `/agentmon bench`: months of sessions, a few dozen KB.
export const KEEP_BENCH = 300
// Durations kept per session, enough for a median.
const KEEP_MS = 50
// Edits of one file in one prompt that count as churn.
export const PROMPT_CHURN_EDITS = 4
// A column needs this many sessions before its numbers say anything.
export const MIN_BENCH = 5
const WEEK_MS = 7 * 24 * 3600_000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// The first line of the done gate's Stop reason, in every language, to find it in a transcript.
const GATE = Object.values(LANGUAGES).map(l => l.gateReason('').split('\n')[0] ?? '')

// Each gap line the gate writes, in every language, as a pattern: the template with its values as wildcards.
// Most specific first, across languages: Fable may quote another gap, and a failed check's wording sits inside others (zh, ja).
const HOLE = '\u0001'
const gapPattern = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(HOLE, '.*')}$`, 's')
const TEMPLATES: [GapKind, (l: Strings) => string][] = [
  ['fable', l => l.fableSays(HOLE)],
  ['agent', l => l.gapAgent(HOLE, HOLE)],
  ['stale', l => l.gapStale(HOLE, HOLE)],
  ['claim', l => l.gapClaim(HOLE)],
  ['todos', l => l.gapTodos(HOLE as unknown as number, HOLE)],
  ['failed', l => l.gapFailed(HOLE, HOLE)],
]
const GAPS = TEMPLATES.flatMap(([kind, of]) => Object.values(LANGUAGES).map(l => [kind, gapPattern(of(l))] as const))

// The kinds of gap in one Stop-hook feedback, when the done gate wrote it; one per gap line.
export function gapKinds(feedback: string): GapKind[] {
  if (!GATE.some(g => g && feedback.includes(g))) return []
  const out: GapKind[] = []
  for (const line of feedback.split('\n')) {
    // `- → …` is a suggested fix, not a gap.
    if (!line.startsWith('- ') || line.startsWith('- →')) continue
    const hit = GAPS.find(([, re]) => re.test(line.slice(2)))
    if (hit) out.push(hit[0])
  }
  return out
}

const lb = () => (LEARN[cfg.lang] ?? LEARN.en!).bench

export function emptyBench(mod: boolean, live: boolean): Bench {
  return { mod, live, editTurns: 0, verified: 0, churn: 0, outTokens: 0, turnMs: [], blocks: 0, acted: 0, passed: 0, fable: 0 }
}

export function addPrompt(b: Bench, p: PromptBench): Bench {
  return {
    ...b,
    editTurns: b.editTurns + Number(p.edit),
    verified: b.verified + Number(p.edit && p.verified),
    churn: b.churn + Number(p.churn),
    turnMs: p.ms > 0 ? [...b.turnMs, p.ms].slice(-KEEP_MS) : b.turnMs,
    blocks: b.blocks + Number(p.block),
    acted: b.acted + Number(p.acted),
    passed: b.passed + Number(p.passed),
  }
}

// A session's row in place of its earlier one; a row recorded live is never replaced by one read back from its transcript.
export function upsertRow(rows: readonly BenchRow[], rec: SessionRecord): BenchRow[] {
  if (!rec.bench) return [...rows]
  if (!rec.bench.live && rows.some(r => r.id === rec.id && r.live)) return [...rows]
  const tools = Object.values(rec.tools)
  const row: BenchRow = {
    ...rec.bench,
    id: rec.id,
    at: rec.at,
    turns: rec.turns,
    calls: tools.reduce((n, t) => n + t.calls, 0),
    errors: tools.reduce((n, t) => n + t.errors, 0),
    compactions: rec.compactAt.length,
  }
  return [...rows.filter(r => r.id !== rec.id), row].sort((a, b) => a.at - b.at).slice(-KEEP_BENCH)
}

type Prompt = { t0: number; t1: number; tools: number; edits: Map<string, number>; lastEdit: number; checks: { seq: number; id: string; kind: string }[]; blockAt?: number }

// A message's or tool result's text: a plain string, or the text blocks joined.
export function textOf(content: unknown): string {
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c?.text ?? '').join('\n') : ''
}

// The same numbers from a transcript, main loop only. A resumed session repeats its entries, so each uuid and message counts once.
export function benchOf(text: string): Bench {
  let b = emptyBench(false, false)
  const seen = new Set<string>()
  const failed = new Set<string>()
  let p: Prompt | undefined
  let seq = 0
  const close = () => {
    if (!p) return
    // The last run of each kind after the last edit, as the pane keeps them: a test that failed and then passed passed.
    const after = [...new Map(p.checks.filter(c => c.seq > p!.lastEdit).map(c => [c.kind, c])).values()]
    b = addPrompt(b, {
      edit: p.lastEdit >= 0,
      verified: after.length > 0 && after.every(c => !failed.has(c.id)),
      churn: [...p.edits.values()].some(n => n >= PROMPT_CHURN_EDITS),
      ms: p.tools > 0 ? Math.max(0, p.t1 - p.t0) : 0,
      block: p.blockAt !== undefined,
      acted: p.blockAt !== undefined && p.tools > p.blockAt,
      passed: false,
    })
  }
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let o: Record<string, any>
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o.isSidechain) continue
    if (typeof o.uuid === 'string') {
      if (seen.has(o.uuid)) continue
      seen.add(o.uuid)
    }
    const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) || 0 : 0
    const content = o.message?.content
    if (o.type === 'assistant' && o.message) {
      const id = o.message.id
      if (typeof id !== 'string' || !seen.has(`m:${id}`)) {
        if (typeof id === 'string') seen.add(`m:${id}`)
        b.outTokens += Number(o.message.usage?.output_tokens) || 0
      }
      if (!p) continue
      if (at) p.t1 = at
      for (const c of Array.isArray(content) ? content : []) {
        if (c?.type !== 'tool_use') continue
        p.tools += 1
        seq += 1
        const file = c.input?.file_path ?? c.input?.notebook_path
        if (EDIT_TOOLS.has(c.name) && typeof file === 'string' && !isDoc(file)) {
          p.edits.set(file, (p.edits.get(file) ?? 0) + 1)
          p.lastEdit = seq
        } else if (c.name === 'Bash' && typeof c.input?.command === 'string') {
          const found = findCheck(c.input.command)
          if (found) p.checks.push({ seq, id: c.id, kind: found.kind })
        }
      }
    } else if (o.type === 'user' && !o.isCompactSummary) {
      if (Array.isArray(content) && content.some((c: { type?: string }) => c?.type === 'tool_result')) {
        for (const c of content) if (c?.type === 'tool_result' && c.is_error) failed.add(c.tool_use_id)
        continue
      }
      const said = textOf(content)
      if (said.startsWith('Stop hook feedback:')) {
        if (GATE.some(g => g && said.includes(g))) {
          b.mod = true
          if (p) p.blockAt = p.tools
        }
        continue
      }
      // Stop-hook feedback is meta too, so it is looked at first.
      if (o.isMeta || !said.trim() || /^(<local-command|\[Request interrupted)/.test(said)) continue
      close()
      p = { t0: at, t1: at, tools: 0, edits: new Map(), lastEdit: -1, checks: [] }
    }
  }
  close()
  return b
}

// `/agentmon bench`: sessions without the mod, with it, and with it in the last 7 days, side by side.
export function benchReport(rows: readonly BenchRow[], now: number): string {
  const t = lb()
  if (rows.length === 0) return t.none
  const cols = [rows.filter(r => !r.mod), rows.filter(r => r.mod), rows.filter(r => r.mod && r.at >= now - WEEK_MS)]
  const sum = (rs: readonly BenchRow[], f: (r: BenchRow) => number) => rs.reduce((n, r) => n + f(r), 0)
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–')
  const metrics: [string, (rs: readonly BenchRow[]) => string, boolean?][] = [
    [t.verified, rs => pct(sum(rs, r => r.verified), sum(rs, r => r.editTurns))],
    [t.churn, rs => pct(sum(rs, r => r.churn), sum(rs, r => r.editTurns))],
    [t.errors, rs => pct(sum(rs, r => r.errors), sum(rs, r => r.calls))],
    [t.compactions, rs => decimal(sum(rs, r => r.compactions) / rs.length)],
    [t.turnTime, rs => {
      const m = median(rs.flatMap(r => r.turnMs))
      return m === undefined ? '–' : `${Math.round(m / 1000)}s`
    }],
    [t.outTokens, rs => {
      const n = sum(rs, r => r.turns)
      return n > 0 ? kilo(Math.round(sum(rs, r => r.outTokens) / n)) : '–'
    }],
    // The gate exists only with the mod.
    [t.blocks, rs => String(sum(rs, r => r.blocks)), true],
    [t.acted, rs => pct(sum(rs, r => r.acted), sum(rs, r => r.blocks)), true],
    [t.passed, rs => String(sum(rs, r => r.passed)), true],
    [t.fable, rs => String(sum(rs, r => r.fable)), true],
  ]
  const table = [
    ['', ...cols.map((rs, i) => `${t.cols[i]} (${rs.length})`)],
    ...metrics.map(([label, f, modOnly]) => [label, ...cols.map((rs, i) => (rs.length < MIN_BENCH || (modOnly && i === 0) ? '–' : f(rs)))]),
  ]
  // shortcut: pads by string length, so CJK labels sit a little off; pad by display width if that bothers.
  const width = table[0]!.map((_, i) => Math.max(...table.map(r => r[i]!.length)))
  const lines = table.map(r => r.map((c, i) => (i === 0 ? c.padEnd(width[0]!) : c.padStart(width[i]!))).join('  ').trimEnd())
  return [t.head, '```', ...lines, '```', t.note(MIN_BENCH)].join('\n')
}
