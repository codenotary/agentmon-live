// `turnAt` is when the main session's current turn started.
// `turnLive` while a main turn runs, so a module reload mid-turn restarts the clock and the gate for it.
export type Main = { model: string; effort: string; turnAt?: number; turnLive?: boolean }

export type Card = {
  id: string
  type: string
  model: string
  effort: string
  task: string
  status: 'running' | 'waiting' | 'done' | 'error' | 'cancelled'
  files: number
  tools: number
  input: number
  output: number
  tests?: string
  // The line of the agent's answer that made it a FAIL, and when the agent last finished.
  testsWhy?: string
  endedAt?: number
  startedAt: number
  // The agent's last sign of life: a tool call or a model request.
  lastAt?: number
  // Calls that did more than read or search.
  others?: number
  // The Agent call that started it, and its prompt, masked and cut short.
  callId?: string
  prompt?: string
  // The name the Agent call gave it, the address SendMessage uses.
  name?: string
  // Input read from the prompt cache, its cost so far, and its failed calls.
  cached?: number
  usd?: number
  errors?: number
}

// Where a main-loop turn's wall time went, in ms per bucket: `model` (requests streaming),
// a tool category (`shell`, `agents`, ...; parallel calls share the time), `you` (a call waiting
// on an approval, its run included) and `idle` (between steps). `mode` is the bucket the clock
// is in now and `since` when it last moved, so a drawing can add the time not yet booked.
export type TurnTime = {
  startedAt: number
  // The prompt that started it, masked and cut short.
  prompt?: string
  // Claude's final answer, masked and cut short; absent while the turn runs.
  answer?: string
  wallMs: number
  buckets: Record<string, number>
  steps: number
  ctxStart?: number
  ctxEnd?: number
  mode?: string
  since?: number
  // Doc files the main loop read in a turn that changed code and was not a refactor.
  docs?: string[]
  // The turn worked only in areas the session had not touched before, in an already large context.
  isNewTask?: boolean
}

export type SlowCall = { tool: string; what: string; who: string; ms: number; at: number }

// A tool result the main loop read, by its estimated tokens (characters / 4).
export type BigResult = { tool: string; what: string; tokens: number; at: number }

// One tool's calls in one session; `big` counts results of 10k+ tokens, `lastErr` the last error text.
export type ToolTally = { calls: number; errors: number; big: number; lastErr?: string }

// What one session of this project left behind: context tokens at its peak and at each compaction,
// tool calls per tool, and the MCP servers loaded (tool-name prefix to schema tokens).
export type SessionRecord = {
  id: string
  at: number
  model: string
  effort: string
  peak: number
  window: number
  compactAt: number[]
  turns: number
  tools: Record<string, ToolTally>
  mcp: Record<string, number>
  bench?: Bench
  // What the done gate sent back, per kind of gap; missing in records from older versions, which `/agentmon learn` fills in from the transcript.
  gaps?: Partial<Record<GapKind, number>>
  // Errors by signature (`errSig`), so one cause met in session after session shows; missing in older records.
  errs?: Record<string, number>
}

export type GapKind = 'failed' | 'stale' | 'claim' | 'todos' | 'agent' | 'fable' | 'uncovered' | 'empty' | 'dropped'

// What one session's work came to, for `/agentmon bench`: `mod` when AgentMon Live ran in it, `live` when recorded as it ran (not read back from a transcript).
// Turn counts are per prompt: a turn the done gate sent back is the same prompt. `turnMs` holds the durations of prompts that used tools.
export type Bench = {
  mod: boolean
  live: boolean
  editTurns: number
  verified: number
  churn: number
  outTokens: number
  turnMs: number[]
  blocks: number
  acted: number
  passed: number
  fable: number
  // Tool calls per prompt that used tools (missing in older rows), and the main loop's cost, each request priced from its usage (missing when no model had a price).
  turnCalls?: number[]
  usd?: number
  // The whole session's cost as the engine counts it, subagents included. `usd` stays the main loop's: the bench compares it with transcripts of sessions without the mod.
  totalUsd?: number
}

// One prompt's part of a Bench.
export type PromptBench = { edit: boolean; verified: boolean; churn: boolean; ms: number; block: boolean; acted: boolean; passed: boolean; calls: number }

// A session's Bench with its totals, kept longer than the session records so the trend reaches back.
export type BenchRow = Bench & { id: string; at: number; turns: number; calls: number; errors: number; compactions: number }

// A memory-file problem found by the local rules.
export type MemFinding = { kind: 'dupName' | 'missingIndex' | 'notIndexed' | 'staleRef' | 'tooBig' | 'dupLine' | 'longFile' | 'emphasis'; file: string; detail: string }

