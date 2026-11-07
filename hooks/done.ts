import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Check, Task } from '../types'
import { PROMPT_CHURN_EDITS } from './bench'
import { addNote, consult } from './advisor'
import { coverageGaps, doneGaps, droppedRuns, isDoc, isWithin, reaches, testCfg } from './gate'
import type { Target, TestRun } from './gate'
import { changedFiles, isWorkChanged, workState } from './git'
import type { WorkState } from './git'
import { relPath, SOURCE } from './sizeguard'
import { mergeEdit } from './testreview'
import type { Weakening } from './testreview'
import { mask, UNKNOWN_DIR } from './format'
import { notePrompt } from './learning'
import { cfg, INIT, isLive } from './state'

const agents = atom({ plugin: 'agentmon-live', key: 'agents' } as const, INIT.agents)
const checks = atom({ plugin: 'agentmon-live', key: 'checks' } as const, INIT.checks)
const files = atom({ plugin: 'agentmon-live', key: 'files' } as const, INIT.files)
const tasks = atom({ plugin: 'agentmon-live', key: 'tasks' } as const, INIT.tasks)
const testReview = atom({ plugin: 'agentmon-live', key: 'testReview' } as const, INIT.testReview)

// A finished turn with fewer main-loop tool calls, no edit and no subagent is too small to be worth a Fable call.
export const MIN_TOOLS_FOR_DONE_CHECK = 3
// How much material Fable gets; the request and the evidence stay whole, the oldest trail lines go first.
const MATERIAL_ROOM = 12000
const REQUEST_ROOM = 2000

// `before` holds the checks as they stood at the prompt; `codeEditAt` and `lastCodeEditAt` are the turn's first and last edit of a file that is not a doc.
// `docs` are the doc files the main loop read this turn; `edits` counts the edits per code file; `tests` every test run; `root` the project.
export type Turn = { prompt: string; startedAt: number; tools: number; delegated: number; trail: string[]; edited: Set<string>; edits: Map<string, number>; docs: Set<string>; before: Check[]; codeEditAt?: number; lastCodeEditAt?: number; tests: TestRun[]; root: string; testEdits: Set<string>; workAtStart?: Promise<WorkState | undefined> }

// A new prompt, or `/agentmon clear` mid-turn: everything the turn gathered goes, the prompt and its start stay.
export function resetTurn(turn: Turn, before: Check[]) {
  turn.tools = 0
  turn.delegated = 0
  turn.trail = []
  turn.edited = new Set()
  turn.edits = new Map()
  turn.docs = new Set()
  turn.tests = []
  turn.testEdits = new Set()
  turn.before = before
  turn.codeEditAt = undefined
  turn.lastCodeEditAt = undefined
}

// What a person should look at beside the passing result. It outlasts the turn until they put it away; a new edit waits for a new run.
export async function noteTestEdit($: EngineInterface, turn: Turn, path: string, found: Weakening, at: number) {
  turn.testEdits.add(path)
  await update($, testReview, r => ({ ...r, files: mergeEdit(r.files, path, found, at), isGreen: false }))
}

// Taken when the prompt comes in, without waiting: the turn need not hold for git.
export function noteWorkAtStart($: EngineInterface, turn: Turn) {
  turn.workAtStart = cfg.advisorMode === 'off' ? undefined : workState($, projectRoot(turn)).catch(() => undefined)
}

// `sed -i` or a script edits code with no edit tool call, and without this the gate would not know code changed.
// shortcut: the turn's start stands in for when it happened, so no check reads as stale; another session in the same folder counts too, and a new file the shell made is not seen; upgrade when false send-backs or misses show.
// The files it changed join the turn's edited files, so Fable's material and the test targets name them, also beside edit tool calls.
export async function noteShellEdit($: EngineInterface, turn: Turn) {
  if (turn.tools + turn.delegated === 0 || !turn.workAtStart) return
  const [before, now] = await Promise.all([turn.workAtStart, workState($, projectRoot(turn)).catch(() => undefined)])
  if (!before || !isWorkChanged(before, now)) return
  const root = projectRoot(turn)
  for (const path of changedFiles(before, now)) turn.edited.add(root === '/' ? `/${path}` : `${root}/${path}`)
  if (turn.lastCodeEditAt !== undefined) return
  turn.codeEditAt ??= turn.startedAt
  turn.lastCodeEditAt = turn.startedAt
}

