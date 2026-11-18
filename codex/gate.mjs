// Codex's Stop hook: the done gate's core, from the chat's rollout. Fails open: any error lets Codex stop.
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { foldRollout } from '../server/codex.mjs'
import { lines } from '../server/kiro.mjs'

// Same list as `DOC_TYPES` in `hooks/gate.ts`, which Node cannot load: prose cannot break a check.
const DOC = /\.(md|mdx|markdown|txt|rst|adoc)$/i

// shortcut: failed and stale checks only, not the coverage, claim, todo and subagent gaps of `doneGaps` in `hooks/gate.ts`; port them when Codex chats need them.
// shortcut: a path's last edit stands in for the turn's first, so a failure between two edits of one file counts as old; keep edit times per call if that lets work through.
export function codexGaps(snapshot) {
  const since = snapshot.turns.at(-1)?.startedAt
  if (since === undefined) return []
  const edits = Object.entries(snapshot.files.editedTimes ?? {}).flatMap(([path, at]) => (at >= since && !DOC.test(path) ? [at] : []))
  if (edits.length === 0) return []
  const first = Math.min(...edits)
  const last = Math.max(...edits)
  return snapshot.checks.flatMap(c => {
    if (c.at < since || c.result === 'running') return []
    if (c.result === 'failed' && c.at > first) return [`${c.kind} failed: ${c.command}`]
    return last > c.at ? [`${c.kind} ran before the last edit: ${c.command}`] : []
  })
}

export function stopAnswer(hook, now) {
  // Codex is already going on because of this gate: a second block could loop.
  if (hook.stop_hook_active || !hook.transcript_path) return undefined
  const gaps = codexGaps(foldRollout(lines(readFileSync(hook.transcript_path, 'utf8')), now).snapshot)
  if (gaps.length === 0) return undefined
  return { decision: 'block', reason: `Before you report done, this looks unfinished:\n${gaps.map(g => `- ${g}`).join('\n')}\n\nFinish it, or say plainly why not.` }
}

function isMain() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMain()) {
  try {
    const answer = stopAnswer(JSON.parse(readFileSync(0, 'utf8')), Date.now())
    if (answer) process.stdout.write(JSON.stringify(answer))
  } catch {}
}
