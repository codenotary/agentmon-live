import { ChevronRight, Workflow } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import type { TraceCall, WebSnapshot } from '../../../types/index'
import { isRunning } from '../agents.ts'
import { agentNames, callTime, stateOf, time } from '../format.ts'
import { clampView, DEFAULT_VIEW, dragMode, flowOf, mergeDots, MAIN_LANE, wholeOf, windowOf, type Arc, type FlowView, type Lane, type Mark, type Span } from '../flow.ts'
import type { Labels } from '../labels.ts'
import { clockOf, set, useStore } from '../store.ts'
import { Empty, Panel } from '../ui/Panel.tsx'
import { openTrace } from './Waterfall.tsx'

const BRUSH_H = 28
const EDGE_PX = 6
const WIDE_LABEL = 170
const NARROW_LABEL = 34
const NARROW_PX = 640
const RIGHT_PAD = 8
const MIN_LANE = 24
const MAX_LANE = 50
const CHART_LANES_H = 150
const DOT_HIT_R = 8
const STEP_MS = 3000

// The ramp's palest step is too faint for a dot on white.
const laneColour = (i: number, isMain: boolean) => (isMain ? 'var(--ink-2)' : `var(--ramp-${(i % 4) + 1})`)

type Drag = { mode: 'move' | 'left' | 'right' | 'new'; startX: number; view: FlowView; to: number }

