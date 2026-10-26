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
export type Note = { kind: 'plan' | 'error' | 'done'; ok?: boolean; text: string }

export type View = 'git' | 'shell' | 'mcp'

export type Call = { at: number; who: string; view: View; what: string; result: string }

// `streak` counts the main loop's failed calls in a row this turn.
export type Stats = { errors: Record<string, number>; compactions: number; streak?: number }

// `epoch` moves on each clear and load; an answer to an older epoch is dropped.
export type Advisor = { isOn: boolean; calls: number; notes: Note[]; epoch?: number }

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
    }
  }
}