const isTestEdited = (turn: Turn) => turn.testEdits.size > 0
const projectRoot = (turn: Turn) => turn.root.replace(/\/+$/, '') || '/'

// shortcut: a run in an edited test's package, or in a folder not known, counts, and one stands for all of them; upgrade when edits in two packages mislead.
export async function noteTestRun($: EngineInterface, turn: Turn) {
  const dropped = isTestEdited(turn) ? droppedRuns(turn.tests, turn.lastCodeEditAt) : []
  const root = projectRoot(turn)
  const dirs = await Promise.all((await read($, testReview)).files.map(f => packageRoot($, f.path.slice(0, f.path.lastIndexOf('/')) || '/', root)))
  await update($, testReview, r => {
    const last = turn.tests.filter(run => run.result !== 'running' && (run.dir === UNKNOWN_DIR || dirs.some(dir => reaches(run, dir)))).at(-1)
    return {
      ...r,
      dropped: [...new Map([...r.dropped, ...dropped].map(d => [JSON.stringify(d), d])).values()],
      isGreen: last === undefined ? r.isGreen : last.result === 'ok' && r.files.every(f => last.at >= f.at),
    }
  })
}

const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']
// Package root per directory, probed once a session.
const packageRoots = new Map<string, string>()

async function packageRoot($: EngineInterface, dir: string, root: string): Promise<string> {
  const known = packageRoots.get(dir)
  if (known !== undefined) return known
  const found = dir === root || !isWithin(dir, root) ? root
    : (await Promise.all(MANIFESTS.map(m => $.fs.exists(`${dir}/${m}`).catch(() => false)))).some(Boolean) ? dir
    : await packageRoot($, dir.slice(0, dir.lastIndexOf('/')) || '/', root)
  packageRoots.set(dir, found)
  return found
}

// Where each file edited this turn must be tested: the first `.agentmon-tests` rule its path matches, else a source file's nearest package root.
export async function targetsOf($: EngineInterface, turn: Turn): Promise<Target[]> {
  const root = projectRoot(turn)
  const byDir = new Map<string, Target>()
  for (const path of turn.edited) {
    const rel = relPath(path, root)
    if (isDoc(path) || rel === undefined || !path.startsWith('/')) continue
    const rule = testCfg.rules.find(r => r.re.test(rel))
    // Config, lockfiles and data have no tests of their own unless a rule says so.
    if (!rule && !SOURCE.test(path)) continue
    const dir = rule ? (rule.dir === '.' ? root : `${root === '/' ? '' : root}/${rule.dir}`) : await packageRoot($, path.slice(0, path.lastIndexOf('/')) || '/', root)
    const target = byDir.get(dir) ?? { dir, label: relPath(dir, root) || '.', files: [], isFull: false, min: 1, isDeclared: false }
    // Files that share a target add up: the strictest rule any of them matched holds, whatever the edit order.
    if (rule) {
      target.min = target.isDeclared ? Math.max(target.min, rule.min) : rule.min
      target.isFull ||= rule.isFull
      target.isDeclared = true
    }
    target.files.push(path.slice(path.lastIndexOf('/') + 1))
    byDir.set(dir, target)
  }
  return [...byDir.values()]
}