function Brush({ whole, span, width, colourOf, s, view, setView, p }: { whole: Span; span: Span; width: number; colourOf: Map<string, string>; s: WebSnapshot; view: FlowView; setView: (v: FlowView) => void; p: Labels['page'] }) {
  const drag = useRef<Drag | null>(null)
  const length = Math.max(1, whole.to - whole.from)
  const xOf = (t: number) => ((t - whole.from) / length) * width
  const tOf = (x: number) => whole.from + (x / Math.max(1, width)) * length
  const left = Math.max(0, xOf(span.from))
  const right = Math.min(width, xOf(span.to))
  const xIn = (e: PointerEvent<SVGSVGElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left

  const down = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const x = xIn(e)
    drag.current = { mode: dragMode(x, left, right, EDGE_PX), startX: x, view, to: span.to }
  }
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const x = xIn(e)
    const delta = ((x - d.startX) / Math.max(1, width)) * length
    const was = { to: d.to, from: d.to - d.view.ms }
    if (d.mode === 'move') setView({ ms: d.view.ms, at: was.to + delta })
    else if (d.mode === 'left') setView({ ms: was.to - (was.from + delta), at: was.to })
    else if (d.mode === 'right') setView({ ms: was.to + delta - was.from, at: was.to + delta })
    else setView({ ms: Math.abs(tOf(x) - tOf(d.startX)), at: Math.max(tOf(x), tOf(d.startX)) })
  }
  const up = () => { drag.current = null }

  return (
    <svg width={width} height={BRUSH_H} className="flow-brush block touch-none" role="img" aria-label={`${time(whole.from)} – ${p.flowNow}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="flow-brush">
      <rect x={0} y={0} width={width} height={BRUSH_H} fill="var(--surface-1)" />
      {(s.trace ?? []).map(c => <rect key={c.id} x={xOf(c.at)} y={8} width={1} height={BRUSH_H - 16} fill={colourOf.get(c.agentId ?? MAIN_LANE) ?? 'var(--ink-3)'} />)}
      <rect x={left} y={0.5} width={Math.max(2, right - left)} height={BRUSH_H - 1} rx={3} fill="var(--signal-soft)" fillOpacity={0.6} stroke="var(--signal-bright)" className="cursor-grab" data-testid="flow-window" />
      <text x={3} y={BRUSH_H - 2} className="flow-brush-text">{time(whole.from)}</text>
      <text x={width - 3} y={BRUSH_H - 2} textAnchor="end" className="flow-brush-text">{p.flowNow}</text>
    </svg>
  )
}

function MarkDot({ m, x, y, colour, isNarrow, onPick, onTip, leave }: { m: Mark; x: number; y: number; colour: string | undefined; isNarrow: boolean; onPick: (e: { clientX: number; clientY: number }, m: Mark) => void; onTip: (e: { clientX: number; clientY: number }, m: Mark) => void; leave: () => void }) {
  const first = m.dots[0]
  if (!first) return null
  const open = (e: { clientX: number; clientY: number }) => onPick(e, m)
  const fill = m.state === 'failed' ? 'var(--bad)' : m.state === 'asking' ? 'var(--surface)' : colour
  const stroke = m.state === 'asking' ? 'var(--warn)' : undefined
  if (m.count > 1) {
    return (
      <g className="cursor-pointer" onClick={open} onMouseEnter={e => onTip(e, m)} onMouseMove={e => onTip(e, m)} onMouseLeave={leave}>
        <rect className="flow-mark" x={x - 8} y={y - 6} width={16} height={12} rx={6} fill={fill} stroke={stroke} />
        {isNarrow ? null : <text x={x} y={y + 3} textAnchor="middle" className="flow-count">{m.count}</text>}
      </g>
    )
  }
  return (
    <g className="cursor-pointer" onClick={open} onMouseEnter={e => onTip(e, m)} onMouseMove={e => onTip(e, m)} onMouseLeave={leave}>
      {/* A dot this small is hard to land on; the mark that takes the pointer is wider than the one you see. */}
      <circle cx={x} cy={y} r={DOT_HIT_R} fill="transparent" />
      <circle className={`flow-dot ${m.state === 'asking' ? 'rec' : ''}`} cx={x} cy={y} r={first.isBig ? 3.5 : 2.5} fill={fill} stroke={stroke} strokeWidth={stroke ? 2 : undefined} />
    </g>
  )
}

export function Flow({ s: live, l }: { s: WebSnapshot; l: Labels }) {
  const p = l.page
  const { flowView: view, openAgents } = useStore()
  const anyRunning = live.agents.some(isRunning)
  // Open while a subagent runs. A click holds until the next agent starts or the last one ends.
  const [pickedOpen, setPickedOpen] = useState<boolean | null>(null)
  const isOpen = pickedOpen ?? anyRunning
  useEffect(() => setPickedOpen(null), [anyRunning])
  // The waterfall follows this chart's time: folded, nothing on screen could bring back a time picked here.
  useEffect(() => {
    if (!isOpen) set({ flowView: DEFAULT_VIEW })
  }, [isOpen])
  const [isOver, setIsOver] = useState(false)
  const [list, setList] = useState<{ x: number; y: number; calls: TraceCall[] } | null>(null)
  const listBox = useRef<HTMLDivElement>(null)
  const latest = useRef(live)
  latest.current = live
  const [drawn, setDrawn] = useState({ s: live, now: clockOf(live) })
  // Redraws in steps, and not while the pointer is here or a list is open: a mark that moves is hard to click.
  const isHeld = isOver || list !== null
  useEffect(() => {
    if (isHeld) return
    const draw = () => setDrawn({ s: latest.current, now: clockOf(latest.current) })
    draw()
    const id = setInterval(draw, STEP_MS)
    return () => clearInterval(id)
  }, [isHeld, isOpen])
  const { s, now } = drawn.s.session.id === live.session.id ? drawn : { s: live, now: clockOf(live) }
  useEffect(() => setList(null), [live.session.id])
  useEffect(() => {
    if (!list) return
    const close = (e: Event) => {
      if (!listBox.current?.contains(e.target as Node)) setList(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [list])
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hideFinished, setHideFinished] = useState(false)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [hotArc, setHotArc] = useState<string | null>(null)

  useEffect(() => {
    if (!box.current) return
    const seen = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    seen.observe(box.current)
    return () => seen.disconnect()
  }, [])

  const whole = wholeOf(s, now)
  const setView = (v: FlowView) => set({ flowView: clampView(v, whole) })
  const span = windowOf(view, s, now, stateOf(s) !== 'idle')
  const { lanes, dots, arcs } = flowOf(s, l.main, now, { hideFinished })
  const isNarrow = width < NARROW_PX
  const label = isNarrow ? NARROW_LABEL : WIDE_LABEL
  const plot = Math.max(1, width - label - RIGHT_PAD)
  const laneH = Math.max(MIN_LANE, Math.min(MAX_LANE, CHART_LANES_H / lanes.length))
  const height = lanes.length * laneH + 4
  const length = Math.max(1, span.to - span.from)
  const xOf = (t: number) => label + ((t - span.from) / length) * plot
  // Half a window drawn past the left edge and clipped, so a glide never shows a gap or drops a mark early.
  const drawnFrom = span.from - length / 2
  const inWindow = (t: number) => t >= drawnFrom && t <= span.to
  const yOf = new Map(lanes.map((x, i) => [x.id, i * laneH + laneH / 2 + 2]))
  const colourOf = new Map(lanes.map((x, i) => [x.id, laneColour(i, x.isMain)]))
  const names = agentNames(s.agents)
  const marks = mergeDots(dots, { from: drawnFrom, to: span.to }, plot * 1.5)
  const plotBox = useRef<SVGGElement>(null)
  const glide = useRef<{ anim: Animation; px: number } | null>(null)
  const lastEdge = useRef({ to: span.to, ms: length, id: s.session.id })
  // Each new frame starts where the last one was on screen and slides to its place over one step, so steps join into one motion.
  useLayoutEffect(() => {
    const was = lastEdge.current
    lastEdge.current = { to: span.to, ms: length, id: s.session.id }
    const old = glide.current
    const rest = old ? old.px * (1 - Number(old.anim.currentTime ?? STEP_MS) / STEP_MS) : 0
    old?.anim.cancel()
    glide.current = null
    const px = ((span.to - was.to) / length) * plot + rest
    const isSameFrame = view.at === null && was.ms === length && was.id === s.session.id
    if (!isSameFrame || px <= 0 || px > plot / 2 || !plotBox.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    glide.current = { px, anim: plotBox.current.animate([{ transform: `translateX(${px}px)` }, { transform: 'translateX(0)' }], { duration: STEP_MS }) }
  }, [span.to, length, plot, view.at, s.session.id])
  useEffect(() => {
    const anim = glide.current?.anim
    if (isHeld) anim?.pause()
    else if (anim?.playState === 'paused') anim.play()
  }, [isHeld])
  const nameOfAgent = (id: string) => names.get(id)?.short ?? id

  const spotOf = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect()
    return r ? { x: e.clientX - r.left + 10, y: e.clientY - r.top + 12 } : null
  }
  const placeTip = (e: { clientX: number; clientY: number }, text: string) => {
    const spot = spotOf(e)
    if (spot) setTip({ ...spot, text })
  }
  const pickMark = (e: { clientX: number; clientY: number }, m: Mark) => {
    const spot = spotOf(e)
    const [first] = m.dots
    if (m.count === 1 && first) openTrace(first.call)
    else if (spot) setList({ ...spot, calls: m.dots.map(d => d.call) })
  }
  const markTip = (e: { clientX: number; clientY: number }, m: Mark) => {
    const first = m.dots[0]
    if (!first) return
    const c = first.call
    const line = c.what.split('\n')[0] ?? ''
    placeTip(e, m.count > 1 ? `${m.count} ${p.calls} · ${time(m.at)}–${time(m.to)}` : `${time(c.at)} · ${c.tool} ${line}${c.ms === undefined ? '' : ` · ${callTime(c.ms)}`}${c.isFailed ? ` · ${l.result.failed}` : ''}`)
  }
  const arcTip = (e: { clientX: number; clientY: number }, a: Arc) => {
    const name = nameOfAgent(a.agent)
    placeTip(e, a.kind === 'spawn' ? `${l.main} → ${name} · ${p.spawned} ${time(a.fromAt)}` : a.kind === 'handback' ? `${name} → ${l.main} · ${p.handedBack} ${time(a.toAt)}` : `${name} → ${l.main} · ${l.status.waiting}`)
  }
  const leave = () => {
    setTip(null)
    setHotArc(null)
  }

  const pickLane = (lane: Lane) => {
    if (lane.isMain) return set({ whoFilter: l.main })
    if (lane.agentId) set({ whoFilter: names.get(lane.agentId)?.short ?? null, openAgents: new Set(openAgents).add(lane.agentId) })
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (list) {
      if (e.key === 'Escape') setList(null)
      return
    }
    const step = view.ms * 0.1
    if (e.key === 'ArrowLeft') setView({ ms: view.ms, at: span.to - step })
    else if (e.key === 'ArrowRight') setView({ ms: view.ms, at: span.to + step })
    else if (e.key === '[') setView({ ...view, ms: view.ms * 0.75 })
    else if (e.key === ']') setView({ ...view, ms: view.ms / 0.75 })
    else if (e.key === 'Home') setView({ ms: view.ms, at: whole.from + view.ms })
    else if (e.key === 'End') setView({ ms: view.ms, at: null })
    else return
    e.preventDefault()
  }

  const fold = <button type="button" className="icon-btn !h-[26px] !min-w-[26px] !p-0" aria-label={p.flow} title={p.flow} aria-expanded={isOpen} data-testid="flow-fold" onClick={() => setPickedOpen(!isOpen)}><ChevronRight size={14} className={`chevron ${isOpen ? 'open' : ''}`} aria-hidden /></button>
  const aside = !isOpen ? fold : (
    <>
      {s.agents.length ? <button type="button" className="chip" aria-pressed={hideFinished} onClick={() => setHideFinished(!hideFinished)}>{p.hideFinished}</button> : null}
      <button type="button" className="chip" aria-pressed={view.at === null} onClick={() => setView({ ms: view.ms, at: null })}>{p.follow}</button>
      {fold}
    </>
  )
  const arcPath = (a: Arc) => {
    const y1 = yOf.get(a.fromLane)
    const y2 = yOf.get(a.toLane)
    if (y1 === undefined || y2 === undefined) return undefined
    const x1 = xOf(a.fromAt)
    const x2 = xOf(a.toAt)
    const mid = (y1 + y2) / 2
    return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`
  }

  return (
    <Panel id="flow" title={p.flow} help={p.helpFlow} icon={Workflow} aside={aside} className={isOpen ? '' : '[&>header]:mb-0'}>
      {isOpen && !s.trace?.length ? <Empty text={p.none} /> : null}
      <div ref={box} className="relative outline-offset-2" tabIndex={0} onKeyDown={onKey} onPointerEnter={() => setIsOver(true)} onPointerLeave={() => setIsOver(false)} data-testid="flow" style={isOpen && s.trace?.length ? undefined : { display: 'none' }}>
        {width > 0 ? (
          <>
            <Brush whole={whole} span={span} width={width} colourOf={colourOf} s={s} view={view} setView={setView} p={p} />
            <div className="relative mt-2 max-h-[320px] overflow-y-auto">
              <svg width={width} height={height} className="block" role="img" aria-label={p.flow}>
                <clipPath id="flow-plot"><rect x={label - 4} y={0} width={width - label + 4} height={height} /></clipPath>
                <g clipPath="url(#flow-plot)"><g ref={plotBox}>
                {lanes.map(lane => {
                  const y = yOf.get(lane.id) ?? 0
                  const a = Math.max(xOf(drawnFrom), xOf(lane.from))
                  const b = Math.min(label + plot, xOf(lane.to))
                  return b > a ? <line key={lane.id} x1={a} x2={b} y1={y} y2={y} stroke={colourOf.get(lane.id)} strokeWidth={lane.isMain ? 2 : 1} className={lane.isRunning && !lane.isMain ? 'flow-running' : ''} /> : null
                })}
                {s.turns.filter(t => inWindow(t.startedAt)).map(t => {
                  const y = yOf.get(MAIN_LANE) ?? 0
                  const x = xOf(t.startedAt)
                  return <line key={t.startedAt} x1={x} x2={x} y1={y - 7} y2={y + 7} stroke="var(--ink-2)" strokeWidth={1} onMouseEnter={e => placeTip(e, `${time(t.startedAt)}${t.prompt ? ` · ${t.prompt}` : ''}`)} onMouseLeave={leave} />
                })}
                {(s.checks ?? []).filter(c => inWindow(c.at)).map(c => {
                  const x = xOf(c.at)
                  const colour = c.result === 'ok' ? 'var(--good)' : c.result === 'failed' ? 'var(--bad)' : 'var(--ink-3)'
                  return <line key={`${c.kind}:${c.at}`} x1={x} x2={x} y1={0} y2={height} stroke={colour} strokeWidth={1} strokeDasharray="2 3" onMouseEnter={e => placeTip(e, `${time(c.at)} · ${l.check[c.kind] ?? c.kind} · ${c.command}`)} onMouseLeave={leave} />
                })}
                {isNarrow ? null : arcs.filter(a => inWindow(a.fromAt) || inWindow(a.toAt)).map(a => {
                  const d = arcPath(a)
                  if (!d) return null
                  return (
                    <g key={a.key} onMouseEnter={e => { setHotArc(a.key); arcTip(e, a) }} onMouseMove={e => arcTip(e, a)} onMouseLeave={leave}>
                      <path d={d} fill="none" stroke="transparent" strokeWidth={8} />
                      <path d={d} pathLength={1} fill="none" className={`flow-arc ${hotArc === a.key ? 'hot' : ''}`} stroke={a.kind === 'ask' ? 'var(--warn)' : colourOf.get(a.fromLane)} />
                    </g>
                  )
                })}
                {marks.map(m => <MarkDot key={m.key} m={m} x={xOf(m.at)} y={yOf.get(m.lane) ?? 0} colour={colourOf.get(m.lane)} isNarrow={isNarrow} onPick={pickMark} onTip={markTip} leave={leave} />)}
                </g></g>
                {now >= span.from && now <= span.to ? <line x1={xOf(now)} x2={xOf(now)} y1={0} y2={height} stroke="var(--signal-bright)" strokeWidth={1} pointerEvents="none" /> : null}
              </svg>
              {lanes.map(lane => {
                const y = yOf.get(lane.id) ?? 0
                return (
                  <button key={lane.id} type="button" className="flow-label" style={{ top: y - 10, width: label - 6 }} title={lane.full} onClick={() => pickLane(lane)}>
                    <i className={`agent-dot flex-none ${lane.dot}`} aria-hidden />
                    <span className="truncate">{isNarrow ? lane.name.slice(0, 2) : lane.name}</span>
                  </button>
                )
              })}
            </div>
          </>
        ) : null}
        {list ? (
          <div ref={listBox} className="pop flow-list absolute" style={{ left: Math.min(list.x, Math.max(0, width - 320)), top: list.y }} data-testid="flow-list">
            {list.calls.map((c, i) => (
              <button key={c.id} type="button" className="flow-call" autoFocus={i === 0} onClick={() => { setList(null); openTrace(c) }}>
                <span className="text-ink-3">{time(c.at)}</span> <span className={c.isFailed ? 'text-bad' : ''}>{c.tool}</span> {c.what.split('\n')[0]}{c.ms === undefined ? '' : ` · ${callTime(c.ms)}`}
              </button>
            ))}
          </div>
        ) : null}
        {tip && !list ? <div className="pop pointer-events-none absolute" style={{ left: Math.min(tip.x, Math.max(0, width - 320)), top: tip.y }}>{tip.text}</div> : null}
      </div>
    </Panel>
  )
}
