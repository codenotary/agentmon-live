import { atom, read, update } from 'claude-code'
import type { ContextMcpTool, EngineInterface } from 'claude-code'

import type { Bench, BenchRow, Learned, PromptBench, SessionRecord } from '../types'
import { addPrompt, benchReport, emptyBench, gapKinds, KEEP_BENCH, upsertRow } from './bench'
import { debug } from './debuglog'
import { addGaps, KEEP_SESSIONS, lt, newRecord, parseTranscript, serverOf, shapeLearned, storeKey, tally, totals, upsert, isFlaky, errorShare } from './learn'
import { memRules, refsOf } from './memcheck'
import type { MemFile } from './memcheck'
import { keysOf, oldestOfOthers, rowKey, sameId, sessKey, toDrop } from './records'
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

// Writes run one after another inside this session, so a memory check and a turn end that overlap do not interleave.
let saving = Promise.resolve()
function queue(job: () => Promise<void>): Promise<void> {
  saving = saving.then(job).catch(() => undefined)
  return saving
}

const EVICT_ROUNDS = 5
const EVICT_BATCH = 20

function keysNow($: EngineInterface): Promise<string[]> {
  return $.store.keys().catch(() => [])
}
function valueOf<T>($: EngineInterface, key: string): Promise<T | undefined> {
  return $.store.get(key).then(v => v as T | undefined, () => undefined)
}

// shortcut: a second failed write of any kind is taken for a full store; match the host's cap error once known.
async function putRoom($: EngineInterface, key: string, value: unknown): Promise<boolean> {
  for (let round = 0; round < EVICT_ROUNDS; round++) {
    if (await $.store.set(key, value).then(() => true, () => false)) return true
    if (round === 0) continue
    const victims = oldestOfOthers(await keysNow($), cwd, EVICT_BATCH)
    if (victims.length === 0) return false
    await dropKeys($, victims)
    void debug($, 'store.evict', { keys: victims.length })
  }
  return false
}

async function dropKeys($: EngineInterface, keys: readonly string[]) {
  for (const k of keys) await $.store.delete(k).catch(() => undefined)
}

// Returns whether the row is stored; a live row is not replaced by a transcript's copy, which counts as stored.
async function putRow($: EngineInterface, row: BenchRow, keys: readonly string[]): Promise<boolean> {
  const key = rowKey(cwd, row)
  const same = sameId(keys, 'row', cwd, row.id, key)
  const current = await Promise.all(same.map(k => valueOf<BenchRow>($, k)))
  if (!row.live && current.some(c => c?.live)) return true
  if (!(await putRoom($, key, row))) return false
  await dropKeys($, same)
  return true
}

// Keeps the last KEEP_SESSIONS sessions and KEEP_BENCH bench rows of this project.
async function prune($: EngineInterface) {
  const keys = await keysNow($)
  await dropKeys($, [...toDrop(keys, 'sess', cwd, KEEP_SESSIONS), ...toDrop(keys, 'row', cwd, KEEP_BENCH)])
}

// Returns whether the session and its bench row are stored.
async function putSession($: EngineInterface, r: SessionRecord): Promise<boolean> {
  const keys = await keysNow($)
  const key = sessKey(cwd, r)
  if (!(await putRoom($, key, r))) return false
  await dropKeys($, sameId(keys, 'sess', cwd, r.id, key))
  const [row] = upsertRow([], r)
  const isRowStored = row ? await putRow($, row, keys) : true
  await prune($)
  return isRowStored
}

// The last `keep` records of one id each, oldest first.
function mergeById<T extends { id: string; at: number }>(list: T[], keep: number): T[] {
  return [...new Map(list.map(x => [x.id, x] as const)).values()].sort((a, b) => a.at - b.at).slice(-keep)
}

// This project as the store holds it: its sessions and bench rows, and the memory findings. `entry` is the old single entry when the caller has read it already.
async function loadProject($: EngineInterface, entry?: Learned): Promise<Learned> {
  const keys = await keysNow($)
  const [sessions, rows, legacy] = await Promise.all([
    Promise.all(keysOf(keys, 'sess', cwd).slice(-KEEP_SESSIONS).map(k => valueOf<SessionRecord>($, k))),
    Promise.all(keysOf(keys, 'row', cwd).slice(-KEEP_BENCH).map(k => valueOf<BenchRow>($, k))),
    entry === undefined ? valueOf<Learned>($, storeKey(cwd)) : Promise.resolve(entry),
  ])
  // The old single entry may still hold sessions and rows an unfinished migration left behind; the keys win.
  const old = shapeLearned(legacy)
  return {
    current: '',
    mem: old.mem,
    sessions: mergeById([...old.sessions, ...sessions.filter((s): s is SessionRecord => s !== undefined)], KEEP_SESSIONS),
    bench: mergeById([...old.bench, ...rows.filter((r): r is BenchRow => r !== undefined)], KEEP_BENCH),
  }
}

