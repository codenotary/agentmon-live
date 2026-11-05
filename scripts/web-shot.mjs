// Serves the fixture, screenshots the page in light, dark, at phone width, with the palette and with a call's details open, and checks the navigation: `npm i --no-save playwright && npx playwright install chromium && node scripts/web-shot.mjs <out dir>`.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = '47390'
const out = process.argv[2] ?? '.'
const server = spawn(process.execPath, [join(ROOT, 'server/web.mjs'), 'serve', PORT, '--fixture', join(ROOT, 'tests/fixtures/snapshot.json')], { stdio: 'inherit' })
process.on('exit', () => server.kill())
await new Promise(done => setTimeout(done, 500))

const browser = await chromium.launch()
const shots = [
  ['light', 'light', 1440],
  ['dark', 'dark', 1440],
  ['phone', 'dark', 390],
  ['palette', 'dark', 1440, page => page.keyboard.press('Control+k')],
  ['drawer', 'dark', 1440, async page => { await page.click('.nav-item[href="#/calls"]'); await page.click('#calls tbody tr') }],
]
const problems = []
for (const [name, colorScheme, width, act] of shots) {
  const page = await browser.newPage({ colorScheme, viewport: { width, height: 900 } })
  page.on('pageerror', e => problems.push(`${name}: ${e.message}`))
  page.on('console', m => m.type() === 'error' && problems.push(`${name}: ${m.text()}`))
  page.on('dialog', d => (problems.push(`${name}: a log line ran as script`), d.dismiss()))
  await page.goto(`http://127.0.0.1:${PORT}/`)
  await page.waitForSelector('[data-testid=instruments]')
  await page.evaluate(() => document.fonts.ready)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 0) problems.push(`${name}: the page scrolls sideways by ${overflow} px`)
  await act?.(page)
  await page.waitForTimeout(act ? 400 : 900)
  await page.screenshot({ path: join(out, `web-${name}.png`), fullPage: !act })
  await page.close()
}

// Every rail link shows its view and marks only itself; the back button returns; a deep link and an unknown one load.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const PANELS = { overview: 'waterfall', calls: 'calls', verification: 'verification', agents: 'agents', files: 'files', log: 'log', learning: 'learning' }
const marked = () => page.$$eval('.nav-item[aria-current]', list => list.map(a => a.getAttribute('href')))
await page.goto(`http://127.0.0.1:${PORT}/`)
await page.waitForSelector('[data-testid=nav]')
for (const [view, panel] of Object.entries(PANELS)) {
  await page.click(`.nav-item[href="#/${view}"]`)
  await page.waitForSelector(`#${panel}`, { timeout: 2000 }).catch(() => problems.push(`nav: ${view} did not show #${panel}`))
  const at = await marked()
  if (at.join() !== `#/${view}`) problems.push(`nav: ${view} marked ${at.join()}`)
}
await page.goBack()
await page.waitForSelector('#log', { timeout: 2000 }).catch(() => problems.push('nav: back did not return to the log'))
await page.keyboard.press('Escape')
await page.goto(`http://127.0.0.1:${PORT}/#/files`)
await page.reload()
await page.waitForSelector('#files', { timeout: 2000 }).catch(() => problems.push('nav: the deep link did not load'))
await page.goto(`http://127.0.0.1:${PORT}/#/nonsense`)
await page.reload()
await page.waitForSelector('#waterfall', { timeout: 2000 }).catch(() => problems.push('nav: an unknown link did not show the overview'))
await page.click('.nav-item[href="#/calls"]')
await page.keyboard.press('/')
if (await page.evaluate(() => document.activeElement?.id) !== 'q') problems.push('nav: / did not reach the log search')

await browser.close()
server.kill()
console.log(problems.length ? problems.join('\n') : 'no script errors, no sideways scroll')
process.exitCode = problems.length ? 1 : 0
