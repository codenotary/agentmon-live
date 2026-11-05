import { Command } from 'cmdk'
import { Copy, Filter, Monitor, Moon, MoveRight, PanelRightClose, PanelRightOpen, Sun, SwitchCamera } from 'lucide-react'

import type { WebSnapshot } from '../../types/index'
import { sessionNames } from './format.ts'
import type { Page } from './labels.ts'
import { jumpTo, type Section } from './Nav.tsx'
import { notify, pick, requestPane, set, setTheme, useStore } from './store.ts'

export async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notify(done)
  } catch {
    notify(text, true)
  }
}

export function Palette({ s, p, sections }: { s: WebSnapshot | undefined; p: Page; sections: Section[] }) {
  const st = useStore()
  const close = () => set({ isPaletteOpen: false })
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  return (
    <Command.Dialog open={st.isPaletteOpen} onOpenChange={open => set({ isPaletteOpen: open })} label={p.commands} overlayClassName="overlay">
      <Command.Input placeholder={p.paletteHint} />
      <Command.List>
        <Command.Empty>{p.noMatch}</Command.Empty>
        <Command.Group heading={p.actions}>
          <Command.Item onSelect={run(() => { set({ onlyFailures: !st.onlyFailures }); jumpTo('calls') })}><Filter size={14} aria-hidden />{st.onlyFailures ? p.showAll : p.onlyFailures}</Command.Item>
          {s?.v === 1 && s.isPaneOpen !== undefined ? <Command.Item onSelect={run(() => requestPane(s.session.id, !s.isPaneOpen))}>{s.isPaneOpen ? <PanelRightClose size={14} aria-hidden /> : <PanelRightOpen size={14} aria-hidden />}{s.isPaneOpen ? p.paneHide : p.paneShow}</Command.Item> : null}
          {s ? <Command.Item onSelect={run(() => void copyText(s.session.cwd, p.copied))}><Copy size={14} aria-hidden />{p.copyCwd}</Command.Item> : null}
          <Command.Item onSelect={run(() => setTheme('auto'))}><Monitor size={14} aria-hidden />{p.themeAuto}</Command.Item>
          <Command.Item onSelect={run(() => setTheme('dark'))}><Moon size={14} aria-hidden />{p.themeDark}</Command.Item>
          <Command.Item onSelect={run(() => setTheme('light'))}><Sun size={14} aria-hidden />{p.themeLight}</Command.Item>
        </Command.Group>
        {st.sessions.size > 1 ? (
          <Command.Group heading={p.sessions}>
            {[...sessionNames(st.sessions)].map(([id, name]) => <Command.Item key={id} value={`${id} ${name}`} onSelect={run(() => pick(id))}><SwitchCamera size={14} aria-hidden />{name}</Command.Item>)}
          </Command.Group>
        ) : null}
        <Command.Group heading={p.jumpTo}>
          {sections.map(({ id, label }) => <Command.Item key={id} value={`jump ${label}`} onSelect={run(() => jumpTo(id))}><MoveRight size={14} aria-hidden />{label}</Command.Item>)}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
