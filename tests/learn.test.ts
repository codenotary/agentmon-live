import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { EMPTY_INSIGHTS } from '../hooks/state'
import { focusList } from '../hooks/insights'
import { gapKinds } from '../hooks/bench'
import { LANGUAGES } from '../hooks/i18n'
import { KEEP_SESSIONS, learnedItems, newRecord, parseTranscript, shapeLearned, tally, totals, upsert } from '../hooks/learn'
import { memRules, refsOf } from '../hooks/memcheck'
import type { Learned, SessionRecord } from '../types'

type On = Parameters<TestBody>[1]

const line = (o: object) => JSON.stringify(o)

const TRANSCRIPT = [
  line({ type: 'user', timestamp: '2026-10-01T10:00:00.000Z', message: { role: 'user', content: 'hi' } }),
  line({
    type: 'assistant',
    message: {
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0 },
      content: [
        { type: 'tool_use', id: 'a', name: 'mcp__gh__issue', input: {} },
        { type: 'tool_use', id: 'b', name: 'Bash', input: {} },
        { type: 'tool_use', id: 'c', name: 'Read', input: {} },
      ],
    },
  }),
  line({
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'timeout after 30s' },
        { type: 'tool_result', tool_use_id: 'b', is_error: true, content: "The user doesn't want to proceed with this tool use." },
        { type: 'tool_result', tool_use_id: 'c', content: [{ type: 'text', text: 'x'.repeat(48_000) }] },
      ],
    },
  }),
  line({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 160_000 } }),
  line({ type: 'system', subtype: 'turn_duration', durationMs: 1000 }),
  'not json',
].join('\n')

test('a transcript becomes a session record', async () => {
  const r = parseTranscript('s1', TRANSCRIPT)
  expect(r.model).toBe('claude-opus-5-5')
  expect(r.peak).toBe(90_010)
  expect(r.compactAt).toEqual([160_000])
  expect(r.turns).toBe(1)
  expect(r.tools['mcp__gh__issue']).toEqual({ calls: 1, errors: 1, big: 0, lastErr: 'timeout after 30s' })
  // A rejection is the person's call, not the tool failing.
  expect(r.tools.Bash?.errors).toBe(0)
  expect(r.tools.Read?.big).toBe(1)
  expect(r.at).toBe(Date.parse('2026-10-01T10:00:00.000Z'))
})

test('the done gate feedback reads as kinds of gap, in every language', async () => {
  for (const l of Object.values(LANGUAGES)) {
    const block = l.gateReason(
      [l.gapFailed(l.check.test, 'npm test'), l.gapStale(l.check.lint, 'npm run lint'), l.gapClaim('tests pass'), l.gapTodos(2, 'a; b'), l.gapAgent('Explore', 'FAIL'), l.fableSays(l.gapFailed('x', 'y')), `→ check why it ${l.gapFailed('build', 'tsc')}`]
        .map(g => `- ${g}`)
        .join('\n'),
    )
    expect(gapKinds(`Stop hook feedback:\n${block}`)).toEqual(['failed', 'stale', 'claim', 'todos', 'agent', 'fable'])
  }
  // Another Stop hook's feedback is not the gate's.
  expect(gapKinds('Stop hook feedback:\n- test failed: npm test')).toEqual([])
})

test('a transcript counts what the done gate sent back; resumed entries count once', async () => {
  const en = LANGUAGES.en!
  const fb = line({ type: 'user', uuid: 'g1', isMeta: true, message: { content: `Stop hook feedback:\n${en.gateReason(`- ${en.gapFailed('test', 'npm test')}`)}` } })
  expect(parseTranscript('s1', [TRANSCRIPT, fb, fb].join('\n')).gaps).toEqual({ failed: 1 })
  expect(parseTranscript('s1', TRANSCRIPT).gaps).toEqual({})
})

test('a gap the done gate caught in 3 sessions becomes a hint with a CLAUDE.md rule', async () => {
  const caught = (n: number) => history(n + 2, (r, i) => {
    r.bench = { mod: true, live: true, editTurns: 0, verified: 0, churn: 0, outTokens: 0, turnMs: [], blocks: 0, acted: 0, passed: 0, fable: 0 }
    if (i < n) r.gaps = { stale: 1, ...(i === 0 ? { todos: 2 } : {}) }
  })
  expect(learnedItems(caught(2), LIVE).some(x => x.key.startsWith('gate:'))).toBe(false)
  const item = learnedItems(caught(3), LIVE).find(x => x.key.startsWith('gate:'))
  expect(item?.key).toBe('gate:stale')
  expect(item?.text).toBe('done gate caught tests run before the last edit in 3 of 5 sessions')
  expect(item?.prompt).toContain('CLAUDE.md')
  expect(item?.prompt).toContain('Run the tests after your last edit')
  // Records from older versions have no gaps and still load.
  expect(learnedItems(history(4, () => {}), LIVE).some(x => x.key.startsWith('gate:'))).toBe(false)
})

