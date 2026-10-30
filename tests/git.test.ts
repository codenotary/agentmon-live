import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { overlap, parseCounts, repoRoot } from '../hooks/git'
import { focusList } from '../hooks/insights'
import { EMPTY_INSIGHTS } from '../hooks/state'

type On = Parameters<TestBody>[1]

const PANE = {
  plugin: 'agentmon-live',
  component: 'Pane',
  requestId: 'agentmon-live',
  surface: 'terminal',
  props: { title: 'AgentMon Live', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

// A repo at /r with no origin/HEAD, whose origin/main is 3 commits ahead and changed src/a.ts and src/b.ts; `runs` gets every git call.
function engine(on: On, runs: string[]) {
  on('command.register', () => ({ value: { command: 'agentmon' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 10000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('env.get', () => ({ value: undefined }))
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('tool.call', () => ({ result: {} }))
  const reply = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    runs.push(cmd)
    if (cmd.startsWith('git symbolic-ref')) return reply(128)
    if (cmd === 'git rev-list --left-right --count HEAD...origin/main') return reply(0, '1\t3\n')
    if (cmd === 'git -c core.quotePath=false diff --name-only HEAD...origin/main') return reply(0, 'src/a.ts\nsrc/b.ts\n')
    return reply(0)
  })
}

test('rev-list counts read as ahead and behind', async () => {
  expect(parseCounts('2\t5\n')).toEqual({ ahead: 2, behind: 5 })
  expect(parseCounts('')).toBeUndefined()
  expect(parseCounts('fatal: bad revision')).toBeUndefined()
})

test('overlap keeps the edited files the base changed', async () => {
  expect(overlap(['/r/a.ts', '/r/b.ts'], ['/r/b.ts', '/r/c.ts'])).toEqual(['/r/b.ts'])
  // A root file is not the same-named file in a subfolder.
  expect(overlap(['/r/package.json'], ['/r/packages/web/package.json'])).toEqual([])
  expect(overlap([], ['/r/a.ts'])).toEqual([])
  expect(overlap(['/r/docs/ü.md'], ['/r/docs/ü.md'])).toEqual(['/r/docs/ü.md'])
})

test('the repo root keeps the path the session sees', async () => {
  expect(repoRoot('/link/r', '')).toBe('/link/r')
  expect(repoRoot('/link/r/sub/dir/', 'sub/dir/')).toBe('/link/r')
  expect(repoRoot('/elsewhere', 'sub/')).toBeUndefined()
})

test('focus flags a moved base, red when it changed files edited here', async () => {
  const base = { base: 'origin/main', ahead: 1, behind: 3, files: ['/r/src/a.ts', '/r/src/b.ts'] }
  const at = { ins: EMPTY_INSIGHTS, doing: [], agents: [], window: 1000000, now: 0, base }
  const [quiet] = focusList({ ...at, edited: ['/r/src/c.ts'] })
  expect(quiet?.color).toBe('blue')
  expect(quiet?.prompt).toBeUndefined()
  const [hit] = focusList({ ...at, edited: ['/r/src/b.ts'] })
  expect(hit?.color).toBe('red')
  expect(hit?.text).toBe('origin/main moved 3 commits and changed files edited here: src/b.ts · rebase before more edits')
  expect(hit?.prompt).toMatch(/rebase this branch onto origin\/main/)
  expect(focusList({ ...at, base: { ...base, behind: 0, files: [] }, edited: ['/r/src/b.ts'] })).toEqual([])
})

test('the base check falls back to origin/main, flags an edited file the base changed, and does not fetch by default', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[] = []
  engine(on, runs)
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/r/src/b.ts', old_string: 'a', new_string: 'b' })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /origin\/main moved 3 commits and changed files edited here: src\/b\.ts/ })).toBeTruthy()
  await ui.unmount()
  expect(runs.some(c => c.startsWith('git fetch'))).toBe(false)
})

test('gitFetch fetches the base branch first', { options: { gitFetch: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[] = []
  engine(on, runs)
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(runs).toContain('git fetch --quiet --no-tags origin main')
})
