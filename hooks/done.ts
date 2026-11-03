import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Check, Task } from '../types'
import { PROMPT_CHURN_EDITS } from './bench'
import { addNote, consult } from './advisor'
import { coverageGaps, doneGaps, isDoc, isWithin, testCfg } from './gate'
import type { Target, TestRun } from './gate'
import { relPath, SOURCE } from './sizeguard'
import { mask } from './format'
import { notePrompt } from './learning'
import { cfg, INIT, isLive } from './state'

const agents = atom({ plugin: 'agentmon-live', key: 'agents' } as const, INIT.agents)
const checks = atom({ plugin: 'agentmon-live', key: 'checks' } as const, INIT.checks)
const files = atom({ plugin: 'agentmon-live', key: 'files' } as const, INIT.files)
const tasks = atom({ plugin: 'agentmon-live', key: 'tasks' } as const, INIT.tasks)

// A finished turn with fewer main-loop tool calls, no edit and no subagent is too small to be worth a Fable call.
export const MIN_TOOLS_FOR_DONE_CHECK = 3
// How much material Fable gets; the request and the evidence stay whole, the oldest trail lines go first.
const MATERIAL_ROOM = 12000
const REQUEST_ROOM = 2000

// `before` holds the checks as they stood at the prompt; `codeEditAt` and `lastCodeEditAt` are the turn's first and last edit of a file that is not a doc.
// `docs` are the doc files the main loop read this turn; `edits` counts the edits per code file; `tests` every test run; `root` the project.
export type Turn = { prompt: string; startedAt: number; tools: number; delegated: number; trail: string[]; edited: Set<string>; edits: Map<string, number>; docs: Set<string>; before: Check[]; codeEditAt?: number; lastCodeEditAt?: number; tests: TestRun[]; root: string }

// A new prompt, or `/agentmon clear` mid-turn: everything the turn gathered goes, the prompt and its start stay.
export function resetTurn(turn: Turn, before: Check[]) {
  turn.tools = 0
  turn.delegated = 0
  turn.trail = []
  turn.edited = new Set()
  turn.edits = new Map()
  turn.docs = new Set()
  turn.tests = []
  turn.before = before
  turn.codeEditAt = undefined
  turn.lastCodeEditAt = undefined
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
  const root = turn.root.replace(/\/+$/, '') || '/'
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

// What the turn left open: recorded facts first; only when they show nothing does Fable judge whether the answer covers the request.
// `judged` is false when no gap was found and Fable did not look (off, busy, failed, budget used): no verdict, not a pass.
export async function openGaps($: EngineInterface, turn: Turn, answer: string): Promise<{ lines: string[]; fix?: string; judged: boolean }> {
  const t = cfg.t
  const [checked, planned, list] = await Promise.all([read($, checks), read($, tasks), read($, agents)])
  const targets = await targetsOf($, turn)
  const lines = doneGaps(t, { checks: checked, before: turn.before, tasks: planned, agents: list, since: turn.startedAt, codeEditAt: turn.codeEditAt, lastCodeEditAt: turn.lastCodeEditAt, answer, runs: turn.tests, targets })
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
    verified: after.length > 0 && after.every(c => c.result === 'ok') && coverageGaps(cfg.t, turn.tests, targets, turn.lastCodeEditAt, turn.before.some(b => b.kind === 'test' && b.result === 'failed')).length === 0,
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
