import type { AgentStatus } from 'claude-code'

import type { Card, View } from '../types'
import { LANGUAGES } from './i18n'

export const PANE = 'agent-radar'
export const VIEWS: View[] = ['git', 'shell', 'mcp']
// Finished agent cards kept; running and waiting ones are never dropped.
const MAX_FINISHED = 12

// Set from the options on each load.
export const cfg = { t: LANGUAGES.en!, lang: 'en', advisorModel: 'claude-fable-5-1', advisorMode: 'all', advisorBudget: 30 }

// Each module declares the atoms it reads or writes itself, as the engine's scan needs; they share these first values.
export const INIT = {
  main: { model: '', effort: '' },
  tools: {},
  agents: [],
  log: [],
  advisor: { isOn: true, calls: 0, notes: [], epoch: 0, state: 'idle' as const },
  stats: { errors: {}, compactions: 0, streak: 0 },
  calls: [],
  view: 'git' as View,
  active: [],
  checks: [],
  files: { read: [], edited: [], editedAt: 0 },
  lastCall: null,
  layout: { isHistoryOpen: true, isDetailed: false },
  tasks: [],
}

// The `/agent-radar advisor` toggle and the advisorMode option both have to allow Fable.
export function listening(isOn: boolean): boolean {
  return isOn && cfg.advisorMode !== 'off'
}

export function isLive(a: Card): boolean {
  return a.status === 'running' || a.status === 'waiting'
}

export function trimAgents(list: Card[]): Card[] {
  const drop = new Set(list.filter(a => !isLive(a)).slice(0, -MAX_FINISHED))
  return list.filter(a => !drop.has(a))
}

// The engine's own word on an agent beats the card's: a resumed or killed agent says so here first.
export function liveStatus(status: AgentStatus): Card['status'] {
  if (status === 'pending' || status === 'running') return 'running'
  if (status === 'waiting' || status === 'idle') return 'waiting'
  if (status === 'completed') return 'done'
  return status === 'failed' ? 'error' : 'cancelled'
}
