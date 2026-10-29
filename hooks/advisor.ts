import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Note } from '../types'
import { cfg, INIT, listening } from './state'

const advisor = atom({ plugin: 'agentmon-live', key: 'advisor' } as const, INIT.advisor)

// A call that never returns would leave the advisor `checking`, and so silent, for the rest of the session.
const TIMEOUT_MS = 30_000

export type Verdict = { ok: boolean; text: string; fix?: string }

// One Fable call, awaited: undefined when it was not asked (off, busy, budget used) or gave no usable answer.
export async function consult($: EngineInterface, question: string, body: string): Promise<Verdict | undefined> {
  const adv = await read($, advisor)
  if (!listening(adv.isOn) || adv.state === 'checking') return undefined
  if (cfg.advisorBudget > 0 && adv.calls >= cfg.advisorBudget) {
    await update($, advisor, a => ({ ...a, state: 'budget' as const }))
    return undefined
  }
  // Session text is data, not instructions: it cannot close its own wrapper.
  const wrapped = `<session_material>\n${body.replace(/<\/session_material/gi, '<\\/session_material')}\n</session_material>`
  const epoch = adv.epoch ?? 0
  await update($, advisor, a => ({ ...a, calls: a.calls + 1, state: 'checking' as const }))
  const r = await $.model
    .complete({ model: cfg.advisorModel, effort: 'low', maxTokens: 300, timeoutMs: TIMEOUT_MS, system: cfg.t.advisorSystem, prompt: `${question}\n\n${wrapped}` })
    .catch(() => undefined)
  // Tokens spent count even when the answer below is dropped.
  const usage = r?.isAnswered ? r.usage : undefined
  const cur = await update($, advisor, a =>
    usage
      ? {
          ...a,
          tokensIn: (a.tokensIn ?? 0) + usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
          tokensOut: (a.tokensOut ?? 0) + usage.output_tokens,
        }
      : a,
  )
  // A clear, reload or toggle while Fable thought makes this answer stale; the clear already reset the state.
  if ((cur.epoch ?? 0) !== epoch) return undefined
  if (!r?.isAnswered) {
    const why = !r ? 'error' : r.reason === 'api-error' ? `${r.error}${r.status ? ` ${r.status}` : ''}` : r.reason
    await update($, advisor, a => ({ ...a, state: 'unavailable' as const, why }))
    return undefined
  }
  await update($, advisor, a => ({ ...a, state: 'idle' as const, why: undefined }))
  if (!listening(cur.isOn)) return undefined
  // Fable answers a headline, then a line `→ what would settle it`.
  const [head = '', ...rest] = r.text.split('\n').map(l => l.trim()).filter(Boolean)
  const text = rest.filter(l => !l.startsWith('→')).reduce((a, l) => `${a} ${l}`, head)
  const fix = rest.find(l => l.startsWith('→'))?.replace(/^→\s*/, '') || undefined
  // A verdict that reasons first may end in OK, on its own line or after a sentence; "not OK" is no pass.
  const ok = /^OK\b/i.test(text) || /(^|[.!]\s+)OK\.?$/i.test(rest.filter(l => !l.startsWith('→')).at(-1) ?? head)
  return { ok, text: ok ? '' : text, fix: ok ? undefined : fix }
}

// A gate result or a manual check, kept for the pane; `isSent` when it went back to Claude.
export async function addNote($: EngineInterface, note: Note) {
  await update($, advisor, a => ({ ...a, notes: [...a.notes, note].slice(-20) }))
}
