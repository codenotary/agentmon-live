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
  ['narrow', 'dark', 620],
  ['palette', 'dark', 1440, page => page.keyboard.press('Control+k')],
  ['drawer', 'dark', 1440, page => page.click('#calls tbody tr')],
  ['agents', 'dark', 1440, async page => { for (const row of await page.locator('[data-testid=agents] tr[data-line]').all()) await row.click() }],
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
  await page.screenshot({ path: join(out, `web-${name}.png`), fullPage: !act || name === 'agents' })
  await page.close()
}

// Every rail link brings its own section under the header and marks only itself, in rail order down the page; the back button, a deep link and an unknown link work. No motion, so nothing waits on a smooth scroll.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
const url = `http://127.0.0.1:${PORT}/`
const links = () => page.$$eval('.nav-item', list => list.map(a => a.getAttribute('href')))
const marked = () => page.$$eval('.nav-item[aria-current]', list => list.map(a => a.getAttribute('href')))
const topOf = href => page.$eval(href, el => Math.round(el.getBoundingClientRect().top))
await page.goto(url)
// With no choice saved, the page starts dark, even on a system set to light.
if (await page.evaluate(() => document.documentElement.dataset.theme) !== 'dark') problems.push('theme: the default is not dark')
await page.waitForSelector('[data-testid=nav]')
let lastY = -1
for (const href of await links()) {
  await page.click(`.nav-item[href="${href}"]`)
  await page.waitForTimeout(150)
  const top = await topOf(href)
  const y = await page.evaluate(() => scrollY)
  const atEnd = await page.evaluate(() => innerHeight + scrollY >= document.documentElement.scrollHeight - 2)
  if (Math.abs(top - 69) > 2 && !(atEnd && top > 69)) problems.push(`nav: ${href} landed at ${top}, not under the header`)
  if (y < lastY || (y === lastY && !atEnd)) problems.push(`nav: ${href} did not move down the page (${lastY} then ${y})`)
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
await page.goto(`${url}#section-agents`)
await page.reload()
await page.waitForSelector('#agents')
await page.waitForTimeout(150)
if (Math.abs(await topOf('#section-agents') - 69) > 2) problems.push('nav: the deep link did not land')
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

// Dragging on the flow's strip picks a time and leaves Follow; Follow comes back; a lane name filters Tool calls.
await page.$eval('[data-testid=flow-brush]', el => el.scrollIntoView({ block: 'center' }))
const strip = await page.locator('[data-testid=flow-brush]').boundingBox()
await page.mouse.move(strip.x + strip.width * 0.2, strip.y + 10)
await page.mouse.down()
await page.mouse.move(strip.x + strip.width * 0.4, strip.y + 10)
const waterfallText = () => page.locator('#waterfall').innerText()
const beforeDrag = `${await page.locator('#waterfall header').innerText()}`
await page.mouse.up()
const follow = page.locator('#flow .chip', { hasText: 'Follow' })
if (await follow.getAttribute('aria-pressed') !== 'false') problems.push('flow: a drag did not leave Follow')
await page.waitForTimeout(100)
const picked = await waterfallText()
const dragged = await page.locator('#waterfall header').innerText()
await follow.click()
await page.waitForTimeout(100)
if (picked === await waterfallText()) problems.push('flow: a drag did not change what the waterfall shows')
if (dragged !== beforeDrag && (await page.locator('#waterfall header').innerText()) === dragged) problems.push('flow: Follow did not bring the waterfall back')
// The chosen window itself can be dragged, also from where it follows the present.
const grip = await page.locator('[data-testid=flow-window]').boundingBox()
await page.mouse.move(grip.x + grip.width / 2, grip.y + 10)
await page.mouse.down()
await page.mouse.move(grip.x + grip.width / 2 - strip.width * 0.2, grip.y + 10)
await page.mouse.up()
await page.waitForTimeout(100)
const moved = await page.locator('[data-testid=flow-window]').boundingBox()
if (Math.abs(moved.x - grip.x) < 20) problems.push(`flow: dragging the window did not move it (${grip.x} then ${moved.x})`)
await follow.click()
// Hovering a dot says what the call was.
await page.locator('#flow .flow-dot').first().hover({ force: true })
if (!await page.locator('#flow .pop').isVisible()) problems.push('flow: no tooltip on a dot')
// The chart holds still under the pointer, so a dot can be clicked for its details.
const dotX = () => page.locator('#flow .flow-dot').first().getAttribute('cx')
const heldAt = await dotX()
await page.waitForTimeout(3500)
if (await dotX() !== heldAt) problems.push('flow: the chart moved under the pointer')
await page.locator('#flow .flow-dot').first().click({ force: true })
if (!await page.locator('[data-testid=drawer]').isVisible()) problems.push('flow: clicking a dot did not open its details')
await page.keyboard.press('Escape')
await page.mouse.move(0, 0)
// Away from the pointer it redraws in steps, not every second.
await page.waitForTimeout(300)
const steps = new Set()
for (let i = 0; i < 7; i++) {
  steps.add(await dotX())
  await page.waitForTimeout(500)
}
if (steps.size > 3) problems.push(`flow: ${steps.size} positions in 3.5 s, not steps`)
// With motion allowed, those steps join into a glide, and the glide stops under the pointer.
const gliding = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await gliding.goto(url)
const lastDot = gliding.locator('#flow .flow-dot').last()
await lastDot.waitFor({ state: 'attached' })
await lastDot.scrollIntoViewIfNeeded()
await gliding.waitForTimeout(3500)
const screenX = async () => (await lastDot.boundingBox())?.x
const glided = new Set()
for (let i = 0; i < 7; i++) {
  glided.add(await screenX())
  await gliding.waitForTimeout(300)
}
if (glided.size < 5) problems.push(`flow: ${glided.size} positions in 2 s, not a glide`)
await gliding.locator('[data-testid=flow] svg:not(.flow-brush)').hover({ force: true })
await gliding.waitForTimeout(100)
const stoppedAt = await screenX()
await gliding.waitForTimeout(1000)
if (await screenX() !== stoppedAt) problems.push('flow: the glide went on under the pointer')
await gliding.close()
// A mark that holds several calls lists them, and each opens its details.
await page.locator('[data-testid=flow]').focus()
for (let i = 0; i < 20 && !await page.$('#flow .flow-mark'); i++) await page.keyboard.press(']')
if (await page.$('#flow .flow-mark')) {
  await page.locator('#flow .flow-mark').first().click({ force: true })
  const inList = await page.locator('[data-testid=flow-list] button').count()
  if (inList < 2) problems.push(`flow: a merged mark listed ${inList} calls`)
  await page.screenshot({ path: join(out, 'web-flow-list.png') })
  await page.keyboard.press('Escape')
  if (await page.$('[data-testid=flow-list]')) problems.push('flow: Escape did not close the list')
  await page.locator('#flow .flow-mark').first().click({ force: true })
  await page.locator('[data-testid=flow-list] button').first().click()
  if (!await page.locator('[data-testid=drawer]').isVisible()) problems.push('flow: a listed call did not open its details')
  await page.keyboard.press('Escape')
} else problems.push('flow: no merged mark at the widest time')
for (let i = 0; i < 20; i++) await page.keyboard.press('[')
await page.mouse.move(0, 0)
if (await follow.getAttribute('aria-pressed') !== 'true') problems.push('flow: Follow did not come back')
await page.locator('.flow-label', { hasText: 'Run the server tests' }).click()
if (!await page.$('#calls .chip[aria-pressed=true]:has-text("Run the server tests")')) problems.push('flow: a lane name did not filter Tool calls')
await page.locator('#calls .chip', { hasText: 'Run the server tests' }).click()

// Events filter by kind: the fixture has a failed test and one other item.
await page.locator('[data-testid=event-kinds] [data-kind=failures]').click()
const eventRows = page.locator('[data-testid=events] li')
if (await eventRows.count() !== 1 || !await page.locator('[data-testid=events] li.bad').count()) problems.push(`events: Failures shows ${await eventRows.count()} rows, not the one failed test`)
await page.locator('[data-testid=event-kinds] [data-kind=all]').click()
if (await eventRows.count() < 2) problems.push('events: All did not bring the other events back')

// Every rail item is a section with a heading that folds it; the fold survives a reload, and the rail or a link opens it again.
const heads = await page.locator('.section-head').count()
if (heads !== (await links()).length) problems.push(`sections: ${heads} headings for ${(await links()).length} rail items`)
await page.click('#section-files .section-head')
if (await page.locator('#files').isVisible()) problems.push('sections: the heading did not fold Files')
await page.reload()
await page.waitForSelector('#section-files .section-head')
if (await page.locator('#files').isVisible()) problems.push('sections: the fold did not survive a reload')
await page.screenshot({ path: join(out, 'web-folded.png'), fullPage: true })
await page.click('.nav-item[href="#section-files"]')
if (!await page.locator('#files').isVisible()) problems.push('sections: the rail did not open Files')
await page.click('#section-log .section-head')
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('/')
await page.waitForTimeout(50)
if (await page.evaluate(() => document.activeElement?.id) !== 'q') problems.push('sections: / did not open the log and reach its search')

// The top bar says how the done gate ended, the Context gauge opens what fills it, and the keys reach rows and sections.
if (!await page.locator('[data-testid=gate-chip]').isVisible()) problems.push('gate: no chip in the top bar')
await page.locator('[data-testid=context-gauge]').click()
if (!await page.locator('[data-testid=context-parts]').isVisible()) problems.push('context: the gauge did not open what fills it')
await page.locator('[data-testid=context-gauge]').click()
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('g')
await page.keyboard.press('a')
await page.waitForTimeout(150)
if (Math.abs(await topOf('#section-agents') - 69) > 2) problems.push('keys: g a did not reach Subagents')
await page.keyboard.press('j')
if (!await page.evaluate(() => document.activeElement?.matches('main tr[tabindex]'))) problems.push('keys: j did not reach a row')
await page.keyboard.press('Tab')

// A column head sorts Tool calls, and a copy says how it went.
await page.click('#sort-what')
if (await page.$eval('#calls th:has(#sort-what)', th => th.getAttribute('aria-sort')) !== 'ascending') problems.push('calls: a column head did not sort')
await page.click('#calls tbody tr')
await page.click('[data-testid=drawer] button:has-text("Copy")')
await page.waitForSelector('[data-testid=notice]', { timeout: 2000 }).catch(() => problems.push('notice: a copy said nothing'))
await page.keyboard.press('Escape')

// A second session turns the working directory into a switch, and picking it shows that session.
const other = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/snapshot.json'), 'utf8'))
other.session.cwd = '/home/dev/other-project'
other.session.branch = 'main'
// Drawn as a session of an older version: no window size, no resets, no bench rows.
other.usage = { ctxPct: other.usage.ctxPct, rate: other.usage.rate.map(({ kind, pct }) => ({ kind, pct })), usd: other.usage.usd }
other.learned.bench = []
other.insights = Object.fromEntries(Object.entries(other.insights).filter(([k]) => !['reads', 'edits', 'sizes'].includes(k)))
other.checks = [{ kind: 'test', command: 'npm test', who: 'main session', at: other.now - 600000, result: 'ok' }]
other.agents = other.agents.map(a => ({ ...a, status: 'done', endedAt: a.endedAt ?? a.startedAt + 1000 }))
await fetch(`${url.slice(0, -1)}/state/second`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(other) })
await page.goto(url)
await page.waitForSelector('#picker')
const inBar = await page.$eval('header', h => h.textContent)
if (!/\d+\.\d+\.\d+ · [0-9a-f]{7}/.test(inBar)) problems.push('build: the top bar shows no version and commit')
const edits = await page.$eval('[data-testid=test-edits]', el => el.textContent)
if (!/assertions changed: 1/.test(edits) || !edits.includes("+ expect(parse('b')).toBe(3)") || !edits.includes("- expect(parse('c')).toThrow()")) problems.push('review: the panel shows no changed assertions or lines')
if ((inBar.match(/other-project/g) ?? []).length !== 1) problems.push('switch: the top bar does not show the folder once, in the switch')
if (!await page.$('#picker .state-dot')) problems.push('switch: no state dot on the switch')
await page.click('#picker')
await page.waitForSelector('[role=option][data-state=checked]')
if ((await page.$$('[role=option] .state-dot')).length !== 2) problems.push('switch: not every session in the list has its state dot')
await page.screenshot({ path: join(out, 'web-switch.png') })
await page.click('[role=option]:has-text("agent-radar")')
await page.waitForFunction(() => document.querySelector('#picker')?.textContent.includes('agent-radar'), null, { timeout: 2000 }).catch(() => problems.push('switch: picking a session did not show it'))
// The list's last entry opens AgentMon Start in a new tab and leaves the session as it was.
await page.context().route('https://codenotary.com/**', r => r.fulfill({ body: '' }))
await page.click('#picker')
if (!/AgentMon Start/.test(await page.locator('[role=option]').last().textContent())) problems.push('switch: AgentMon Start is not the last entry')
const [startTab] = await Promise.all([page.context().waitForEvent('page'), page.click('[data-testid=start-link]')])
await startTab.waitForLoadState().catch(() => {})
if (startTab.url() !== 'https://codenotary.com/agentmon-start') problems.push(`switch: the last entry opened ${startTab.url()}`)
await startTab.close()
if (!(await page.locator('#picker').textContent()).includes('agent-radar')) problems.push('switch: the last entry changed the session')
// The flow is open while an agent runs and folded when none does; the arrow opens and folds it.
const isFlowOpen = () => page.locator('[data-testid=flow]').isVisible()
const folded = page.locator('[data-testid=flow-fold]')
await page.waitForTimeout(300)
if (!await isFlowOpen()) problems.push('flow: folded with an agent running')
await page.click('#picker')
await page.click('[role=option]:has-text("other-project")')
await page.waitForTimeout(300)
if (await page.locator('[data-testid=instruments] [data-testid=ruler]').count() !== 3) problems.push('instruments: with no history, cost and turns should still have a ruler')
if (await page.locator('[data-testid=pace-tick]').count()) problems.push('instruments: a pace tick with no reset time')
if (await isFlowOpen()) problems.push('flow: open with no agent running')
await folded.click()
await page.waitForTimeout(100)
if (!await isFlowOpen()) problems.push('flow: the arrow did not open it')
await page.screenshot({ path: join(out, 'web-flow-opened.png') })
await folded.click()
await page.waitForTimeout(100)
if (await isFlowOpen()) problems.push('flow: the arrow did not fold it')
await page.screenshot({ path: join(out, 'web-flow-folded.png') })

