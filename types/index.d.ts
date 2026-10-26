export type Main = { model: string; effort: string }

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
  startedAt: number
}

export type LogLine = { at: number; who: string; what: string; result: string; isGit?: boolean }

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

export type LastCall = { tool: string; what: string; who: string; at: number }

// What the pane shows folded or in full.
export type Layout = { isHistoryOpen: boolean; isDetailed: boolean }

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
  // What the last call was asked, and when each kind last ran: for duplicate suppression and the cooldown.
  lastKey?: string
  lastAt?: Record<string, number>
  // Fable's own tokens, apart from the session's.
  tokensIn?: number
  tokensOut?: number
}

// A tool call that has started and not yet finished; `isAsking` while it waits for the person's approval.
export type Active = { id: string; who: string; tool: string; what: string; startedAt: number; isAsking?: boolean }

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
    }
  }
}
