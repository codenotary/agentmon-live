import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function Panel({ id, title, icon: Icon, aside, className = '', children }: { id?: string; title: string; icon?: LucideIcon; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`panel p-4 ${className}`} aria-label={title}>
      <header className="mb-3 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-2 font-display text-[13px] font-bold text-ink">
          {Icon ? <Icon size={14} className="text-ink-3" aria-hidden /> : null}
          {title}
        </h2>
        {aside ? <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </header>
      {children}
    </section>
  )
}

export const Empty = ({ text }: { text: string }) => <p className="text-[13px] text-ink-3">{text}</p>