// The log filters and jumps; older sessions lack the file counts and still draw.
const logPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
logPage.on('pageerror', e => problems.push(`log: ${e.message}`))
await logPage.goto(`${url}#section-log`)
const logRowsBox = logPage.locator('[data-testid=log-rows]')
await logRowsBox.waitFor()
const allCount = await logRowsBox.locator(':scope > *').count()
await logPage.click('[data-chip=failures]')
await logPage.waitForTimeout(100)
const failedCount = await logRowsBox.locator(':scope > *').count()
const redCount = await logRowsBox.locator(':scope > .bg-bad-soft').count()
if (failedCount === 0 || failedCount >= allCount || failedCount !== redCount) problems.push(`log: failures shows ${failedCount} of ${allCount} rows, ${redCount} red`)
await logPage.click('[data-chip=all]')
await logPage.waitForTimeout(100)
await logPage.locator('[data-testid=log-strip] [data-failed]').first().click()
await logPage.waitForTimeout(100)
if (await logPage.locator('button.chip', { hasText: 'Follow' }).last().getAttribute('aria-pressed') !== 'false') problems.push('log: a click on the strip left Follow on')
if (await logRowsBox.locator(':scope > .bg-bad-soft').first().evaluate(el => { const b = el.parentElement.getBoundingClientRect(); const r = el.getBoundingClientRect(); return r.top < b.top - 1 || r.bottom > b.bottom + 1 })) problems.push('log: the strip did not bring the failure into view')
await logPage.locator('#log').screenshot({ path: join(out, 'web-log.png') })
await logPage.locator('#files').screenshot({ path: join(out, 'web-files.png') })
await logPage.click('#picker')
await logPage.click('[role=option]:has-text("other-project")')
await logPage.waitForTimeout(300)
if (!await logPage.locator('[data-testid=files-green]').isVisible() || !await logPage.locator('[data-testid=files-check]').isVisible()) problems.push('files: an older session should still show both edited groups')
await logPage.locator('#files').screenshot({ path: join(out, 'web-files-green.png') })
await logPage.close()

