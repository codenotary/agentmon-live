import type { ViewAgg, ViewBlock, ViewColumn, ViewFormat, ViewLevels, ViewList, ViewNote, ViewPanel, ViewQuery, ViewSection, ViewTest, WebView } from '../../types/index'
import { callTime, hhmm, kilo, levelOf, usdText, type Tone } from './format.ts'

export const PANELS: readonly ViewPanel[] = ['Instruments', 'Flow', 'Waterfall', 'TurnClock', 'Events', 'Running', 'Steps', 'Calls', 'Insights', 'Checks', 'Tasks', 'Agents', 'Files', 'Log']
// The colour tokens of `theme.css`; a test holds this list to that file.
export const TOKENS: readonly string[] = ['--page', '--surface', '--surface-1', '--surface-2', '--surface-3', '--header', '--line', '--line-soft', '--line-input', '--ink', '--heading', '--ink-2', '--ink-3', '--signal', '--signal-bright', '--signal-soft', '--good', '--warn', '--bad', '--good-soft', '--warn-soft', '--bad-soft', '--info', '--info-line', '--ramp-1', '--ramp-2', '--ramp-3', '--ramp-4', '--ramp-5', '--ramp-other']
// The page's own sections; `Nav.tsx` draws them in this order.
export const BUILT_IN: readonly string[] = ['overview', 'calls', 'verification', 'agents', 'files', 'log']
const FORMATS: readonly ViewFormat[] = ['usd', 'count', 'dur', 'pct', 'time']
const AGGS: readonly ViewAgg[] = ['sum', 'avg', 'min', 'max', 'count']
// Nothing that can end a declaration or open another rule: no `;`, `}`, `!`, quotes or nested parentheses.
const COLOUR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch)\([\d.,%/\s+a-z-]*\))$/i
const MAX_DEPTH = 6
const MAX_CHILDREN = 24
const MAX_TEXT = 200
const MAX_COLUMNS = 8
const MAX_TESTS = 4
const MAX_ROWS = 50
const ID = /^[a-z0-9-]{1,40}$/

// The value at a JSON pointer (RFC 6901), or undefined when the path finds nothing.
export function pick(from: unknown, pointer: string): unknown {
  if (pointer === '') return from
  if (!pointer.startsWith('/')) return undefined
  let at = from
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (at === null || typeof at !== 'object' || !Object.hasOwn(at, key)) return undefined
    at = (at as Record<string, unknown>)[key]
  }
  return at
}

export function formatValue(v: unknown, format: ViewFormat | undefined): string {
  if (Array.isArray(v)) return format === 'count' ? kilo(v.length) : '—'
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (format === 'usd') return usdText(v)
    if (format === 'count') return kilo(v)
    // A call under a second keeps its milliseconds.
    if (format === 'dur') return callTime(v)
    if (format === 'pct') return `${Math.round(v)}%`
    // Another day's time says which day.
    if (format === 'time') return new Date(v).toDateString() === new Date().toDateString() ? hhmm(v) : `${new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${hhmm(v)}`
    // An average has no end of digits: two decimals, and below one two digits that say something.
    return String(Math.abs(v) >= 1 ? Math.round(v * 100) / 100 : Number(v.toPrecision(2)))
  }
  return typeof v === 'string' || typeof v === 'boolean' ? String(v) : '—'
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '')
const pointer = (v: unknown) => (typeof v === 'string' && (v === '' || v.startsWith('/')) ? v.slice(0, MAX_TEXT) : undefined)
const scalar = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : typeof v === 'boolean' || isNumber(v) ? v : undefined)
const number = (v: unknown) => (isNumber(v) ? v : undefined)
const format = (v: unknown) => (FORMATS.includes(v as ViewFormat) ? (v as ViewFormat) : undefined)
const agg = (v: unknown) => (AGGS.includes(v as ViewAgg) ? (v as ViewAgg) : undefined)
// Without the keys that hold nothing, so a shaped block is what the file said and no more.
const compact = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