// The project's sessions as the store keeps them, last 30; `current` is this session's id.
export type Learned = { current: string; sessions: SessionRecord[]; mem: MemFinding[]; bench: BenchRow[] }

export type Insights = {
  // The main loop's turn under way, or undefined between turns; `last` the last finished one.
  turn?: TurnTime
  last?: TurnTime
  // Summed over finished turns.
  session: Record<string, number>
  sessionWall: number
  turns: number
  // The last 20 durations per tool, approvals left out, to tell an unusually long call.
  durations: Record<string, number[]>
  slow: SlowCall[]
  big: BigResult[]
  // Successful reads by the main loop and edits by anyone, per path.
  reads: Record<string, number>
  edits: Record<string, number>
  // Failures in a row per call (tool and its argument); a success clears it.
  fails: Record<string, number>
  // Failures this turn by error signature, across calls: one cause behind different calls.
  errs: Record<string, number>
  // The main loop's tool calls this turn.
  turnCalls: number
  // Approval prompts per call.
  asked: Record<string, number>
  // Approvals over the session: `asked` starts over at each prompt.
  askedAll?: Record<string, number>
  // The main loop's context per model request, oldest first; a drop is a compaction.
  ctx: number[]
  cacheRead: number
  cacheTotal: number
  tokens: { mainIn: number; mainOut: number; mainCached: number; agentsIn: number; agentsOut: number }
  // The main loop's cost so far, each request priced from its usage (`priceUsd`).
  usd: number
  // Where the main loop works (a directory under the project) and how often it moved.
  area?: string
  turnSwitches: number
  turnAreas: Record<string, number>
  // Areas the main loop worked in before this turn.
  pastAreas?: string[]
  // Prompts in a row that corrected the turn before, which had edited files.
  corrections?: number
  modelSwitches: number
  // The window by category at the last turn's end, used rows only, largest first.
  breakdown?: { name: string; tokens: number }[]
  mcpTokens?: number
  memoryTokens?: number
  // Watched source files this session: the size before the first edit (absent for a new file) and now.
  sizes: Record<string, { first?: number; now: number }>
  // Plan-window readings per kind (`five_hour`, ...), oldest first, for the pace; a new window starts a fresh list.
  limits: Record<string, { at: number; pct: number; resetsAt?: number }[]>
  // When the main loop last finished a turn, kept across resumes for the prompt cache's expiry.
  lastActive?: number
  // The context size kept with it: a resumed process knows none until its first response.
  lastTokens?: number
}

export type LogLine = { at: number; who: string; what: string; result: string; agentId?: string }

// `ok` is missing on notes kept by older versions, which kept only objections.
// `ref` names the request a note is about. `text` holds the gaps, one per line; `fix` what would settle them.
// A done gate result is `done`; `isSent` when it went back to Claude. `check` is the person's own "check now".
export type Note = { kind: 'done' | 'check'; ok?: boolean; text: string; fix?: string; ref?: string; at?: number; isSent?: boolean }

export type View = 'git' | 'shell' | 'mcp'

// `result` is `running` from the moment the call starts until it reports back; `error` holds its error text.
export type Call = { id?: string; at: number; who: string; view: View; what: string; result: string; error?: string; agentId?: string }

// Every tool call of the session, for the web view's waterfall; `ms` once it reported back.
// `to` is a SendMessage's recipient, as the call names it.
export type TraceCall = { id: string; at: number; who: string; tool: string; what: string; ms?: number; isFailed?: boolean; error?: string; agentId?: string; to?: string }

export type CheckKind = 'test' | 'lint' | 'typecheck' | 'build'

// The last run of one kind of check: `unknown` when its exit status could not be read (a pipe, a denial).
// A test run also says where it ran (`dir`, relative to the project, absent at its root) and, when the summary said, how many tests ran and were skipped.
export type Check = { kind: CheckKind; command: string; who: string; at: number; result: 'running' | 'ok' | 'failed' | 'unknown'; dir?: string; ran?: number; skipped?: number; greenAt?: number }

// Files the session read and edited successfully; `editedAt` is the last successful edit, to tell stale checks.
// `editedTimes` says when each edited path last changed; missing in state from older versions.
export type Files = { read: string[]; edited: string[]; editedAt: number; editedTimes?: Record<string, number> }

// `model` is the one the caller ran on, when known.
export type LastCall = { tool: string; what: string; who: string; model?: string; at: number }

// What the pane shows folded or in full.
// `dismissed` holds the keys of Needs attention items the person put away.
// `mode` is unused since the flow view was dropped; kept so older stores load.
// `isChangelogOpen` folds out a newer release's notes under the header.
// `isAgentsOpen` lists every running subagent once more than four run; `isClassic`, set by `v`, beats the `layout` option.
export type Layout = { isHistoryOpen: boolean; isPaneHidden?: boolean; isDetailed: boolean; dismissed?: string[]; mode?: 'radar' | 'flow'; isChangelogOpen?: boolean; isAgentsOpen?: boolean; isClassic?: boolean }

