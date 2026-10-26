export type Main = { model: string; effort: string }

export type Card = {
  id: string
  type: string
  model: string
  effort: string
  task: string
  status: 'running' | 'done' | 'error' | 'cancelled'
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

export type Stats = { errors: Record<string, number>; compactions: number }

export type Advisor = { isOn: boolean; calls: number; notes: Note[] }

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
    }
  }
}
