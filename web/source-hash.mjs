// The hash finish.mjs writes into the built page and the test recomputes, so a page older than its source fails the check.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

export function sourceHash() {
  const files = [...walk(join(HERE, 'src')), join(HERE, 'index.html'), join(HERE, 'package-lock.json')].sort()
  const hash = createHash('sha256')
  for (const f of files) hash.update(relative(HERE, f)).update('\0').update(readFileSync(f)).update('\0')
  return hash.digest('hex')
}
