import assert from 'node:assert/strict'
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MAX_VIEW, readViews, SHIPPED } from '../../server/views.mjs'

const folder = () => mkdtempSync(join(tmpdir(), 'agentmon-views-'))

test('each view file is listed by name, a broken one with its error, and the chat choice is read', () => {
  const dir = folder()
  writeFileSync(join(dir, 'cost.json'), JSON.stringify({ title: 'Cost', sections: [] }))
  writeFileSync(join(dir, 'broken.json'), '{ "sections": ')
  writeFileSync(join(dir, 'list.json'), '[]')
  writeFileSync(join(dir, 'Bad Name.json'), '{}')
  writeFileSync(join(dir, '.json'), '{}')
  writeFileSync(join(dir, 'huge.json'), JSON.stringify({ text: 'x'.repeat(MAX_VIEW) }))
  writeFileSync(join(dir, 'notes.txt'), 'x')
  writeFileSync(join(dir, 'active'), 'cost\n')
  const { views, active } = readViews(dir)
  const by = Object.fromEntries(views.map(v => [v.name, v]))
  assert.deepEqual(Object.keys(by).sort(), ['.json', 'Bad Name.json', 'broken', 'cost', 'huge', 'list'])
  assert.deepEqual(by.cost.view, { title: 'Cost', sections: [] })
  assert.match(by.broken.error, /bad JSON/)
  assert.match(by.list.error, /not a JSON object/)
  assert.match(by['Bad Name.json'].error, /name/)
  // Never an empty name: the page's menu cannot hold an item without a value.
  assert.match(by['.json'].error, /name/)
  assert.match(by.huge.error, /larger than 64 KB/)
  assert.equal(active, 'cost')
})

test('no folder is no views; a link is not followed; a bad choice is none', () => {
  assert.deepEqual(readViews(join(folder(), 'missing')), { views: [], active: '' })
  const dir = folder()
  const outside = join(folder(), 'secret.json')
  writeFileSync(outside, '{"sections":[]}')
  symlinkSync(outside, join(dir, 'linked.json'))
  writeFileSync(join(dir, 'active'), '../etc')
  const { views, active } = readViews(dir)
  assert.equal(views[0].view, undefined)
  assert.ok(views[0].error)
  assert.equal(active, '')
})

test('the views that come with the mod are listed with the person\'s, whose file of the same name wins', () => {
  const dir = folder()
  writeFileSync(join(dir, 'cost.json'), JSON.stringify({ title: 'Mine', sections: [] }))
  writeFileSync(join(dir, 'active'), 'speed')
  const { views, active } = readViews(dir, SHIPPED)
  assert.deepEqual(views.map(v => v.name), ['cost', 'quality', 'speed'])
  assert.equal(views[0].view.title, 'Mine')
  assert.equal(views[2].view.title, 'Speed')
  assert.deepEqual(views.map(v => v.isShipped), [undefined, true, true])
  assert.equal(active, 'speed')
  // With no folder of the person's, and with none of the mod's.
  assert.deepEqual(readViews(join(folder(), 'missing'), SHIPPED).views.map(v => v.name), ['cost', 'quality', 'speed'])
  assert.deepEqual(readViews(dir, join(folder(), 'missing')).views.map(v => v.name), ['cost'])
})

test('the check command says ok for a view the page takes whole, and names what it would leave out', () => {
  const check = join(dirname(fileURLToPath(import.meta.url)), '../../server/view-check.mjs')
  const good = spawnSync(process.execPath, [check, join(SHIPPED, 'cost.json')], { encoding: 'utf8' })
  assert.equal(good.status, 0)
  assert.equal(good.stdout.trim(), 'ok')
  const file = join(folder(), 'bad.json')
  writeFileSync(file, JSON.stringify({ sections: [{ id: 'x', blocks: [{ type: 'Chart' }, { type: 'Stat', label: 'a', value: '/usage/cost' }] }] }))
  const bad = spawnSync(process.execPath, [check, file], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.deepEqual(bad.stdout.trim().split('\n'), ['x/blocks/0: block Chart', 'x/Stat a: empty /usage/cost'])
  writeFileSync(file, '{ "sections": ')
  assert.equal(spawnSync(process.execPath, [check, file], { encoding: 'utf8' }).status, 2)
})
