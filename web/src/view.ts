import type { ViewBlock, ViewFormat, ViewList, ViewPanel, ViewSection, WebView } from '../../types/index'
import { dur, kilo, usdText } from './format.ts'

export const BUILT_IN = ['overview', 'calls', 'verification', 'agents', 'files', 'log'] as const
export const PANELS: readonly ViewPanel[] = ['Instruments', 'Flow', 'Waterfall', 'TurnClock', 'Events', 'Running', 'Steps', 'Calls', 'Insights', 'Checks', 'Tasks', 'Agents', 'Files', 'Log']
// The colour tokens of `theme.css`; a test holds this list to that file.
export const TOKENS: readonly string[] = ['--page', '--surface', '--surface-1', '--surface-2', '--surface-3', '--header', '--line', '--line-soft', '--line-input', '--ink', '--heading', '--ink-2', '--ink-3', '--signal', '--signal-bright', '--signal-soft', '--good', '--warn', '--bad', '--good-soft', '--warn-soft', '--bad-soft', '--info', '--info-line', '--ramp-1', '--ramp-2', '--ramp-3', '--ramp-4', '--ramp-5', '--ramp-other']
const FORMATS: readonly ViewFormat[] = ['usd', 'count', 'dur', 'pct']
const CONTAINERS = ['Row', 'Column', 'Card']
// Nothing that can end a declaration or open another rule: no `;`, `}`, `!`, quotes or nested parentheses.
const COLOUR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch)\([\d.,%/\s+a-z-]*\))$/i
const MAX_DEPTH = 6
const MAX_CHILDREN = 24
const MAX_TEXT = 200
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
    if (format === 'dur') return dur(v)
    if (format === 'pct') return `${Math.round(v)}%`
    return String(v)
  }
  return typeof v === 'string' || typeof v === 'boolean' ? String(v) : '—'
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '')
const pointer = (v: unknown) => (typeof v === 'string' && (v === '' || v.startsWith('/')) ? v.slice(0, MAX_TEXT) : undefined)

function shapeBlock(raw: unknown, depth: number): ViewBlock | undefined {
  if (!isObject(raw) || depth > MAX_DEPTH) return undefined
  if ('panel' in raw) return PANELS.includes(raw.panel as ViewPanel) ? { panel: raw.panel as ViewPanel } : undefined
  const children = () => shapeBlocks(raw.children, depth + 1)
  switch (raw.type) {
    case 'Row':
    case 'Column':
      return { type: raw.type, children: children() }
    case 'Card':
      return { type: 'Card', title: text(raw.title), children: children() }
    case 'Text':
      return { type: 'Text', text: text(raw.text) }
    case 'Stat': {
      const value = pointer(raw.value)
      return value === undefined ? undefined : { type: 'Stat', label: text(raw.label), value, format: FORMATS.includes(raw.format as ViewFormat) ? raw.format as ViewFormat : undefined }
    }
    case 'List': {
      const items = pointer(raw.items)
      const max = typeof raw.max === 'number' && raw.max >= 1 ? Math.min(Math.floor(raw.max), 50) : 10
      return items === undefined ? undefined : { type: 'List', label: text(raw.label), items, field: pointer(raw.field), max }
    }
    case 'Sparkline': {
      const points = pointer(raw.points)
      return points === undefined ? undefined : { type: 'Sparkline', label: text(raw.label), points, field: pointer(raw.field) }
    }
    default:
      return undefined
  }
}

function shapeBlocks(raw: unknown, depth: number): ViewBlock[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_CHILDREN).map(b => shapeBlock(b, depth)).filter(b => b !== undefined)
}

function shapeTokens(raw: unknown): Record<string, string> | undefined {
  if (!isObject(raw)) return undefined
  const kept = Object.entries(raw).filter(([k, v]) => TOKENS.includes(k) && typeof v === 'string' && COLOUR.test(v.trim()))
  return kept.length ? Object.fromEntries(kept.map(([k, v]) => [k, (v as string).trim()])) : undefined
}

// What the page draws of a view file: blocks, panels and tokens outside the catalog are dropped, so a file Claude got wrong still shows what it got right.
export function shapeView(raw: unknown): WebView {
  if (!isObject(raw)) return { sections: [] }
  const seen = new Set<string>()
  const sections: ViewSection[] = []
  for (const s of Array.isArray(raw.sections) ? raw.sections.slice(0, MAX_CHILDREN) : []) {
    if (!isObject(s) || typeof s.id !== 'string' || !ID.test(s.id) || seen.has(s.id)) continue
    seen.add(s.id)
    const section: ViewSection = { id: s.id }
    if (typeof s.label === 'string') section.label = text(s.label)
    if (s.hidden === true) section.hidden = true
    if (Array.isArray(s.blocks)) section.blocks = shapeBlocks(s.blocks, 1)
    sections.push(section)
  }
  const theme = isObject(raw.theme) ? { light: shapeTokens(raw.theme.light), dark: shapeTokens(raw.theme.dark) } : undefined
  return { title: text(raw.title) || undefined, theme: theme?.light || theme?.dark ? theme : undefined, sections }
}

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
