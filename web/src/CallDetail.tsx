import * as Dialog from '@radix-ui/react-dialog'
import { Copy, X } from 'lucide-react'

import type { WebSnapshot } from '../../types/index'

import { agentNames, callTime, resultOf, time, traceResult, whoOf } from './format.ts'
import type { Labels } from './labels.ts'
import { copyText } from './Palette.tsx'
import { set, useStore } from './store.ts'
import { Pill } from './ui/Pill.tsx'

export function CallDetail({ l, s }: { l: Labels | undefined; s: WebSnapshot | undefined }) {
  const { call } = useStore()
  if (!call || !l) return null
  // Opened while running, it follows the call to its end.
  const live = s?.trace?.find(c => c.id === call.id)
  const ms = live?.ms ?? call.ms
  const error = live?.error ?? call.error
  const result = live ? traceResult(live, s?.active.some(a => a.id === call.id) ?? false) : call.result
  const who = whoOf(call, agentNames(s?.agents ?? []))
  const p = l.page
  const r = resultOf(result, l)
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) set({ call: null }) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined} data-testid="drawer">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Dialog.Title className="font-display text-base font-bold">{p.details}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="×"><X size={14} aria-hidden /></Dialog.Close>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <Pill text={r.text} tone={r.tone} />
            <b>{who}</b>
            <span className="text-ink-3 tabular-nums">{time(call.at)}</span>
            <span className="text-ink-3">{l.cat[call.view] ?? call.view}</span>
            {ms === undefined ? null : <span className="text-ink-3 tabular-nums">{callTime(ms)}</span>}
          </div>
          <span className="eyebrow">{p.what}</span>
          <pre className="mt-1 mb-3 rounded-lg bg-surface-1 p-3 font-mono text-xs break-words whitespace-pre-wrap">{call.what}</pre>
          {error ? (
            <>
              <span className="eyebrow">{p.error}</span>
              <pre className="mt-1 mb-3 rounded-lg bg-bad-soft p-3 font-mono text-xs break-words whitespace-pre-wrap text-bad">{error}</pre>
            </>
          ) : null}
          <button type="button" className="icon-btn" onClick={() => void copyText(call.what, p.copied)}><Copy size={13} aria-hidden />{p.copy}</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