// One tool call by category and time, for the calls-per-minute rate.
export type Flow = { cat: string; at: number }

// `streak` counts the main loop's failed calls in a row this turn.
export type Stats = { errors: Record<string, number>; compactions: number; streak?: number }

// `epoch` moves on each clear and load; an answer to an older epoch is dropped.
export type Advisor = {
  isOn: boolean
  calls: number
  notes: Note[]
  epoch?: number
  // `budget` once the session's calls are used up; `unavailable` after the model failed to answer.
  state?: 'idle' | 'checking' | 'unavailable' | 'budget'
  // Why the last call got no answer: the API error and status, `aborted` or `empty-reply`; and when, for the backoff.
  why?: string
  unavailableAt?: number
  // Fable's own tokens, apart from the session's.
  tokensIn?: number
  tokensOut?: number
}

// A tool call that has started and not yet finished; `isAsking` while it waits for the person's approval.
export type Active = { id: string; who: string; model?: string; tool: string; what: string; startedAt: number; isAsking?: boolean; agentId?: string }

// The session's own task list (TaskCreate/TaskUpdate or TodoWrite), as the calls left it.
// `at` is when a call last changed it.
export type Task = { id: string; subject: string; activeForm?: string; status: 'pending' | 'in_progress' | 'completed'; at?: number }

// A skill or prompt command whose text the session loaded: how often, by whom last, and when.
export type SkillUse = { name: string; count: number; who: string; at: number }

// Test files this turn edited, what the edits took out, and test runs that shrank, for a person to look at beside a passing run.
export type TestLine = { before?: string; after?: string }
export type TestEdit = { path: string; removed: number; skips: number; at: number; changed?: number; lines?: TestLine[] }
export type TestReview = { files: TestEdit[]; dropped: { command: string; ran: number; skipped: number; ranNow: number; skippedNow: number }[]; isGreen: boolean }

// One turn on the web view's clock; `isLive` while it still runs.
export type WebTurn = { startedAt: number; wallMs: number; buckets: Record<string, number>; isLive?: boolean; prompt?: string; answer?: string }

export type WebFocus = { key: string; tag: string; text: string; isUrgent: boolean }

// What a session posts to the web view's server. The page draws from this alone; change `v` when a field changes meaning.
export type WebSnapshot = {
  v: 1
  // `slot`: the Kiro Crew chat a Kiro session belongs to, as Kiro Crew's address names it.
  session: { id: string; cwd: string; branch?: string; slot?: string }
  now: number
  lang: string
  labels: Record<string, unknown>
  main: Main
  // The mod's version and commit, as in the pane's header. Absent from a session of an older version.
  build?: string
  // Absent from a session of an older version, which cannot take the page's request.
  isPaneOpen?: boolean
  focus: WebFocus[]
  // `credits` only from a Kiro Crew chat on kiro-cli, which reports them in place of tokens and cost.
  usage: { ctxPct?: number; ctxTokens?: number; ctxWindow?: number; rate: { kind: string; pct: number; resetsAt?: number }[]; usd: number; credits?: number }
  turns: WebTurn[]
  turnCount: number
  active: Active[]
  calls: Call[]
  // Absent from a session of an older version, like `isPaneOpen`.
  trace?: TraceCall[]
  // `dropped` is already in the session's language. Absent from a session of an older version.
  testReview?: { files: TestEdit[]; dropped: string[]; isGreen: boolean }
  agents: Card[]
  checks: Check[]
  files: Files
  log: LogLine[]
  tasks: Task[]
  // All but the first three are absent from a session of an older version.
  insights: Pick<Insights, 'slow' | 'big' | 'tokens'> & Partial<Pick<Insights, 'reads' | 'edits' | 'sizes' | 'breakdown' | 'mcpTokens' | 'memoryTokens' | 'session' | 'sessionWall' | 'askedAll'>>
  // The last done gate result. Absent from a session of an older version.
  gate?: { ok: boolean; text: string; isSent: boolean; at: number } | null
  learned: { bench: BenchRow[] }
}

declare module 'claude-code' {
  interface PluginState {
    'agentmon-live': {
      main: Main
      tools: Record<string, number>
      agents: Card[]
      log: LogLine[]
      advisor: Advisor
      stats: Stats
      calls: Call[]
      testReview: TestReview
      trace: TraceCall[]
      view: View
      active: Active[]
      checks: Check[]
      files: Files
      lastCall: LastCall | null
      layout: Layout
      tasks: Task[]
      skills: SkillUse[]
      flow: Flow[]
      insights: Insights
      learned: Learned
    }
  }
}