// The rows a pointer names: a list as it is, a record as `{ key, value }` rows, anything else none.
function sourceRows(s: unknown, rows: string): unknown[] {
  const v = pick(s, rows)
  return Array.isArray(v) ? v : isObject(v) ? Object.entries(v).map(([key, value]) => ({ key, value })) : []
}

function passes(item: unknown, t: ViewTest): boolean {
  const v = pick(item, t.field)
  return (t.is === undefined || v === t.is) && (t.not === undefined || v !== t.not) && (t.above === undefined || (isNumber(v) && v > t.above)) && (t.below === undefined || (isNumber(v) && v < t.below))
}

const filtered = (s: unknown, rows: string, where: readonly ViewTest[] | undefined) => sourceRows(s, rows).filter(item => (where ?? []).every(t => passes(item, t)))

// One number for a list: `count` is its length, the others read `field` of each row and skip what is no number.
export function fold(items: readonly unknown[], field: string | undefined, how: ViewAgg): number | undefined {
  if (how === 'count') return items.length
  const n = items.map(i => pick(i, field ?? '')).filter(isNumber)
  if (how === 'sum') return n.reduce((a, b) => a + b, 0)
  if (n.length === 0) return undefined
  return how === 'avg' ? n.reduce((a, b) => a + b, 0) / n.length : how === 'min' ? Math.min(...n) : Math.max(...n)
}

// A table's cells: the rows that pass `where`, one per `group` value when grouped, sorted, cut to `max`.
export function queryRows(s: unknown, q: ViewQuery, columns: readonly ViewColumn[]): unknown[][] {
  const items = filtered(s, q.rows, q.where)
  let rows: { row: unknown; items?: unknown[] }[] = items.map(row => ({ row }))
  if (q.group !== undefined) {
    const groups = new Map<string, unknown[]>()
    for (const item of items) {
      const value = pick(item, q.group)
      // A number by its own digits, so two that only round alike stay apart.
      const key = isNumber(value) ? String(value) : formatValue(value, undefined)
      const list = groups.get(key)
      if (list) list.push(item)
      else groups.set(key, [item])
    }
    rows = [...groups].map(([key, list]) => ({ row: { key, count: list.length }, items: list }))
  }
  const cell = (r: { row: unknown; items?: unknown[] }, c: ViewColumn) => (c.agg ? fold(r.items ?? [r.row], c.field, c.agg) : pick(r.row, c.field ?? (r.items ? '/key' : '')))
  const by = columns.find(c => c.label === q.sort) ?? (q.sort?.startsWith('/') ? { label: '', field: q.sort } : undefined)
  if (by) {
    const turn = q.desc ? -1 : 1
    rows = rows
      .map(r => ({ r, v: cell(r, by) }))
      // What has no value goes last, whichever way the rest runs.
      .sort((a, b) => (a.v === undefined || a.v === null ? 1 : b.v === undefined || b.v === null ? -1 : isNumber(a.v) && isNumber(b.v) ? (a.v - b.v) * turn : String(a.v).localeCompare(String(b.v)) * turn))
      .map(x => x.r)
  }
  return rows.slice(0, q.max ?? 10).map(r => columns.map(c => cell(r, c)))
}

// A Stat's number: the value at its pointer, or with `agg` one number for the list there.
export function statValue(s: unknown, b: { value: string; field?: string; agg?: ViewAgg; where?: ViewTest[] }): unknown {
  return b.agg ? fold(filtered(s, b.value, b.where), b.field, b.agg) : pick(s, b.value)
}

// A Bars block's rows as `[name, value]`, largest first unless the file sorts them.
export function barRows(s: unknown, b: Extract<ViewBlock, { type: 'Bars' }>): [string, number][] {
  const isGrouped = b.group !== undefined
  const columns: ViewColumn[] = [{ label: 'name', field: b.name ?? '/key' }, { label: 'value', field: b.value ?? (isGrouped ? undefined : '/value'), agg: b.agg ?? (isGrouped ? 'count' : undefined) }]
  return queryRows(s, { ...b, sort: b.sort ?? 'value', desc: b.sort === undefined ? true : b.desc }, columns).flatMap(([name, value]) => (isNumber(value) ? [[formatValue(name, undefined), value] as [string, number]] : []))
}

