// `node view-check.mjs <view.json> [snapshot.json]`: what the page will leave out of a view file, and the pointers that find nothing in a session. Without a snapshot it takes the sample one beside the tests, when the mod came with it.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { shapeView, unresolved } from './view-shape.mjs'

const [file, given] = process.argv.slice(2)
if (!file) {
  console.error('usage: node view-check.mjs <view.json> [snapshot.json]')
  process.exit(2)
}
const sample = join(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/snapshot.json')
const snapshot = given ?? (existsSync(sample) ? sample : undefined)
let notes
try {
  const view = shapeView(JSON.parse(readFileSync(file, 'utf8')))
  notes = [...(view.notes ?? []), ...(snapshot ? unresolved(view, JSON.parse(readFileSync(snapshot, 'utf8'))) : [])]
} catch (e) {
  console.error(`cannot read: ${e.message}`)
  process.exit(2)
}
for (const n of notes) console.log(`${n.at}: ${n.kind}${n.detail ? ` ${n.detail}` : ''}`)
if (notes.length === 0) console.log('ok')
process.exit(notes.length ? 1 : 0)
