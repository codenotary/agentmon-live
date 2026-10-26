import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Note } from '../types'
import { cfg, INIT, listening } from './state'

const advisor = atom({ plugin: 'agent-radar', key: 'advisor' } as const, INIT.advisor)

// The same kind of automatic check runs at most once a minute; a manual check skips the wait.
const COOLDOWN_MS = 60_000
// A call that never returns would leave the advisor `checking`, and so silent, for the rest of the session.
const TIMEOUT_MS = 30_000

// A short fingerprint of what Fable is asked, so the same question is not sent twice in a row.
export function fingerprint(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `${s.length}:${h}`
}

// Fable reads along and speaks up only when something looks off.
// `ref` is the evidence an objection points back to; `isManual` is the person's own "check now".
// `material` may be a thunk, so it is only built once Fable is actually going to be asked.
export function advise($: EngineInterface, kind: Note['kind'], question: string, material: string | (() => Promise<string>), ref: string, isManual = false) {
  $.clock.after(0, async () => {
    const adv = await read($, advisor)
    if (!listening(adv.isOn) || adv.state === 'checking') return
    if (cfg.advisorBudget > 0 && adv.calls >= cfg.advisorBudget) {
      await update($, advisor, a => ({ ...a, state: 'budget' as const }))
      return
    }
    const now = await $.clock.now()
    const lastAt = adv.lastAt?.[kind]
    if (!isManual && lastAt !== undefined && now - lastAt < COOLDOWN_MS) return
    const body = typeof material === 'string' ? material : await material()
    const key = `${kind}|${fingerprint(body)}`
    if (!isManual && adv.lastKey === key) return
    // Session text is data, not instructions: it cannot close its own wrapper.
    const wrapped = `<session_material>\n${body.replace(/<\/session_material/gi, '<\\/session_material')}\n</session_material>`
    const epoch = adv.epoch ?? 0
    await update($, advisor, a => ({ ...a, calls: a.calls + 1, state: 'checking' as const, lastKey: key, lastAt: { ...a.lastAt, [kind]: now } }))
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
    if ((cur.epoch ?? 0) !== epoch) return
    if (!r?.isAnswered) {
      const why = !r ? 'error' : r.reason === 'api-error' ? `${r.error}${r.status ? ` ${r.status}` : ''}` : r.reason
      await update($, advisor, a => ({ ...a, state: 'unavailable' as const, why }))
      return
    }
    await update($, advisor, a => ({ ...a, state: 'idle' as const, why: undefined }))
    if (!listening(cur.isOn)) return
    const text = r.text.trim()
    const ok = /^OK\b/i.test(text)
    // The same objection again adds no new note and no new toast.
    if (!ok && cur.notes.at(-1)?.text === text) return
    await update($, advisor, a => ({ ...a, notes: [...a.notes, { kind, ok, text: ok ? '' : text, ref }].slice(-6) }))
    if (!ok) $.ui.toast(`Fable: ${text}`)
  })
}
