// Serves the fixture and screenshots the page in light, dark and at phone width, for review: `npm i --no-save playwright && npx playwright install chromium && node scripts/web-shot.mjs <out dir>`.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = '47390'
const out = process.argv[2] ?? '.'
const server = spawn(process.execPath, [join(ROOT, 'server/web.mjs'), 'serve', PORT, '--fixture', join(ROOT, 'tests/fixtures/snapshot.json')], { stdio: 'inherit' })
await new Promise(done => setTimeout(done, 500))

const browser = await chromium.launch()
const shots = [
  ['light', 'light', 1280],
  ['dark', 'dark', 1280],
  ['phone', 'light', 390],
]
const problems = []
for (const [name, colorScheme, width] of shots) {
  const page = await browser.newPage({ colorScheme, viewport: { width, height: 900 } })
  page.on('pageerror', e => problems.push(`${name}: ${e.message}`))
  page.on('console', m => m.type() === 'error' && problems.push(`${name}: ${m.text()}`))
  page.on('dialog', d => (problems.push(`${name}: a log line ran as script`), d.dismiss()))
  await page.goto(`http://127.0.0.1:${PORT}/`)
  await page.waitForSelector('.tile')
  await page.evaluate(() => document.fonts.ready)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 0) problems.push(`${name}: the page scrolls sideways by ${overflow} px`)
  await page.screenshot({ path: join(out, `web-${name}.png`), fullPage: true })
  await page.close()
}
await browser.close()
server.kill()
console.log(problems.length ? problems.join('\n') : 'no script errors, no sideways scroll')
process.exitCode = problems.length ? 1 : 0