// Moves sessions and bench rows out of the old single entry into their own keys; the entry keeps the memory findings.
async function migrate($: EngineInterface, entry: Learned | undefined) {
  const old = shapeLearned(entry)
  if (old.sessions.length === 0 && old.bench.length === 0) return
  let isAllMoved = true
  for (const r of old.sessions) if (!(await putSession($, r))) isAllMoved = false
  for (const row of old.bench) if (!(await putRow($, row, await keysNow($)))) isAllMoved = false
  // The old entry is cleared only once every session and row is in its own key; otherwise loadProject still reads it.
  if (isAllMoved) await putRoom($, storeKey(cwd), { mem: old.mem, sessions: [], bench: [] })
}

export async function startLearning($: EngineInterface, dir: string) {
  cwd = dir
  if (!cfg.learning) return
  const [id, now] = await Promise.all([$.session.id(), $.clock.now()])
  const entry = await valueOf<Learned>($, storeKey(cwd))
  await queue(() => migrate($, entry))
  const stored = await loadProject($, entry)
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

// The done gate sent the turn back: what it found, read from its own words as a transcript would be.
export function noteGaps(feedback: string) {
  if (rec) addGaps(rec, gapKinds(feedback))
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
  const copy = structuredClone(r)
  await queue(async () => {
    await putSession($, copy)
  })
  await update($, learned, l => ({ ...upsert(l, copy), current: copy.id }))
}

// `/agentmon learn [dir]`: past transcripts of this project, or of `dir`, into the store.
export async function learnCommand($: EngineInterface, arg: string): Promise<string> {
  const t = lt()
  if (!cfg.learning || !rec) return t.learningOff
  const { conf } = await configDir($)
  const dir = arg || `${conf}/projects/${slug(cwd)}`
  // Only the newest KEEP_BENCH can be kept, so older files are not read at all.
  const entries = (await $.fs.list(dir).catch(() => []))
    .filter(e => e.kind === 'file' && e.name.endsWith('.jsonl'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, KEEP_BENCH)
  if (entries.length === 0) return t.learnNone(dir)
  // A session recorded live knows more (MCP schemas, window, effort) than its transcript: keep it.
  // One from a version that did not count the done gate's catches gets only those from its transcript.
  const have = new Map((await loadProject($)).sessions.map(s => [s.id, s]))
  const recs: SessionRecord[] = []
  const filled: SessionRecord[] = []
  let skipped = 0
  for (const e of entries) {
    const id = e.name.slice(0, -'.jsonl'.length)
    const old = have.get(id)
    if (id === rec.id || (old && old.gaps)) continue
    const path = `${dir}/${e.name}`
    // shortcut: a transcript over the 4 MiB read cap is learned from its last 4 MiB only; read it in parts if early turns matter.
    const text = await $.fs.read(path).catch(async () => {
      const r = await $.process.run(['tail', '-c', '4000000', path]).catch(() => undefined)
      return r?.exitCode === 0 ? r.stdout : undefined
    })
    if (text === undefined) skipped++
    else if (old) filled.push({ ...old, gaps: parseTranscript(id, text).gaps })
    else {
      const r = parseTranscript(id, text)
      // A session that ran with the mod left an `active:` key, gate block or not.
      if (r.bench && (await $.store.get(`active:${id}`).catch(() => undefined))) r.bench.mod = true
      recs.push(r)
    }
  }
  await queue(async () => {
    for (const r of [...filled, ...recs]) await putSession($, r)
  })
  await update($, learned, l => [...filled, ...recs].reduce(upsert, l))
  const calls = recs.reduce((n, r) => n + Object.values(r.tools).reduce((m, x) => m + x.calls, 0), 0)
  const compactions = recs.reduce((n, r) => n + r.compactAt.length, 0)
  return t.learned(recs.length, calls, compactions, skipped)
}

// `/agentmon bench`: this project's sessions with and without the mod, this one included as it stands.
export async function benchCommand($: EngineInterface): Promise<string> {
  if (!cfg.learning || !rec) return lt().learningOff
  const [stored, now] = await Promise.all([loadProject($), $.clock.now()])
  return benchReport(upsertRow(stored.bench, rec), now)
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
  await queue(async () => {
    const { current: _, ...kept } = { ...shapeLearned(await valueOf<Learned>($, storeKey(cwd))), mem }
    await putRoom($, storeKey(cwd), kept)
  })
  await update($, learned, l => ({ ...l, mem }))
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
