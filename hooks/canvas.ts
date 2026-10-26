import type { Topo } from './topology'
import { isRunning, limitName } from './topology'

// The terminal's default colour, as a Raster cell spells it.
export const DEFAULT = 0x01000000
export const C = {
  dim: 0x5c6370,
  text: 0xd0d0d0,
  orange: 0xd97757,
  blue: 0x61afef,
  cyan: 0x56b6c2,
  green: 0x98c379,
  yellow: 0xe5c07b,
  red: 0xe06c75,
  magenta: 0xc678dd,
  well: 0x2c313a,
}

// A grid of terminal cells, each a code point with a foreground and background; `encode` gives a Raster's `cells`.
export class Cells {
  readonly words: Uint32Array
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.words = new Uint32Array(columns * rows * 3)
    for (let i = 0; i < columns * rows; i++) this.words.set([0x20, DEFAULT, DEFAULT], i * 3)
  }

  put(x: number, y: number, ch: string, fg = C.text, bg = DEFAULT) {
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return
    const code = ch.codePointAt(0) ?? 0x20
    // The engine takes one width-1 BMP character per cell; anything else is a space.
    this.words.set([code > 0xffff || code < 0x20 ? 0x20 : code, fg, bg], (y * this.columns + x) * 3)
  }

  text(x: number, y: number, s: string, fg = C.text, bg = DEFAULT, width = this.columns - x) {
    ;[...s].slice(0, Math.max(0, width)).forEach((ch, i) => this.put(x + i, y, ch, fg, bg))
  }

  box(x: number, y: number, w: number, h: number, fg: number, title?: string) {
    for (let i = 1; i < w - 1; i++) {
      this.put(x + i, y, '─', fg)
      this.put(x + i, y + h - 1, '─', fg)
    }
    for (let j = 1; j < h - 1; j++) {
      this.put(x, y + j, '│', fg)
      this.put(x + w - 1, y + j, '│', fg)
    }
    this.put(x, y, '╭', fg)
    this.put(x + w - 1, y, '╮', fg)
    this.put(x, y + h - 1, '╰', fg)
    this.put(x + w - 1, y + h - 1, '╯', fg)
    if (title) this.text(x + 2, y, ` ${title} `, fg, DEFAULT, w - 4)
  }

  // A pipe with a dot that travels along it while `phase` moves; `isFlowing` false draws it dim and still.
  hpipe(x1: number, x2: number, y: number, fg: number, phase: number, isFlowing: boolean) {
    for (let x = x1; x <= x2; x++) this.put(x, y, '━', isFlowing ? fg : C.dim)
    if (isFlowing) for (let x = x1 + (phase % 4); x <= x2; x += 4) this.put(x, y, '●', fg)
    this.put(x2, y, '▶', isFlowing ? fg : C.dim)
  }

  vpipe(x: number, y1: number, y2: number, fg: number, phase: number, isFlowing: boolean) {
    for (let y = y1; y <= y2; y++) this.put(x, y, '┃', isFlowing ? fg : C.dim)
    if (isFlowing) for (let y = y1 + (phase % 3); y <= y2; y += 3) this.put(x, y, '●', fg)
  }

  // A tank filled from the bottom: `fraction` of its inside rows, the top cell row of the level in eighths.
  tank(x: number, y: number, w: number, h: number, fraction: number, fg: number) {
    const inside = h - 2
    const level = Math.max(0, Math.min(1, fraction)) * inside * 8
    for (let i = 0; i < w; i++) {
      this.put(x + i, y, '▄', C.dim)
      this.put(x + i, y + h - 1, '▀', C.dim)
    }
    for (let r = 0; r < inside; r++) {
      const eighths = Math.max(0, Math.min(8, Math.round(level - r * 8)))
      const ch = eighths === 0 ? ' ' : ' ▁▂▃▄▅▆▇█'[eighths]!
      for (let i = 0; i < w; i++) this.put(x + i, y + h - 2 - r, ch, fg, C.well)
    }
  }

  bar(x: number, y: number, w: number, fraction: number, fg: number) {
    const eighths = Math.round(Math.max(0, Math.min(1, fraction)) * w * 8)
    for (let i = 0; i < w; i++) {
      const n = Math.max(0, Math.min(8, eighths - i * 8))
      this.put(x + i, y, n === 0 ? ' ' : ' ▏▎▍▌▋▊▉█'[n]!, fg, C.well)
    }
  }

  encode(): string {
    return (new Uint8Array(this.words.buffer) as unknown as { toBase64(): string }).toBase64()
  }
}

const pct = (n: number) => `${Math.round(n)}%`
const levelColor = (n: number) => (n >= 80 ? C.red : n >= 50 ? C.yellow : C.green)
const short = (model: string) => model.replace(/^claude-/, '').replace(/-(\d+)-(\d+).*$/, ' $1.$2')

export const CANVAS_ROWS = 22