// The colour of a number: from the file's thresholds, else for a percent the page's own line.
export function toneOf(v: unknown, b: ViewLevels & { format?: ViewFormat }, isPercent = b.format === 'pct'): Tone {
  if (!isNumber(v)) return ''
  if (b.warnAt === undefined && b.badAt === undefined) return isPercent ? levelOf(v) : ''
  return b.badAt !== undefined && v >= b.badAt ? 'bad' : b.warnAt !== undefined && v >= b.warnAt ? 'warn' : 'good'
}

function shapeTests(raw: unknown): ViewTest[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const tests = raw.slice(0, MAX_TESTS).flatMap(t => {
    const field = isObject(t) ? pointer(t.field) : undefined
    return isObject(t) && field !== undefined ? [compact({ field, is: scalar(t.is), not: scalar(t.not), above: number(t.above), below: number(t.below) })] : []
  })
  return tests.length ? tests : undefined
}

function shapeQuery(raw: Record<string, unknown>): ViewQuery | undefined {
  const rows = pointer(raw.rows)
  if (rows === undefined) return undefined
  const max = isNumber(raw.max) && raw.max >= 1 ? Math.min(Math.floor(raw.max), MAX_ROWS) : undefined
  return compact({ rows, where: shapeTests(raw.where), group: pointer(raw.group), sort: text(raw.sort) || undefined, desc: raw.desc === true ? true : undefined, max })
}

const levels = (raw: Record<string, unknown>): ViewLevels => ({ warnAt: number(raw.warnAt), badAt: number(raw.badAt) })

function shapeBlock(raw: unknown, depth: number, at: string, notes: ViewNote[]): ViewBlock | undefined {
  const drop = (kind: ViewNote['kind'], detail?: unknown): undefined => {
    notes.push(compact({ at, kind, detail: detail === undefined ? undefined : String(detail).slice(0, 60) }))
  }
  if (!isObject(raw)) return drop('block')
  if (depth > MAX_DEPTH) return drop('limit', 'depth')
  if ('panel' in raw) return PANELS.includes(raw.panel as ViewPanel) ? { panel: raw.panel as ViewPanel } : drop('panel', raw.panel)
  const children = () => shapeBlocks(raw.children, depth + 1, `${at}/children`, notes)
  const need = <T,>(name: string, v: T | undefined) => (v === undefined ? drop('pointer', name) : v)
  switch (raw.type) {
    case 'Row':
    case 'Column':
      return { type: raw.type, children: children() }
    case 'Card':
      return { type: 'Card', title: text(raw.title), children: children() }
    case 'Text':
      return { type: 'Text', text: text(raw.text) }
    case 'Stat': {
      const value = need('value', pointer(raw.value))
      return value === undefined ? undefined : compact({ type: 'Stat' as const, label: text(raw.label), value, field: pointer(raw.field), agg: agg(raw.agg), where: shapeTests(raw.where), format: format(raw.format), foot: text(raw.foot) || undefined, ...levels(raw) })
    }
    case 'List': {
      const items = need('items', pointer(raw.items))
      const max = isNumber(raw.max) && raw.max >= 1 ? Math.min(Math.floor(raw.max), MAX_ROWS) : 10
      return items === undefined ? undefined : { type: 'List', label: text(raw.label), items, field: pointer(raw.field), max }
    }
    case 'Sparkline': {
      const points = need('points', pointer(raw.points))
      return points === undefined ? undefined : compact({ type: 'Sparkline' as const, label: text(raw.label), points, field: pointer(raw.field), format: format(raw.format) })
    }
    case 'Table': {
      const query = need('rows', shapeQuery(raw))
      const listed = Array.isArray(raw.columns) ? raw.columns : []
      if (listed.length > MAX_COLUMNS) drop('limit', 'columns')
      const columns = listed.slice(0, MAX_COLUMNS).flatMap(c => (isObject(c) ? [compact({ label: text(c.label), field: pointer(c.field), agg: agg(c.agg), format: format(c.format) })] : []))
      if (query && columns.length === 0) return drop('pointer', 'columns')
      return query ? { type: 'Table', label: text(raw.label), columns, ...query } : undefined
    }
    case 'Bars': {
      const query = need('rows', shapeQuery(raw))
      return query ? compact({ type: 'Bars' as const, label: text(raw.label), name: pointer(raw.name), value: pointer(raw.value), agg: agg(raw.agg), format: format(raw.format), ...query }) : undefined
    }
    case 'Gauge':
    case 'Meter': {
      const value = need('value', pointer(raw.value))
      const max = isNumber(raw.max) && raw.max > 0 ? raw.max : undefined
      return value === undefined ? undefined : compact({ type: raw.type, label: text(raw.label), value, max, format: format(raw.format), ...levels(raw) })
    }
    default:
      return drop('block', raw.type)
  }
}

