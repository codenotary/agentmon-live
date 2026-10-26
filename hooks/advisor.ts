import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Note } from '../types'
import { cfg, INIT, listening } from './state'

const advisor = atom({ plugin: 'agent-radar', key: 'advisor' } as const, INIT.advisor)

// Fable reads along and speaks up only when something looks off.
export function advise($: EngineInterface, kind: Note['kind'], question: string, material: string) {
  $.clock.after(0, async () => {
    const adv = await read($, advisor)
    if (!listening(adv.isOn)) return
    const epoch = adv.epoch ?? 0
    await update($, advisor, a => ({ ...a, calls: a.calls + 1 }))
    const r = await $.model.complete({
      model: cfg.advisorModel,
      effort: 'low',
      maxTokens: 300,
      system: cfg.t.advisorSystem,
      prompt: `${question}\n\n${material.slice(-12000)}`,
    })
    if (!r.isAnswered) return
    // A clear, reload or toggle while Fable thought makes this answer stale.
    const now = await read($, advisor)
    if ((now.epoch ?? 0) !== epoch || !listening(now.isOn)) return
    const text = r.text.trim()
    const ok = /^OK\b/i.test(text)
    await update($, advisor, a => ({ ...a, notes: [...a.notes, { kind, ok, text: ok ? '' : text }].slice(-6) }))
    if (!ok) $.ui.toast(`Fable: ${text}`)
  })
}
