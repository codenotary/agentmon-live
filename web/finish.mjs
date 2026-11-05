// After `vite build`: stamps the page, places it where the server reads it, and collects the notices of what it bundles.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sourceHash } from './source-hash.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '../server')

const built = readFileSync(join(HERE, 'dist/index.html'), 'utf8')
if (!built.includes('<head>')) throw new Error('the built page has no <head>')
writeFileSync(join(SERVER, 'app.html'), built.replace('<head>', () => `<head>\n<meta name="agentmon-source" content="${sourceHash()}">`))

const lock = JSON.parse(readFileSync(join(HERE, 'package-lock.json'), 'utf8'))
const notices = Object.entries(lock.packages)
  .filter(([path, p]) => path && !p.dev && !p.optional)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, p]) => {
    const dir = join(HERE, path)
    const file = existsSync(dir) ? readdirSync(dir).find(f => /^(licen[sc]e|copying|notice)/i.test(f)) : undefined
    const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${p.license ?? 'see the package'}`
    return `${path.replace(/^.*node_modules\//, '')} ${p.version}\n\n${text}\n`
  })
writeFileSync(join(SERVER, 'third-party-licenses.txt'), `${notices.join(`\n${'-'.repeat(72)}\n\n`)}`)