test('the store keeps one record per session, the newest ones', async () => {
  let l = shapeLearned(undefined)
  for (let i = 0; i < KEEP_SESSIONS + 5; i++) l = upsert(l, newRecord(`s${i}`, i))
  expect(l.sessions.length).toBe(KEEP_SESSIONS)
  expect(l.sessions[0]?.id).toBe('s5')
  const again = upsert(l, { ...newRecord('s10', 10), turns: 7 })
  expect(again.sessions.length).toBe(KEEP_SESSIONS)
  expect(again.sessions.find(s => s.id === 's10')?.turns).toBe(7)
  // An older or broken value reads as empty.
  expect(shapeLearned({ sessions: 'x' }).sessions).toEqual([])
})

function history(n: number, each: (r: SessionRecord, i: number) => void): Learned {
  let l: Learned = { current: 'now', sessions: [], mem: [], bench: [] }
  for (let i = 0; i < n; i++) {
    const r = newRecord(`s${i}`, i)
    each(r, i)
    l = upsert(l, r)
  }
  return l
}

const LIVE = { window: 200_000, model: 'claude-opus-5-5', effort: 'high' }

test('a tool shows as flaky only with enough evidence', async () => {
  const fails = (r: SessionRecord) => {
    for (let k = 0; k < 4; k++) tally(r, 'mcp__gh__issue', k < 2, 'timeout', 0)
  }
  expect(learnedItems(history(2, fails), LIVE).some(x => x.key.startsWith('flaky:'))).toBe(false)
  const items = learnedItems(history(3, fails), LIVE)
  const flaky = items.find(x => x.key === 'flaky:mcp__gh__issue')
  expect(flaky?.text).toContain('50%')
  expect(flaky?.text).toContain('timeout')
})

test('the context plan uses where past sessions compacted', async () => {
  const l = history(3, r => r.compactAt.push(150_000))
  // 90% of the 150k median is 135k: 60% of a 200k window is under it, 70% over.
  expect(learnedItems(l, { ...LIVE, percent: 60 }).some(x => x.key.startsWith('ctxplan:'))).toBe(false)
  const plan = learnedItems(l, { ...LIVE, percent: 70 }).find(x => x.key.startsWith('ctxplan:'))
  expect(plan?.text).toContain('75%')
  expect(plan?.text).toContain('lower effort')
  expect(plan?.text).toContain('/model sonnet')
  // No history: 70% of the window; a low effort and a small model get only the compact tip.
  const bare = learnedItems(history(0, () => {}), { ...LIVE, percent: 72, effort: 'low', model: 'claude-sonnet-5-5' }).find(x => x.key.startsWith('ctxplan:'))
  expect(bare?.text).toBe('context 72% · /compact <focus>')
  // Sessions compacted early by hand: no plan at 7%, only from half the window.
  const early = history(3, r => r.compactAt.push(4_000))
  expect(learnedItems(early, { ...LIVE, percent: 7 }).some(x => x.key.startsWith('ctxplan:'))).toBe(false)
  expect(learnedItems(early, { ...LIVE, percent: 50 }).some(x => x.key.startsWith('ctxplan:'))).toBe(true)
})

test('a plan from history replaces the plain context warning', async () => {
  const plan = learnedItems(history(0, () => {}), { ...LIVE, percent: 85 })
  const found = focusList({ ins: EMPTY_INSIGHTS, doing: [], agents: [], percent: 85, window: 200_000, now: 0, learned: plan })
  expect(found.filter(x => x.key.startsWith('context:')).length).toBe(0)
  expect(found.filter(x => x.key.startsWith('ctxplan:')).length).toBe(1)
})

test('an MCP server loaded often and never used is flagged', async () => {
  const l = history(5, r => {
    r.mcp = { mcp__docs: 4000, mcp__gh: 2000 }
    tally(r, 'mcp__gh__issue', false, '', 0)
  })
  const sum = totals(l)
  expect(sum.servers.mcp__docs).toEqual({ loaded: 5, used: 0, tokens: 4000 })
  const keys = learnedItems(l, LIVE).map(x => x.key)
  expect(keys).toContain('unused:mcp__docs')
  expect(keys).not.toContain('unused:mcp__gh')
})

