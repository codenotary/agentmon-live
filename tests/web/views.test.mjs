import assert from 'node:assert/strict'
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { MAX_VIEW, readViews } from '../../server/views.mjs'

const folder = () => mkdtempSync(join(tmpdir(), 'agentmon-views-'))

test('each view file is listed by name, a broken one with its error, and the chat choice is read', () => {
  const dir = folder()
  writeFileSync(join(dir, 'cost.json'), JSON.stringify({ title: 'Cost', sections: [] }))
  writeFileSync(join(dir, 'broken.json'), '{ "sections": ')
  writeFileSync(join(dir, 'list.json'), '[]')
  writeFileSync(join(dir, 'Bad Name.json'), '{}')
  writeFileSync(join(dir, 'huge.json'), JSON.stringify({ text: 'x'.repeat(MAX_VIEW) }))
  writeFileSync(join(dir, 'notes.txt'), 'x')
  writeFileSync(join(dir, 'active'), 'cost\n')
  const { views, active } = readViews(dir)
  const by = Object.fromEntries(views.map(v => [v.name, v]))
  assert.deepEqual(Object.keys(by).sort(), ['Bad Name', 'broken', 'cost', 'huge', 'list'])
  assert.deepEqual(by.cost.view, { title: 'Cost', sections: [] })
  assert.match(by.broken.error, /bad JSON/)
  assert.match(by.list.error, /not a JSON object/)
  assert.match(by['Bad Name'].error, /name/)
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
