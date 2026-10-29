// `turnAt` is when the main session's current turn started.
export type Main = { model: string; effort: string; turnAt?: number }

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
}

// Where a main-loop turn's wall time went, in ms per bucket: `model` (requests streaming),
// a tool category (`shell`, `agents`, ...; parallel calls share the time), `you` (a call waiting
// on an approval, its run included) and `idle` (between steps). `mode` is the bucket the clock
// is in now and `since` when it last moved, so a drawing can add the time not yet booked.
export type TurnTime = {
  startedAt: number
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
}

export type GapKind = 'failed' | 'stale' | 'claim' | 'todos' | 'agent' | 'fable'

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
}

// One prompt's part of a Bench.
export type PromptBench = { edit: boolean; verified: boolean; churn: boolean; ms: number; block: boolean; acted: boolean; passed: boolean }

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
  // Approval prompts per call.
  asked: Record<string, number>
  // The main loop's context per model request, oldest first; a drop is a compaction.
  ctx: number[]
  cacheRead: number
  cacheTotal: number
  tokens: { mainIn: number; mainOut: number; mainCached: number; agentsIn: number; agentsOut: number }
  // Where the main loop works (a directory under the project) and how often it moved.
  area?: string
  switches: number
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

export type LogLine = { at: number; who: string; what: string; result: string }

// `ok` is missing on notes kept by older versions, which kept only objections.
// `ref` names the request a note is about. `text` holds the gaps, one per line; `fix` what would settle them.
// A done gate result is `done`; `isSent` when it went back to Claude. `check` is the person's own "check now".
export type Note = { kind: 'done' | 'check'; ok?: boolean; text: string; fix?: string; ref?: string; at?: number; isSent?: boolean }

export type View = 'git' | 'shell' | 'mcp'

// `result` is `running` from the moment the call starts until it reports back; `error` holds its error text.
export type Call = { id?: string; at: number; who: string; view: View; what: string; result: string; error?: string }

export type CheckKind = 'test' | 'lint' | 'typecheck' | 'build'

// The last run of one kind of check: `unknown` when its exit status could not be read (a pipe, a denial).
export type Check = { kind: CheckKind; command: string; who: string; at: number; result: 'running' | 'ok' | 'failed' | 'unknown' }

// Files the session read and edited successfully; `editedAt` is the last successful edit, to tell stale checks.
export type Files = { read: string[]; edited: string[]; editedAt: number }

// `model` is the one the caller ran on, when known.
export type LastCall = { tool: string; what: string; who: string; model?: string; at: number }

// What the pane shows folded or in full.
// `dismissed` holds the keys of Needs attention items the person put away.
// `mode` is unused since the flow view was dropped; kept so older stores load.
// `isChangelogOpen` folds out a newer release's notes under the header.
export type Layout = { isHistoryOpen: boolean; isDetailed: boolean; dismissed?: string[]; mode?: 'radar' | 'flow'; isChangelogOpen?: boolean }

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
  // Why the last call got no answer: the API error and status, `aborted` or `empty-reply`.
  why?: string
  // Fable's own tokens, apart from the session's.
  tokensIn?: number
  tokensOut?: number
}

// A tool call that has started and not yet finished; `isAsking` while it waits for the person's approval.
export type Active = { id: string; who: string; model?: string; tool: string; what: string; startedAt: number; isAsking?: boolean }

// The session's own task list (TaskCreate/TaskUpdate or TodoWrite), as the calls left it.
// `at` is when a call last changed it.
export type Task = { id: string; subject: string; activeForm?: string; status: 'pending' | 'in_progress' | 'completed'; at?: number }

// A skill or prompt command whose text the session loaded: how often, by whom last, and when.
export type SkillUse = { name: string; count: number; who: string; at: number }

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
