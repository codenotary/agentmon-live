import { atom, read, update } from 'claude-code'
import type { ContextMcpTool, EngineInterface } from 'claude-code'

import type { Bench, Learned, PromptBench, SessionRecord } from '../types'
import { addPrompt, benchReport, emptyBench, upsertRow } from './bench'
import { lt, newRecord, parseTranscript, serverOf, shapeLearned, storeKey, tally, totals, upsert, isFlaky, errorShare } from './learn'
import { memRules, refsOf } from './memcheck'
import type { MemFile } from './memcheck'
import { cfg, INIT } from './state'

const learned = atom({ plugin: 'agentmon-live', key: 'learned' } as const, INIT.learned)

// This session's own record; it is rebuilt from the store on a reload.
let rec: SessionRecord | undefined
// The session's bench as it stood when this prompt came in: each turn end recomputes the prompt's part from it, so a turn the done gate sent back counts once.
let base: Bench | undefined
let cwd = ''
let memQueued = false
const warned = new Set<string>()

async function configDir($: EngineInterface): Promise<{ conf: string; home: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  return { conf: (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`, home }
}

// The project's folder under `projects/`, as Claude Code names it.
export function slug(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-')
}

export function isMemoryPath(path: string): boolean {
  return /(^|\/)(CLAUDE(\.local)?\.md|MEMORY\.md)$|\/memory\/[^/]+\.md$/.test(path)
}

// Reads the store again before writing, so a second session in the same project keeps its own record.
async function save($: EngineInterface, change: (l: Learned) => Learned) {
  const key = storeKey(cwd)
  const next = change(shapeLearned(await $.store.get(key).catch(() => undefined)))
  const { current: _, ...kept } = next
  // shortcut: a store over its 4 MiB cap rejects the write and this session's learning is lost; trim old projects if that shows up.
  await $.store.set(key, kept).catch(() => undefined)
  const id = rec?.id ?? ''
  await update($, learned, () => ({ ...next, current: id }))
}

export async function startLearning($: EngineInterface, dir: string) {
  cwd = dir
  if (!cfg.learning) return
  const [id, now] = await Promise.all([$.session.id(), $.clock.now()])
  const stored = shapeLearned(await $.store.get(storeKey(cwd)).catch(() => undefined))
  rec = stored.sessions.find(s => s.id === id) ?? newRecord(id, now)
  await update($, learned, () => ({ ...stored, current: id }))
  queueMemoryCheck($)
}

// Every tool call, main loop and subagents; a known-flaky tool gets one toast the first time this session.
export async function noteCall($: EngineInterface, tool: string, isError: boolean, error: string, resultTokens: number) {
  if (!rec) return
  tally(rec, tool, isError, error, resultTokens)
  if (warned.has(tool)) return
  warned.add(tool)
  const t = totals(await read($, learned)).tools[tool]
  if (t && isFlaky(t)) $.ui.toast(lt().flakyToast(tool, Math.round(errorShare(t) * 100)))
}

export function newPrompt() {
  base = rec?.bench
}

export function notePrompt(p: PromptBench) {
  if (!rec) return
  base ??= rec.bench ?? emptyBench(true, true)
  rec.bench = { ...addPrompt(base, p), mod: true, live: true, outTokens: rec.bench?.outTokens ?? 0, fable: rec.bench?.fable ?? 0 }
}

export function noteCompact(tokens: number | undefined) {
  if (rec && tokens) rec.compactAt.push(tokens)
}

// The end of each main turn: the session's record so far replaces its earlier one in the store.
export async function saveTurn($: EngineInterface, u: { tokens?: number; window: number; mcpTools: readonly ContextMcpTool[]; model: string; effort: string; outTokens: number; fable: number }) {
  if (!rec) return
  const r = rec
  // Session totals; the larger one survives a reload or `/agentmon clear`, which start them again from 0.
  const b = r.bench ?? emptyBench(true, true)
  r.bench = { ...b, mod: true, live: true, outTokens: Math.max(b.outTokens, u.outTokens), fable: Math.max(b.fable, u.fable) }
  r.turns += 1
  r.peak = Math.max(r.peak, u.tokens ?? 0)
  r.window = u.window
  r.model = u.model || r.model
  r.effort = u.effort || r.effort
  const mcp: Record<string, number> = {}
  for (const m of u.mcpTools) {
    const server = serverOf(m.name)
    if (server && m.isLoaded) mcp[server] = (mcp[server] ?? 0) + m.tokens
  }
  r.mcp = mcp
  await save($, l => upsert(l, structuredClone(r)))
}

// `/agentmon learn [dir]`: past transcripts of this project, or of `dir`, into the store.
export async function learnCommand($: EngineInterface, arg: string): Promise<string> {
  const t = lt()
  if (!cfg.learning || !rec) return t.learningOff
  const { conf } = await configDir($)
  const dir = arg || `${conf}/projects/${slug(cwd)}`
  const entries = (await $.fs.list(dir).catch(() => [])).filter(e => e.kind === 'file' && e.name.endsWith('.jsonl'))
  if (entries.length === 0) return t.learnNone(dir)
  const recs: SessionRecord[] = []
  let skipped = 0
  for (const e of entries) {
    const id = e.name.slice(0, -'.jsonl'.length)
    if (id === rec.id) continue
    const path = `${dir}/${e.name}`
    // shortcut: a transcript over the 4 MiB read cap is learned from its last 4 MiB only; read it in parts if early turns matter.
    const text = await $.fs.read(path).catch(async () => {
      const r = await $.process.run(['tail', '-c', '4000000', path]).catch(() => undefined)
      return r?.exitCode === 0 ? r.stdout : undefined
    })
    if (text === undefined) skipped++
    else {
      const r = parseTranscript(id, text)
      // A session that ran with the mod left an `active:` key, gate block or not.
      if (r.bench && (await $.store.get(`active:${id}`).catch(() => undefined))) r.bench.mod = true
      recs.push(r)
    }
  }
  await save($, l => recs.reduce(upsert, l))
  const calls = recs.reduce((n, r) => n + Object.values(r.tools).reduce((m, x) => m + x.calls, 0), 0)
  const compactions = recs.reduce((n, r) => n + r.compactAt.length, 0)
  return t.learned(recs.length, calls, compactions, skipped)
}

// `/agentmon bench`: this project's sessions with and without the mod, this one included as it stands.
export async function benchCommand($: EngineInterface): Promise<string> {
  if (!cfg.learning || !rec) return lt().learningOff
  const [stored, now] = await Promise.all([$.store.get(storeKey(cwd)).catch(() => undefined), $.clock.now()])
  return benchReport(upsertRow(shapeLearned(stored).bench, rec), now)
}

export function queueMemoryCheck($: EngineInterface) {
  if (memQueued || !cfg.learning) return
  memQueued = true
  $.clock.after(1000, async () => {
    memQueued = false
    await checkMemory($).catch(() => undefined)
  })
}

// The memory and instruction files the session loads, plus the project's auto-memory folder.
async function checkMemory($: EngineInterface) {
  const { conf, home } = await configDir($)
  const memDir = `${conf}/projects/${slug(cwd)}/memory`
  const [u, entries] = await Promise.all([$.session.usage({ breakdown: 'summary' }).catch(() => undefined), $.fs.list(memDir).catch(() => [])])
  const dir = entries.filter(e => e.kind === 'file').map(e => e.name)
  const paths = [...new Set([...(u?.context.breakdown?.memoryFiles.map(m => m.path) ?? []), ...dir.filter(n => n.endsWith('.md')).map(n => `${memDir}/${n}`)])]
  const files: MemFile[] = []
  for (const path of paths) {
    const text = await $.fs.read(path).catch(() => undefined)
    if (text !== undefined) files.push({ path, text, inDir: path.startsWith(`${memDir}/`) })
  }
  const missing = new Map<string, string>()
  for (const [ref, file] of refsOf(files, home)) {
    // A ref whose top folder is missing (`/api/config`) is a URL route, not a path.
    if (!(await $.fs.exists(ref.slice(0, ref.indexOf('/', 1))).catch(() => true))) continue
    if (!(await $.fs.exists(ref).catch(() => true))) missing.set(ref, file)
  }
  const mem = memRules(files, dir, missing)
  await save($, l => ({ ...l, mem }))
}

// `/agentmon memory`: the findings as text, checked again first.
export async function memoryCommand($: EngineInterface): Promise<string> {
  const t = lt()
  if (!cfg.learning || !rec) return t.learningOff
  await checkMemory($)
  const { mem } = await read($, learned)
  if (mem.length === 0) return t.memoryNone
  return [t.memoryHead(mem.length), ...mem.map(f => `- ${t.mem[f.kind](f.detail)}`)].join('\n')
}