// A busy session: 30 more subagents bring the filter dropdowns, folded log runs and a subagent table with Show all.
const busyAt = other.now
const busyAgents = Array.from({ length: 30 }, (_, i) => ({ ...other.agents[0], id: `busy${i}`, task: `Wave ${Math.floor(i / 10)} ${'ABCDEFGHIJ'[i % 10]}: part ${i}`, status: 'done', startedAt: busyAt - (120 - i * 4) * 60_000, endedAt: busyAt - (117 - i * 4) * 60_000 }))
const busyCalls = busyAgents.flatMap(a => Array.from({ length: 5 }, (_, k) => ({ id: `${a.id}c${k}`, at: a.startedAt + k * 9000, who: a.type, agentId: a.id, tool: k % 2 ? 'Bash' : `mcp__t${k}${a.id.slice(-1)}__x`, what: `step ${k}`, ms: 800 })))
const busy = { ...other, session: { ...other.session, id: 'busy', cwd: '/home/dev/busy-project' }, agents: [...other.agents, ...busyAgents], trace: [...(other.trace ?? []), ...busyCalls].sort((a, b) => a.at - b.at), log: [...other.log, ...busyAgents.map(a => ({ at: a.startedAt, who: a.type, what: a.task, result: 'started', agentId: a.id }))].sort((a, b) => a.at - b.at) }
await fetch(`${url}state/busy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(busy) })
const busyPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
busyPage.on('pageerror', e => problems.push(`busy: ${e.message}`))
await busyPage.goto(url)
await busyPage.click('#picker')
await busyPage.click('[role=option]:has-text("busy-project")')
await busyPage.waitForSelector('[data-testid=who-filter]', { timeout: 5000 }).catch(() => problems.push('busy: no agent dropdown'))
await busyPage.click('[data-testid=who-filter]')
await busyPage.click('[role=option]:has-text("part 5")')
if (!await busyPage.locator('[data-testid=who-filter]', { hasText: 'part 5' }).count() || await busyPage.locator('#calls tbody tr').count() !== 5) problems.push('busy: the dropdown did not filter to one agent')
const runRows = busyPage.locator('[data-testid=log-rows] > *')
const runsFolded = await runRows.count()
await busyPage.locator('[data-testid=log-rows] [data-run=busy3]').click()
if (await runRows.count() !== runsFolded + 5) problems.push(`busy: a log run did not unfold its 5 calls (${runsFolded} rows, then ${await runRows.count()})`)
const agentRows = busyPage.locator('[data-testid=agents] tr[data-line]')
const fewRows = await agentRows.count()
await busyPage.locator('#agents .chip', { hasText: 'Show all' }).click()
if (fewRows >= 30 || await agentRows.count() <= fewRows) problems.push(`busy: Show all went from ${fewRows} to ${await agentRows.count()} subagent rows`)
await busyPage.close()
await fetch(`${url}state/busy`, { method: 'DELETE', headers: { 'content-type': 'application/json' } })

// The pins shake while connected, and hold still under reduced motion and once the connection drops.
const pinAt = target => target.locator('.pin-wobble').first().evaluate(el => getComputedStyle(el).transform)
const moves = async target => { const a = await pinAt(target); await target.waitForTimeout(400); return a !== await pinAt(target) }
const live = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await live.goto(url)
await live.waitForSelector('[data-testid=instruments]')
await live.fill('#q', 'npm')
await page.goto(url)
await page.waitForSelector('[data-testid=instruments]')
if (await moves(page)) problems.push('pins: moved under reduced motion')
if (!await moves(live)) problems.push('pins: still while connected')
await live.locator('[data-testid=instruments]').screenshot({ path: join(out, 'web-instruments.png') })
server.kill()
await live.waitForSelector('[data-testid=instruments][data-down]', { timeout: 15000 }).catch(() => problems.push('pins: the band did not see the connection drop'))
if (await moves(live)) problems.push('pins: moved with the connection down')
// A reconnect keeps panels mounted, so what a person typed stays.
const again = spawn(process.execPath, [join(ROOT, 'server/web.mjs'), 'serve', PORT, '--fixture', join(ROOT, 'tests/fixtures/snapshot.json')], { stdio: 'inherit' })
process.on('exit', () => again.kill())
// The session on screen is the posted one: it reports to the new server, as a live session would.
await new Promise(done => setTimeout(done, 300))
await fetch(`${url.slice(0, -1)}/state/second`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(other) })
const otherPostedAt = Date.now()
await live.waitForSelector('[data-testid=instruments]:not([data-down])', { timeout: 30000 }).catch(() => problems.push('reconnect: the page did not come back'))
if (await live.inputValue('#q') !== 'npm') problems.push('reconnect: the log search was lost')
// A connection that hangs without closing fires no error: the page must notice by itself, and every indicator must say so.
again.kill('SIGSTOP')
await live.waitForSelector('[data-testid=instruments][data-down]', { timeout: 60000 }).catch(() => problems.push('stall: the page did not notice a hung connection'))
if (!await live.$('#picker .state-dot.silent')) problems.push('stall: the switch still shows the last state')
if (!(await live.title()).startsWith('⚠')) problems.push('stall: the tab title shows nothing wrong')
if (!/\d/.test(await live.locator('[data-testid=last-update]').first().innerText().catch(() => ''))) problems.push('stall: no time for the last update')
if (await live.locator('main .rec').evaluateAll(els => els.some(el => getComputedStyle(el).animationName !== 'none'))) problems.push('stall: a busy mark still moves')
if (await live.locator('main section').count() === 0) problems.push('stall: the panels went away')
again.kill('SIGCONT')
await live.waitForSelector('[data-testid=instruments]:not([data-down])', { timeout: 60000 }).catch(() => problems.push('stall: the page did not come back'))
// A tab opened on a session that stopped: the server's replay is old, so nothing may read as live, and at once.
await new Promise(done => setTimeout(done, Math.max(0, otherPostedAt + 47_000 - Date.now())))
const fresh = await browser.newPage()
await fresh.goto(url)
await fresh.waitForSelector('[data-testid=silent-banner]', { timeout: 3000 }).catch(() => problems.push('replay: an old snapshot read as fresh'))
await fresh.close()
again.kill()

await browser.close()
console.log(problems.length ? problems.join('\n') : 'no script errors, no sideways scroll')
process.exitCode = problems.length ? 1 : 0