function shapeBlocks(raw: unknown, depth: number, at: string, notes: ViewNote[]): ViewBlock[] {
  if (!Array.isArray(raw)) return []
  if (raw.length > MAX_CHILDREN) notes.push({ at, kind: 'limit', detail: 'children' })
  return raw.slice(0, MAX_CHILDREN).map((b, i) => shapeBlock(b, depth, `${at}/${i}`, notes)).filter(b => b !== undefined)
}

function shapeTokens(raw: unknown, at: string, notes: ViewNote[]): Record<string, string> | undefined {
  if (!isObject(raw)) return undefined
  const isKept = ([k, v]: [string, unknown]) => TOKENS.includes(k) && typeof v === 'string' && COLOUR.test(v.trim())
  for (const [k] of Object.entries(raw).filter(e => !isKept(e))) notes.push({ at, kind: 'colour', detail: k.slice(0, 60) })
  const kept = Object.entries(raw).filter(isKept)
  return kept.length ? Object.fromEntries(kept.map(([k, v]) => [k, (v as string).trim()])) : undefined
}

// What the page draws of a view file: blocks, panels and tokens outside the catalog are dropped, so a file Claude got wrong still shows what it got right. `notes` names each thing dropped.
export function shapeView(raw: unknown): WebView {
  if (!isObject(raw)) return { sections: [] }
  const notes: ViewNote[] = []
  const seen = new Set<string>()
  const sections: ViewSection[] = []
  const listed = Array.isArray(raw.sections) ? raw.sections : []
  if (listed.length > MAX_CHILDREN) notes.push({ at: 'sections', kind: 'limit', detail: 'sections' })
  for (const [i, s] of listed.slice(0, MAX_CHILDREN).entries()) {
    if (!isObject(s) || typeof s.id !== 'string' || !ID.test(s.id) || seen.has(s.id)) {
      notes.push(compact({ at: `sections/${i}`, kind: 'section' as const, detail: isObject(s) && typeof s.id === 'string' ? s.id.slice(0, 60) : undefined }))
      continue
    }
    seen.add(s.id)
    const section: ViewSection = { id: s.id }
    if (typeof s.label === 'string') section.label = text(s.label)
    if (s.hidden === true) section.hidden = true
    if (Array.isArray(s.blocks)) section.blocks = shapeBlocks(s.blocks, 1, `${s.id}/blocks`, notes)
    // A section of the view's own with nothing to draw never shows.
    if (!BUILT_IN.includes(s.id) && !section.hidden && !section.blocks?.length) notes.push({ at: `sections/${i}`, kind: 'section', detail: s.id })
    sections.push(section)
  }
  const theme = isObject(raw.theme) ? { light: shapeTokens(raw.theme.light, 'theme/light', notes), dark: shapeTokens(raw.theme.dark, 'theme/dark', notes) } : undefined
  return compact({ title: text(raw.title) || undefined, theme: theme?.light || theme?.dark ? theme : undefined, sections, notes: notes.length ? notes : undefined })
}

