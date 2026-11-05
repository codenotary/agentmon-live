// Serves the fixture, screenshots the page in light, dark, at phone width, with the palette and with a call's details open, and checks the navigation: `npm i --no-save playwright && npx playwright install chromium && node scripts/web-shot.mjs <out dir>`.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
  ['drawer', 'dark', 1440, page => page.click('#calls tbody tr')],
]
const problems = []
for (const [name, colorScheme, width, act] of shots) {
  const page = await browser.newPage({ colorScheme, viewport: { width, height: 900 } })
  await page.addInitScript(theme => localStorage.setItem('agentmon-live-theme', theme), colorScheme)
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

// Every rail link brings its own section under the header and marks only itself, in rail order down the page; the back button, a deep link and an unknown link work. No motion, so nothing waits on a smooth scroll.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
const url = `http://127.0.0.1:${PORT}/`
const links = () => page.$$eval('.nav-item', list => list.map(a => a.getAttribute('href')))
const marked = () => page.$$eval('.nav-item[aria-current]', list => list.map(a => a.getAttribute('href')))
const topOf = href => page.$eval(href, el => Math.round(el.getBoundingClientRect().top))
await page.goto(url)
await page.waitForSelector('[data-testid=nav]')
let lastY = -1
for (const href of await links()) {
  await page.click(`.nav-item[href="${href}"]`)
  await page.waitForTimeout(150)
  const top = await topOf(href)
  if (Math.abs(top - 69) > 2) problems.push(`nav: ${href} landed at ${top}, not under the header`)
  const y = await page.evaluate(() => scrollY)
  if (y <= lastY) problems.push(`nav: ${href} did not move down the page (${lastY} then ${y})`)
  lastY = y
  const at = await marked()
  if (at.join() !== href) problems.push(`nav: ${href} marked ${at.join()}`)
}
const [first, second] = await links()
await page.click(`.nav-item[href="${first}"]`)
await page.click(`.nav-item[href="${second}"]`)
await page.goBack()
await page.waitForTimeout(150)
if (new URL(page.url()).hash !== first) problems.push('nav: back did not return')
await page.goto(`${url}#section-log`)
await page.reload()
await page.waitForSelector('#log')
await page.waitForTimeout(150)
if (Math.abs(await topOf('#section-log') - 69) > 2) problems.push('nav: the deep link did not land')
await page.goto(`${url}#nonsense`)
await page.reload()
await page.waitForSelector('#waterfall')
await page.keyboard.press('/')
if (await page.evaluate(() => document.activeElement?.id) !== 'q') problems.push('nav: / did not reach the log search')

// Every widget has its i, and it opens its own text.
const widgets = await page.$$eval('main .panel, main .kpi-band', list => list.length)
const buttons = await page.$$('.help-btn')
if (buttons.length !== widgets) problems.push(`help: ${widgets} widgets and ${buttons.length} i buttons`)
for (const b of buttons) await b.click()
const texts = await page.$$eval('.help-text', list => list.length)
if (texts !== widgets) problems.push(`help: opened ${texts} of ${widgets} texts`)

// A second session turns the working directory into a switch, and picking it shows that session.
const other = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/snapshot.json'), 'utf8'))
other.session.cwd = '/home/dev/other-project'
other.session.branch = 'main'
await fetch(`${url.slice(0, -1)}/state/second`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(other) })
await page.goto(url)
await page.waitForSelector('#picker')
const inBar = await page.$eval('header', h => h.textContent)
if (!/\d+\.\d+\.\d+ · [0-9a-f]{7}/.test(inBar)) problems.push('build: the top bar shows no version and commit')
if ((inBar.match(/other-project/g) ?? []).length !== 1) problems.push('switch: the top bar does not show the folder once, in the switch')
if (!await page.$('#picker .state-dot')) problems.push('switch: no state dot on the switch')
await page.click('#picker')
await page.waitForSelector('[role=option][data-state=checked]')
if ((await page.$$('[role=option] .state-dot')).length !== 2) problems.push('switch: not every session in the list has its state dot')
await page.screenshot({ path: join(out, 'web-switch.png') })
await page.click('[role=option]:has-text("agent-radar")')
await page.waitForFunction(() => document.querySelector('#picker')?.textContent.includes('agent-radar'), null, { timeout: 2000 }).catch(() => problems.push('switch: picking a session did not show it'))

await browser.close()
server.kill()
console.log(problems.length ? problems.join('\n') : 'no script errors, no sideways scroll')
process.exitCode = problems.length ? 1 : 0
