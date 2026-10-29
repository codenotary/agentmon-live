import { expect, mock, test } from 'claude-code/testing'

import { addPrompt, benchOf, benchReport, emptyBench, KEEP_BENCH, MIN_BENCH, upsertRow } from '../hooks/bench'
import { newRecord, parseTranscript, shapeLearned, upsert } from '../hooks/learn'
import type { BenchRow } from '../types'

const line = (o: object) => JSON.stringify(o)
const user = (uuid: string, at: string, content: unknown) => line({ type: 'user', uuid, timestamp: `2026-10-01T10:${at}.000Z`, message: { role: 'user', content } })
const call = (uuid: string, at: string, id: string, name: string, input: object, out = 10) =>
  line({ type: 'assistant', uuid, timestamp: `2026-10-01T10:${at}.000Z`, message: { id: `msg-${uuid}`, usage: { output_tokens: out }, content: [{ type: 'tool_use', id, name, input }] } })
const result = (uuid: string, id: string, isError = false) => line({ type: 'user', uuid, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: isError ? 'boom' : 'ok' }] } })

// Prompt 1: four edits of one file, a failing test, the gate sends it back, a passing test. Prompt 2: an edit and no check.
const TRANSCRIPT = [
  user('u1', '00:00', 'fix the parser'),
  ...[1, 2, 3, 4].map(i => call(`a${i}`, `00:0${i}`, `e${i}`, 'Edit', { file_path: '/p/src/parse.ts' })),
  call('a5', '00:05', 't1', 'Bash', { command: 'npm test' }),
  result('r1', 't1', true),
  // Claude Code writes Stop-hook feedback as a meta entry.
  line({ type: 'user', uuid: 's1', isMeta: true, message: { content: 'Stop hook feedback:\nBefore you report done, this looks unfinished:\n- test failed' } }),
  line({ type: 'user', uuid: 'm1', isMeta: true, message: { content: 'not a prompt' } }),
  call('a6', '00:10', 't2', 'Bash', { command: 'npm test' }),
  result('r2', 't2'),
  // A resumed session repeats an entry: it counts once.
  call('a6', '00:10', 't2', 'Bash', { command: 'npm test' }),
  user('u2', '01:00', 'and the docs'),
  call('a7', '01:30', 'e5', 'Edit', { file_path: '/p/src/lex.ts' }),
  call('a8', '01:31', 'e6', 'Edit', { file_path: '/p/README.md' }),
].join('\n')

test('a transcript gives the bench numbers', async () => {
  const b = benchOf(TRANSCRIPT)
  expect(b.mod).toBe(true)
  expect(b.live).toBe(false)
  expect(b.editTurns).toBe(2)
  // The last check after the last edit passed in prompt 1; prompt 2 ran none.
  expect(b.verified).toBe(1)
  expect(b.churn).toBe(1)
  expect(b.blocks).toBe(1)
  expect(b.acted).toBe(1)
  expect(b.outTokens).toBe(80)
  expect(b.turnMs).toEqual([10_000, 31_000])
  expect(parseTranscript('s', TRANSCRIPT).bench?.verified).toBe(1)
  // No gate entry: a session without the mod.
  expect(benchOf(user('x', '00:00', 'hi')).mod).toBe(false)
})

test('a prompt the gate sent back counts once', async () => {
  const base = emptyBench(true, true)
  const p = { edit: true, verified: false, churn: false, ms: 1000, block: true, acted: false, passed: false }
  // Recomputed from the same base at each turn end, as notePrompt does.
  addPrompt(base, p)
  const b = addPrompt(base, { ...p, verified: true, acted: true, passed: true, ms: 3000 })
  expect([b.editTurns, b.verified, b.blocks, b.acted, b.passed]).toEqual([1, 1, 1, 1, 1])
  expect(b.turnMs).toEqual([3000])
})

test('bench rows outlast session records, and a live row is not replaced by its transcript', async () => {
  let l = shapeLearned(undefined)
  for (let i = 0; i < KEEP_BENCH + 5; i++) l = upsert(l, { ...newRecord(`s${i}`, i), bench: emptyBench(false, false) })
  expect(l.bench.length).toBe(KEEP_BENCH)
  expect(l.bench[0]?.id).toBe('s5')
  const live = { ...newRecord('s10', 10), turns: 3, bench: { ...emptyBench(true, true), editTurns: 2 } }
  l = upsert(l, live)
  l = upsert(l, { ...newRecord('s10', 10), bench: emptyBench(false, false) })
  expect(l.bench.find(r => r.id === 's10')?.editTurns).toBe(2)
  // A record without bench numbers adds no row.
  expect(upsertRow([], newRecord('x', 0))).toEqual([])
})

const row = (id: string, at: number, mod: boolean, o: Partial<BenchRow> = {}): BenchRow => ({
  ...emptyBench(mod, mod),
  id,
  at,
  turns: 10,
  calls: 100,
  errors: 2,
  compactions: 1,
  editTurns: 4,
  verified: mod ? 3 : 2,
  turnMs: [60_000],
  outTokens: 50_000,
  ...o,
})

test('the report puts without, with and the last week side by side', async () => {
  const now = Date.parse('2026-10-28T12:00:00Z')
  const day = 24 * 3600_000
  const rows = [
    ...Array.from({ length: MIN_BENCH }, (_, i) => row(`b${i}`, now - 30 * day, false)),
    ...Array.from({ length: MIN_BENCH }, (_, i) => row(`m${i}`, now - 20 * day, true, { blocks: 2, acted: 1 })),
    row('w', now - day, true),
  ]
  const text = benchReport(rows, now)
  expect(text).toContain('without mod (5)')
  expect(text).toContain('with mod (6)')
  expect(text).toContain('last 7 days (1)')
  const checked = text.split('\n').find(l => l.startsWith('edit prompts checked'))
  // 50% without; 18 of 24 with; the week has too few sessions.
  expect(checked?.split(/\s{2,}/).slice(1)).toEqual(['50%', '75%', '–'])
  const sent = text.split('\n').find(l => l.startsWith('done gate sent back'))
  expect(sent?.split(/\s{2,}/).slice(1)).toEqual(['–', '10', '–'])
  expect(text).toContain('  then more tool calls')
  expect(benchReport([], now)).toContain('nothing measured yet')
})

test('a live session records its bench row and /agentmon bench reports it', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  on('command.register', () => ({ value: { command: 'agentmon' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'live' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 50_000, percent: 25, breakdown: { categories: [], mcpTools: [], memoryFiles: [] } as never }, rateLimits: [] },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.status', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.list', () => ({ value: [] }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.turn.start({ text: 'go', turnId: 'm1' })
  await $.tool.call({ tool: 'Read' } as never)
  await clock.advance(5000)
  await clock.settle()
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'm1', reason: 'answer' })
  await clock.settle()
  const live = shapeLearned(store.get('proj:/p')).bench.find(r => r.id === 'live')
  expect(live?.mod).toBe(true)
  expect(live?.live).toBe(true)
  expect(live?.turnMs.length).toBe(1)
  const r = await $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 }, command: 'agentmon', args: 'bench' } as never)
  expect(String((r as { text?: string }).text)).toContain('with mod (1)')
})
