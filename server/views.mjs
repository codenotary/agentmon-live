import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { withFile } from './spool.mjs'

export const MAX_VIEW = 64 * 1024
const KEEP_VIEWS = 64
const NAME = /^[a-z0-9-]{1,40}$/

const readSmall = path =>
  withFile(path, (fd, stat) => {
    if (!stat.isFile()) throw new Error('not a file')
    if (stat.size > MAX_VIEW) throw new Error(`larger than ${MAX_VIEW / 1024} KB`)
    return readFileSync(fd, 'utf8')
  })

// The views that come with the mod; a file of the same name in the person's folder takes its place.
export const SHIPPED = join(dirname(fileURLToPath(import.meta.url)), 'views')

// The views Claude wrote to this folder, and the one chosen from chat, then the views of `shipped` the folder does not name. A broken file is listed with its error, so the page can say what is wrong. The page checks each view's shape.
export function readViews(dir, shipped) {
  const own = readFolder(dir)
  if (shipped === undefined) return own
  const named = new Set(own.views.map(v => v.name))
  return { views: [...own.views, ...readFolder(shipped).views.filter(v => !named.has(v.name)).map(v => ({ ...v, isShipped: true }))], active: own.active }
}

function readFolder(dir) {
  let names
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.json')).sort().slice(0, KEEP_VIEWS)
  } catch {
    return { views: [], active: '' }
  }
  const views = []
  for (const file of names) {
    const name = file.slice(0, -5)
    if (!NAME.test(name)) {
      views.push({ name: file, error: 'name must be a-z, 0-9 and -, at most 40' })
      continue
    }
    try {
      const view = JSON.parse(readSmall(join(dir, file)))
      if (view === null || typeof view !== 'object' || Array.isArray(view)) throw new Error('not a JSON object')
      views.push({ name, view })
    } catch (e) {
      views.push({ name, error: e instanceof SyntaxError ? `bad JSON: ${e.message}` : String(e.message ?? e) })
    }
  }
  let active = ''
  try {
    active = readSmall(join(dir, 'active')).trim()
  } catch {
    // No choice from chat: the page keeps its own.
  }
  return { views, active: NAME.test(active) ? active : '' }
}