// The session as a plant: the session node feeds tools and agents through pipes, with tanks for context and limits.
export function paintTopology(topo: Topo, columns: number, phase: number, labels: Record<'session' | 'tools' | 'agents' | 'context' | 'limits' | 'fable', string>): Cells {
  const c = new Cells(columns, CANVAS_ROWS)
  const tanksW = 8 + topo.limits.length * 7
  const midX = 30
  const midW = Math.max(24, columns - midX - tanksW - 2)

  // Session and Fable on the left.
  c.box(0, 0, 24, 9, C.orange, labels.session.toUpperCase())
  c.text(2, 1, short(topo.session.model) || '?', C.orange)
  c.text(2, 2, `effort ${topo.session.effort || '?'}`, C.text)
  const mins = Math.floor(topo.session.uptimeMs / 60_000)
  c.text(2, 3, `up ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}`, C.text)
  if (topo.session.cost !== undefined) c.text(2, 4, `$${topo.session.cost.toFixed(2)}`, C.yellow)
  c.text(2, 5, `${topo.session.compactions}× compacted`, C.dim)
  c.box(0, 11, 24, 6, C.magenta, labels.fable.toUpperCase())
  c.text(2, 12, topo.fable.state, topo.fable.state === 'unavailable' ? C.red : C.text)
  topo.fable.verdicts.forEach((ok, i) => c.text(2 + i * 4, 13, ok ? '●ok' : '●no', ok ? C.green : C.red))

  // Pipes: session to tools, session down to agents.
  const toolsFlowing = topo.callsPerMin > 0
  const agentsFlowing = topo.agents.some(isRunning)
  c.text(25, 2, `${topo.callsPerMin}/m`, toolsFlowing ? C.cyan : C.dim)
  c.hpipe(24, midX - 1, 3, C.cyan, phase, toolsFlowing)
  c.hpipe(24, 26, 6, C.blue, phase, agentsFlowing)
  c.vpipe(26, 7, 14, C.blue, phase, agentsFlowing)
  c.hpipe(26, midX - 1, 15, C.blue, phase, agentsFlowing)

  // Tools: one bar per used category with its rate.
  c.box(midX, 0, midW, 11, C.green, labels.tools.toUpperCase())
  const most = Math.max(1, ...topo.tools.map(x => x.total))
  const barW = Math.max(4, midW - 24)
  topo.tools.slice(0, 9).forEach((x, i) => {
    const y = 1 + i
    c.text(midX + 2, y, x.cat.padEnd(9).slice(0, 9), x.cat === 'git' ? C.yellow : C.text)
    c.bar(midX + 12, y, barW, x.total / most, x.errors > 0 ? C.red : x.cat === 'git' ? C.yellow : C.green)
    c.text(midX + 13 + barW, y, String(x.total).padStart(4), C.text)
    if (x.perMin > 0) c.text(midX + 18 + barW, y, `${x.perMin}/m`, C.cyan)
  })

  // Agents: one pill per agent, the running ones first.
  c.box(midX, 12, midW, 10, C.blue, labels.agents.toUpperCase())
  const shown = [...topo.agents.filter(isRunning), ...topo.agents.filter(a => !isRunning(a)).reverse()]
  shown.slice(0, 8).forEach((a, i) => {
    const color = a.isFail ? C.red : isRunning(a) ? C.cyan : C.dim
    c.text(midX + 2, 13 + i, isRunning(a) ? (phase % 2 ? '◉' : '●') : a.isFail ? '✗' : '○', color)
    c.text(midX + 4, 13 + i, a.type.padEnd(16).slice(0, 16), isRunning(a) ? C.text : C.dim)
    c.text(midX + 21, 13 + i, short(a.model), C.blue, DEFAULT, midW - 23)
  })
  if (shown.length > 8) c.text(midX + 2, 21, `+${shown.length - 8}`, C.dim)
  if (shown.length === 0) c.text(midX + 2, 13, '—', C.dim)

  // Tanks on the right: context, then each rate limit.
  const tx = midX + midW + 2
  c.text(tx, 0, labels.context.toUpperCase().slice(0, 7), C.text)
  const ctx = topo.context
  c.tank(tx, 1, 6, 14, (ctx ?? 0) / 100, levelColor(ctx ?? 0))
  c.text(tx, 15, ctx === undefined ? '  ?' : pct(ctx).padStart(4), levelColor(ctx ?? 0))
  topo.limits.forEach((l, i) => {
    const x = tx + 8 + i * 7
    c.text(x, 0, limitName(l.kind).slice(0, 6), C.text)
    c.tank(x, 1, 5, 14, l.percent / 100, levelColor(l.percent))
    c.text(x, 15, pct(l.percent).padStart(4), levelColor(l.percent))
  })
  if (topo.limits.length > 0) c.text(tx + 8, 17, labels.limits, C.dim)

  // Checks under the tanks.
  topo.checks.slice(0, 4).forEach((k, i) => {
    const color = k.result === 'ok' ? C.green : k.result === 'failed' ? C.red : k.result === 'running' ? C.cyan : C.dim
    c.text(tx, 18 + i, `● ${k.kind}`, color)
  })
  return c
}
