import { Bot, CheckCircle2, Circle, Cpu, FileText, Gauge, ListChecks, Loader, ShieldCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import type { WebSnapshot } from '../../../types/index'
import { dur, kilo, resultOf, short, time, tone } from '../format.ts'
import type { Labels, Page } from '../labels.ts'
import { useClock } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { Pill, toneVar } from '../ui/Pill.tsx'

const ROW = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, height: 0 }, transition: { duration: 0.22 } }

export function Running({ s, p }: { s: WebSnapshot; p: Page }) {
  const now = useClock(s)
  if (s.active.length === 0) return null
  return (
    <Panel id="running" title={p.running} help={p.helpRunning} icon={Cpu}>
      <ul className="flex flex-col gap-2 text-[13px]">
        <AnimatePresence initial={false}>
          {s.active.map(a => (
            <motion.li key={a.id} {...ROW} className="flex min-w-0 items-baseline justify-between gap-2.5">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <i className="rec mr-2 inline-block size-1.5 rounded-full bg-signal-bright align-middle" aria-hidden />
                <b>{a.who}</b> <span className="font-mono text-xs">{a.tool} {a.what}</span>
              </span>
              <span className="whitespace-nowrap text-ink-3 tabular-nums">{dur(now - a.startedAt)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Panel>
  )
}

const KINDS = ['test', 'typecheck', 'lint', 'build'] as const

export function Checks({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  return (
    <Panel id="verification" title={p.verification} help={p.helpVerification} icon={ShieldCheck}>
      <div className="grid grid-cols-2 gap-2">
        {KINDS.map(kind => {
          const c = s.checks.find(x => x.kind === kind)
          const r = c ? resultOf(c.result, l) : undefined
          const counts = c?.ran === undefined ? '' : ` · ${c.ran}${c.skipped ? ` (−${c.skipped})` : ''}`
          return (
            <div key={kind} className="min-w-0 rounded-lg border border-line-soft bg-surface-1 p-2.5" title={c ? `${c.command}${c.dir ? ` (${c.dir})` : ''}` : undefined}>
              <div className="flex items-center gap-2">
                <i className={`size-2 flex-none rounded-full ${c?.result === 'running' ? 'rec' : ''}`} style={{ background: r ? toneVar(r.tone) : 'var(--surface-3)', color: r ? toneVar(r.tone) : undefined }} aria-hidden />
                <b className="text-[13px]">{l.check[kind] ?? kind}</b>
                <span className="ml-auto truncate text-[11px] text-ink-3">{r ? `${r.text}${counts}` : '—'}</span>
              </div>
              {c ? <div className="mt-1 truncate font-mono text-[11px] text-ink-3">{time(c.at)} {c.command}</div> : null}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

export function Tasks({ s, l }: { s: WebSnapshot; l: Labels }) {
  if (s.tasks.length === 0) return null
  const p = l.page
  const done = s.tasks.filter(t => t.status === 'completed').length
  return (
    <Panel id="tasks" title={p.tasks} help={p.helpTasks} icon={ListChecks} aside={<span className="text-xs text-ink-3 tabular-nums">{done}/{s.tasks.length}</span>}>
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-signal-bright transition-[width] duration-500" style={{ width: `${(done / s.tasks.length) * 100}%` }} />
      </div>
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {s.tasks.map(t => (
          <li key={t.id} className="flex min-w-0 items-start gap-2 [overflow-wrap:anywhere]">
            {t.status === 'completed' ? <CheckCircle2 size={14} className="mt-0.5 flex-none text-good" aria-label={l.status.done} /> : t.status === 'in_progress' ? <Loader size={14} className="spin mt-0.5 flex-none text-signal-bright" aria-label={l.status.running} /> : <Circle size={14} className="mt-0.5 flex-none text-ink-3" aria-label={l.status.waiting} />}
            <span className={t.status === 'completed' ? 'text-ink-3' : ''}>{t.subject}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function Agents({ s, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  const now = useClock(s)
  return (
    <Panel id="agents" title={p.subagents} help={p.helpAgents} icon={Bot}>
      {s.agents.length === 0 ? <Empty text={p.none} /> : (
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {[...s.agents].reverse().map(a => (
              <motion.li key={a.id} {...ROW} className="rounded-lg border border-line-soft bg-surface-1 p-2.5 text-[13px]">
                <div className="flex items-baseline justify-between gap-2">
                  <b className="min-w-0 truncate">{a.type}</b>
                  <Pill text={a.tests === 'FAIL' ? 'FAIL' : (l.status[a.status] ?? a.status)} tone={a.tests === 'FAIL' ? 'bad' : tone(a.status)} />
                </div>
                <p className="mt-0.5 text-ink-2 [overflow-wrap:anywhere]" title={a.testsWhy}>{a.task}</p>
                <p className="mt-1 font-mono text-[11px] text-ink-3">{a.model}{a.effort ? ` ${a.effort}` : ''} · {a.tools} {p.calls} · {kilo(a.input + a.output)} {p.tokens} · {dur((a.endedAt ?? now) - a.startedAt)}</p>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  )
}

function PathList({ label, list }: { label: string; list: string[] }) {
  if (list.length === 0) return null
  return (
    <div>
      <span className="eyebrow">{label} · {list.length}</span>
      <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
        {list.slice(-8).reverse().map(f => <li key={f} className="[overflow-wrap:anywhere]" title={f}>{short(f)}</li>)}
      </ul>
    </div>
  )
}

export function Files({ s, p }: { s: WebSnapshot; p: Page }) {
  const isEmpty = s.files.edited.length === 0 && s.files.read.length === 0
  return (
    <Panel id="files" title={p.files} help={p.helpFiles} icon={FileText}>
      {isEmpty ? <Empty text={p.none} /> : <div className="flex flex-col gap-3"><PathList label={p.edited} list={s.files.edited} /><PathList label={p.read} list={s.files.read} /></div>}
    </Panel>
  )
}

function Bars({ label, rows }: { label: string; rows: { key: string; text: string; value: number; shown: string }[] }) {
  if (rows.length === 0) return null
  const top = Math.max(1, ...rows.map(r => r.value))
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {rows.map(r => (
          <li key={r.key} className="relative overflow-hidden rounded px-2 py-1 text-xs">
            <i className="absolute inset-y-0 left-0 bg-signal-soft transition-[width] duration-500" style={{ width: `${(r.value / top) * 100}%` }} />
            <span className="relative flex items-baseline justify-between gap-2.5">
              <span className="min-w-0 font-mono [overflow-wrap:anywhere]">{r.text}</span>
              <span className="whitespace-nowrap text-ink-2 tabular-nums">{r.shown}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Insights({ s, p }: { s: WebSnapshot; p: Page }) {
  const { slow, big } = s.insights
  const isEmpty = slow.length === 0 && big.length === 0
  return (
    <Panel id="insights" title={p.insights} help={p.helpInsights} icon={Gauge}>
      {isEmpty ? <Empty text={p.none} /> : (
        <div className="flex flex-col gap-3">
          <Bars label={p.slow} rows={slow.slice(0, 5).map(c => ({ key: `${c.at}:${c.what}`, text: `${c.tool} ${c.what}`, value: c.ms, shown: dur(c.ms) }))} />
          <Bars label={p.big} rows={big.slice(0, 5).map(c => ({ key: `${c.at}:${c.what}`, text: `${c.tool} ${c.what}`, value: c.tokens, shown: kilo(c.tokens) }))} />
        </div>
      )}
    </Panel>
  )
}