// The request, this turn's subagents and the observed checks are kept whole; the trail gives way.
async function material($: EngineInterface, turn: Turn): Promise<string> {
  const t = cfg.t
  const [list, checked, touched, planned] = await Promise.all([read($, agents), read($, checks), read($, files), read($, tasks)])
  const agentLines = list
    .filter(a => isLive(a) || a.startedAt >= turn.startedAt)
    .map(a => `- ${a.type}: ${a.status}${a.tests ? ` · ${a.tests} (${t.reported})` : ''} · ${a.task}`)
  const checkLines = checked.map(
    c => `- ${c.kind}: ${c.result}${c.result !== 'running' && touched.editedAt > c.at ? ` (${t.stale})` : ''}${c.ran !== undefined ? ` · ${t.testsRan(c.ran, c.skipped ?? 0)}` : ''} · ${c.dir ? `${c.dir}: ` : ''}${c.command}`,
  )
  const request = turn.prompt.slice(0, REQUEST_ROOM)
  const changed = [...turn.edited].slice(-50).join('\n')
  const openLines = planned.filter(k => k.status !== 'completed').map(k => `- ${k.status}: ${k.subject}`)
  const evidence = t.evidence(agentLines.join('\n'), checkLines.join('\n'), openLines.join('\n'))
  const room = MATERIAL_ROOM - t.material(request, '', changed).length - evidence.length
  let lines = turn.trail
  while (lines.length > 0 && lines.join('\n').length > room) lines = lines.slice(1)
  return t.material(request, lines.join('\n'), changed) + evidence
}

// shortcut: Fable sees no diff, so an extra inside an edited file shows only if the answer names it; upgrade when misses show in real sessions.
// What the turn left open: recorded facts first; only when they show nothing does Fable judge whether the answer covers the request and the work stayed within it.
// `judged` is false when no gap was found and Fable did not look (off, busy, failed, budget used): no verdict, not a pass.
export async function openGaps($: EngineInterface, turn: Turn, answer: string): Promise<{ lines: string[]; fix?: string; judged: boolean }> {
  const t = cfg.t
  const [checked, planned, list] = await Promise.all([read($, checks), read($, tasks), read($, agents)])
  const targets = await targetsOf($, turn)
  const lines = doneGaps(t, { checks: checked, before: turn.before, tasks: planned, agents: list, since: turn.startedAt, codeEditAt: turn.codeEditAt, lastCodeEditAt: turn.lastCodeEditAt, answer, runs: turn.tests, targets, isTestEdited: isTestEdited(turn) })
  if (lines.length > 0 || cfg.advisorMode !== 'all') return { lines, judged: true }
  const v = await consult($, t.askDone, `${await material($, turn)}${answer ? `\n\n${t.finalAnswer}:\n${mask(answer.slice(-8000)).slice(-4000)}` : ''}`)
  // Fable read untrusted tool output; what it says goes to Claude as a claim, never as a fact.
  return v && !v.ok ? { lines: [t.fableSays(mask(v.text))], fix: v.fix && t.fableSays(mask(v.fix)), judged: true } : { lines: [], judged: v !== undefined }
}

// This prompt's part of the self benchmark, recomputed at each main turn end and stop.
// `blockAt` is the prompt's tool count when the gate sent it back; `isPassed` when a stop found nothing open.
export async function benchPrompt($: EngineInterface, turn: Turn, blockAt: number | undefined, isPassed: boolean) {
  const [checked, now, targets] = await Promise.all([read($, checks), $.clock.now(), targetsOf($, turn)])
  const after = checked.filter(c => c.at >= (turn.lastCodeEditAt ?? Infinity) && c.result !== 'running')
  notePrompt({
    edit: turn.lastCodeEditAt !== undefined,
    verified: after.length > 0 && after.every(c => c.result === 'ok') && coverageGaps(cfg.t, turn.tests, targets, turn.lastCodeEditAt, { isOldFail: turn.before.some(b => b.kind === 'test' && b.result === 'failed'), isTestEdited: isTestEdited(turn) }).length === 0,
    churn: [...turn.edits.values()].some(n => n >= PROMPT_CHURN_EDITS),
    ms: turn.tools > 0 ? now - turn.startedAt : 0,
    block: blockAt !== undefined,
    acted: blockAt !== undefined && turn.tools > blockAt,
    passed: isPassed,
    calls: turn.tools,
  })
}

// "check now": the gate's own look, shown in the pane and never sent.
export async function checkNow($: EngineInterface, turn: Turn, answer: string, ref: string) {
  const found = await openGaps($, turn, answer)
  if (found.judged) await addNote($, { kind: 'check', ok: found.lines.length === 0, text: found.lines.join('\n'), fix: found.fix, ref, at: await $.clock.now() })
}