// The pointers of a shaped view that find nothing in this session: a wrong path, or data the session does not have yet.
export function unresolved(view: WebView, s: unknown): ViewNote[] {
  const notes: ViewNote[] = []
  const walk = (b: ViewBlock, section: string): void => {
    // By its label: the place in the file is not known here, where dropped blocks are gone.
    const miss = (detail: string) => void notes.push({ at: `${section}/${'type' in b ? b.type : ''} ${'label' in b ? b.label : ''}`.trimEnd(), kind: 'empty', detail: detail.slice(0, 60) })
    // A field is checked on the rows there are: with none, nothing says it is wrong.
    const fields = (rows: unknown[], list: (string | undefined)[]) => {
      for (const f of list) if (f && rows.length > 0 && !rows.some(r => pick(r, f) !== undefined)) miss(f)
    }
    if ('panel' in b) return
    if ('children' in b) return b.children.forEach(c => walk(c, section))
    if (b.type === 'Text') return
    const from = b.type === 'List' ? b.items : b.type === 'Sparkline' ? b.points : b.type === 'Table' || b.type === 'Bars' ? b.rows : b.value
    if (pick(s, from) === undefined) return miss(from)
    const rows = sourceRows(s, from)
    if (b.type === 'List' || b.type === 'Sparkline' || b.type === 'Stat') return fields(rows, [b.field])
    if (b.type === 'Table') return fields(rows, [b.group, ...b.columns.filter(c => c.agg || b.group === undefined).map(c => c.field)])
    if (b.type === 'Bars') return fields(rows, [b.group, b.value, b.group === undefined ? b.name : undefined])
  }
  for (const section of view.sections) section.blocks?.forEach(b => walk(b, section.id))
  return notes
}

// What the notes box lists. A view that comes with the mod is held to the sample session by a test, so data a new session lacks is no fault of its file.
export function notesOf(view: WebView | undefined, s: unknown, isShipped: boolean): ViewNote[] {
  return view && s !== undefined ? [...(view.notes ?? []), ...(isShipped ? [] : unresolved(view, s))] : []
}

// A number as a percent of its top, held to the dial: past the top it stands at the end.
export const pctOf = (v: unknown, top: number) => (isNumber(v) ? Math.max(0, Math.min(100, Math.round((v / top) * 100))) : undefined)

// The view's sections in its order, then the built-in ones it does not name, so a view never hides data by leaving it out. A custom section needs blocks.
export function orderSections<T extends { id: string; label: string }>(builtIn: readonly T[], view: WebView | undefined, custom: (id: string, label: string) => T): (T & { blocks?: ViewBlock[] })[] {
  if (!view) return [...builtIn]
  const named = new Set(view.sections.map(s => s.id))
  const listed = view.sections.flatMap(s => {
    if (s.hidden) return []
    const base = builtIn.find(b => b.id === s.id)
    if (!base && !s.blocks?.length) return []
    const x = base ?? custom(s.id, s.label || s.id)
    return [{ ...x, ...(s.label ? { label: s.label } : {}), ...(s.blocks?.length ? { blocks: s.blocks } : {}) }]
  })
  return [...listed, ...builtIn.filter(b => !named.has(b.id))]
}

// The chosen view, checked; undefined for the default page, or when the file is gone or broken.
export function viewOf(list: ViewList, name: string): WebView | undefined {
  const entry = name ? list.views.find(v => v.name === name) : undefined
  return entry?.view === undefined ? undefined : shapeView(entry.view)
}

const rule = (selector: string, tokens: Record<string, string> | undefined) => (tokens ? `${selector}{${Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';')}}` : '')

// The view's colours, under the same selectors as `theme.css`, so the auto theme still follows the system. Only checked tokens reach here.
export function themeCss(theme: WebView['theme']): string {
  if (!theme) return ''
  const dark = rule(':root:not([data-theme="light"])', theme.dark)
  return [rule(':root', theme.light), dark ? `@media (prefers-color-scheme: dark){${dark}}` : '', rule(':root[data-theme="dark"]', theme.dark)].filter(Boolean).join('\n')
}
