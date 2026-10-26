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
}

export type LogLine = { at: number; who: string; what: string; result: string }

// `ok` is missing on notes kept by older versions, which kept only objections.
// `ref` names the evidence an objection rests on: the failed call, the files, the plan.
export type Note = { kind: 'plan' | 'error' | 'done' | 'check'; ok?: boolean; text: string; ref?: string }

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
// `mode` is the pane's view: the dashboard or the flow diagram.
export type Layout = { isHistoryOpen: boolean; isDetailed: boolean; dismissed?: string[]; mode?: 'radar' | 'flow' }

// One tool call by category and time, for the topology views' rates.
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
  // What the last call was asked, and when each kind last ran: for duplicate suppression and the cooldown.
  lastKey?: string
  lastAt?: Record<string, number>
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
    'agent-radar': {
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
    }
  }
}