test('memory rules: duplicates, index, stale paths, copied lines', async () => {
  const dir = '/c/projects/p/memory'
  const shared = ['- Always run the tests before you commit anything here', '- Prefer PASETO tokens over JWT for every new service', '- Store docs under the docs folder, never the root']
  const files = [
    { path: `${dir}/MEMORY.md`, text: '- [A](a.md) — one\n- [Gone](gone.md) — two\n- [Spec](https://x.dev/spec.md)\n- [Sub](notes/x.md)', inDir: true },
    { path: `${dir}/a.md`, text: '---\nname: auth\n---\nUses `/data/old/config.yml` and `~/notes/x.md` and `/tmp/*.log` and `/etc/agentxnet`\n- `/src` - Source code\n- `/docs/` - Docs', inDir: true },
    { path: `${dir}/b.md`, text: '---\nname: auth\n---\nbody', inDir: true },
    { path: `${dir}/c.md`, text: '---\nname: ci\n---\n```yaml\nname: auth\n```\nSee `/srv2/app/main.ts:42` and `/srv2/app/x.md#setup`', inDir: true },
    { path: '/h/CLAUDE.md', text: shared.join('\n'), inDir: false },
    { path: '/p/CLAUDE.md', text: `${shared.join('\n')}\n${'y'.repeat(41_000)}`, inDir: false },
  ]
  const refs = refsOf(files, '/h')
  expect([...refs.keys()]).toEqual(['/data/old/config.yml', '/h/notes/x.md', '/srv2/app/main.ts', '/srv2/app/x.md'])
  const found = memRules(files, ['MEMORY.md', 'a.md', 'b.md', 'c.md'], new Map([['/data/old/config.yml', `${dir}/a.md`]]))
  const kinds = found.map(f => `${f.kind}:${f.detail}`)
  expect(kinds).toContain('dupName:auth (a.md, b.md)')
  expect(kinds).toContain('missingIndex:gone.md')
  expect(kinds.filter(k => k.startsWith('missingIndex'))).toEqual(['missingIndex:gone.md'])
  expect(kinds).toContain('notIndexed:b.md')
  expect(found.some(f => f.kind === 'staleRef' && f.detail.endsWith('/data/old/config.yml'))).toBe(true)
  expect(found.some(f => f.kind === 'dupLine' && f.detail.endsWith('(3)'))).toBe(true)
  expect(found.some(f => f.kind === 'tooBig' && f.file === '/p/CLAUDE.md')).toBe(true)
})

test('an instruction file over 200 lines or full of shouted rules is flagged; memory notes are not', async () => {
  const long = Array.from({ length: 210 }, (_, i) => `- rule ${i}`).join('\n')
  const loud = ['IMPORTANT: run tests', 'You MUST lint', 'NEVER push', 'ALWAYS format', 'CRITICAL: no secrets', 'Prefer small files'].join('\n')
  const found = memRules(
    [
      { path: '/p/CLAUDE.md', text: long, inDir: false },
      { path: '/h/.claude/CLAUDE.md', text: loud, inDir: false },
      { path: '/c/projects/p/memory/a.md', text: `${long}\n${loud}`, inDir: true },
    ],
    ['a.md'],
    new Map(),
  )
  expect(found.filter(f => f.kind === 'longFile').map(f => f.file)).toEqual(['/p/CLAUDE.md'])
  expect(found.filter(f => f.kind === 'emphasis').map(f => f.detail)).toEqual(['.claude/CLAUDE.md (5)'])
})

