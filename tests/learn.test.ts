import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { EMPTY_INSIGHTS } from '../hooks/state'
import { focusList } from '../hooks/insights'
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
    { path: `${dir}/MEMORY.md`, text: '- [A](a.md) — one\n- [Gone](gone.md) — two', inDir: true },
    { path: `${dir}/a.md`, text: '---\nname: auth\n---\nUses `/data/old/config.yml` and `~/notes/x.md` and `/tmp/*.log` and `/etc/agentxnet`\n- `/src` - Source code\n- `/docs/` - Docs', inDir: true },
    { path: `${dir}/b.md`, text: '---\nname: auth\n---\nbody', inDir: true },
    { path: '/h/CLAUDE.md', text: shared.join('\n'), inDir: false },
    { path: '/p/CLAUDE.md', text: `${shared.join('\n')}\n${'y'.repeat(41_000)}`, inDir: false },
  ]
  const refs = refsOf(files, '/h')
  expect([...refs.keys()]).toEqual(['/data/old/config.yml', '/h/notes/x.md'])
  const found = memRules(files, ['MEMORY.md', 'a.md', 'b.md'], new Map([['/data/old/config.yml', `${dir}/a.md`]]))
  const kinds = found.map(f => `${f.kind}:${f.detail}`)
  expect(kinds).toContain('dupName:auth (a.md, b.md)')
  expect(kinds).toContain('missingIndex:gone.md')
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
function engine(on: On, store: Map<string, unknown>, toasts: string[]) {
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
  on('fs.list', () => ({ value: [] }))
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
