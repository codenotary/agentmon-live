// The hash finish.mjs writes into the built page and the test recomputes, so a page older than its source fails the check.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// What a build places beside `server/app.html`, and the list `server/web.mjs` serves.
export const BUILT = ['vendor.js', 'app.js', 'app.css']

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

export function sourceHash() {
  const files = [...walk(join(HERE, 'src')), join(HERE, 'index.html'), join(HERE, 'package-lock.json'), join(HERE, 'vite.config.ts'), join(HERE, 'finish.mjs')].sort()
  const hash = createHash('sha256')
  for (const f of files) hash.update(relative(HERE, f)).update('\0').update(readFileSync(f)).update('\0')
  return hash.digest('hex')
}

// So a test tells when these files are not the set one build made: a merge can take each from another branch.
export function builtHash() {
  const hash = createHash('sha256')
  for (const f of BUILT) hash.update(f).update('\0').update(readFileSync(join(HERE, '../server', f))).update('\0')
  return hash.digest('hex')
}