// What the engine answers; the store is a map the test reads back.
// `memory` names the files in the project's memory folder.
function engine(on: On, store: Map<string, unknown>, toasts: string[], transcripts: string[] = [], memory: string[] = []) {
  on('command.register', () => ({ value: { command: 'agentmon' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'live' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, tokens: 50_000, percent: 25, breakdown: { categories: [], mcpTools: [{ name: 'mcp__docs__read', serverName: 'docs', tokens: 3000, isLoaded: true }], memoryFiles: [] } as never },
      rateLimits: [],
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  on('env.get', () => ({ value: '/h' }))
  const entry = (name: string) => ({ name, kind: 'file', size: 10, mtimeMs: 1 })
  on('fs.list', (_, e) => ({ value: (e.path.endsWith('/memory') ? memory.map(entry) : transcripts.map(n => entry(`${n}.jsonl`))) as never }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
}

test('a turn writes this session to the store; a known-flaky tool warns once', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  const past = history(3, r => {
    for (let k = 0; k < 4; k++) tally(r, 'mcp__gh__issue', true, 'timeout', 0)
  })
  store.set('proj:/p', { sessions: past.sessions, mem: [] })
  const toasts: string[] = []
  engine(on, store, toasts)
  on('tool.call', () => ({ result: {}, isError: true, text: 'timeout' }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.turn.start({ text: 'go', turnId: 'm1' })
  await $.tool.call({ tool: 'mcp__gh__issue' } as never)
  await $.tool.call({ tool: 'mcp__gh__issue' } as never)
  await clock.settle()
  expect(toasts.filter(x => x.includes('mcp__gh__issue')).length).toBe(1)
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'm1', reason: 'answer' })
  await clock.settle()
  const saved = shapeLearned(store.get('proj:/p'))
  const live = saved.sessions.find(s => s.id === 'live')
  expect(saved.sessions.length).toBe(4)
  expect(live?.tools['mcp__gh__issue']).toEqual({ calls: 2, errors: 2, big: 0, lastErr: 'timeout' })
  expect(live?.mcp).toEqual({ mcp__docs: 3000 })
  expect(live?.peak).toBe(50_000)
})

test('a stop the done gate sends back is kept in the session record', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  engine(on, store, [])
  on('classic.Stop', () => ({}))
  on('tool.call', (_, e) => ((e as { tool: string }).tool === 'Bash' ? { result: {}, isError: true, text: 'test failed' } : { result: {} }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.turn.start({ text: 'Fix the parser', turnId: 'm1' })
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/parser.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.settle()
  expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'All done.' })).block).toContain('test failed: npm test')
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'm1', reason: 'answer' })
  await clock.settle()
  expect(shapeLearned(store.get('proj:/p')).sessions.find(s => s.id === 'live')?.gaps).toEqual({ failed: 1 })
})

test('/agentmon learn keeps a session recorded live and adds the new ones', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  const live = newRecord('old', 1)
  live.mcp = { mcp__jira: 3000 }
  // Recorded by a version that did not count the done gate's catches.
  const { gaps: _, ...older } = { ...newRecord('older', 2), mcp: { mcp__jira: 3000 } }
  store.set('proj:/p', { sessions: [live, older], mem: [] })
  engine(on, store, [], ['old', 'older', 'new'])
  const line = JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } })
  const en = LANGUAGES.en!
  const gate = JSON.stringify({ type: 'user', uuid: 'g1', isMeta: true, message: { content: `Stop hook feedback:\n${en.gateReason(`- ${en.gapFailed('test', 'npm test')}`)}` } })
  on('fs.read', () => ({ value: `${line}\n${line}\n${gate}` }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 }, command: 'agentmon', args: 'learn' } as never)
  const saved = shapeLearned(store.get('proj:/p'))
  expect(saved.sessions.find(s => s.id === 'old')?.mcp).toEqual({ mcp__jira: 3000 })
  expect(saved.sessions.find(s => s.id === 'old')?.gaps).toEqual({})
  // The older record keeps what it knew and gains the gate's catches.
  expect(saved.sessions.find(s => s.id === 'older')).toMatchObject({ mcp: { mcp__jira: 3000 }, gaps: { failed: 1 } })
  expect(saved.sessions.find(s => s.id === 'older')?.tools).toEqual({})
  // The repeated entry counts once.
  expect(saved.sessions.find(s => s.id === 'new')?.tools.Bash?.calls).toBe(1)
})

test('a memory file shrunk outside Edit and Write is checked again at the turn end', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  const note = '/h/projects/-p/memory/notes.md'
  let text = 'x'.repeat(50_000)
  engine(on, store, [], [], ['notes.md'])
  on('fs.read', (_, e) => {
    if (e.path === note) return { value: text }
    throw new Error('ENOENT')
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  await clock.settle()
  expect(shapeLearned(store.get('proj:/p')).mem.map(f => f.kind)).toEqual(['tooBig'])
  await $.turn.start({ text: 'trim the notes', turnId: 'm1' })
  text = 'short'
  await $.tool.call({ tool: 'Bash', command: "python3 trim.py notes.md" } as never)
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'm1', reason: 'answer' })
  await clock.advance(1000)
  await clock.settle()
  expect(shapeLearned(store.get('proj:/p')).mem).toEqual([])
})
