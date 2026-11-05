import { Info, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

// The small i beside a widget's title: hovering shows the text, a click or a key keeps it open, also on a touch screen.
export function HelpButton({ text, isOpen, onToggle, className = '' }: { text: string; isOpen: boolean; onToggle: () => void; className?: string }) {
  return <button type="button" className={`help-btn ${className}`} aria-label={text} aria-expanded={isOpen} title={text} onClick={onToggle}><Info size={13} aria-hidden /></button>
}

export function Panel({ id, title, help, icon: Icon, aside, className = '', children }: { id?: string; title: string; help: string; icon?: LucideIcon; aside?: ReactNode; className?: string; children: ReactNode }) {
  const [isHelpOpen, setHelpOpen] = useState(false)
  return (
    <section id={id} className={`panel p-5 ${className}`} aria-label={title}>
      <header className="mb-3 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-2 font-display text-base leading-6 font-bold text-heading">
          {Icon ? <Icon size={14} className="text-ink-3" aria-hidden /> : null}
          {title}
        </h2>
        <HelpButton text={help} isOpen={isHelpOpen} onToggle={() => setHelpOpen(!isHelpOpen)} className="-ml-1.5" />
        {aside ? <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </header>
      {isHelpOpen ? <p className="help-text mb-3">{help}</p> : null}
      {children}
    </section>
  )
}

export const Empty = ({ text }: { text: string }) => <p className="text-[13px] text-ink-3">{text}</p>
