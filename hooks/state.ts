import type { AgentStatus } from 'claude-code'

import type { Card, View } from '../types'
import { LANGUAGES } from './i18n'

export const PANE = 'agent-radar'
export const VIEWS: View[] = ['git', 'shell', 'mcp']
// Finished agent cards kept; running and waiting ones are never dropped.
const MAX_FINISHED = 12

// Set from the options on each load.
export const cfg = { t: LANGUAGES.en!, lang: 'en', build: '', advisorModel: 'claude-fable-5-1', advisorMode: 'all', advisorBudget: 30 }

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
  skills: [],
}

// The `/agent-radar advisor` toggle and the advisorMode option both have to allow Fable.
export function listening(isOn: boolean): boolean {
  return isOn && cfg.advisorMode !== 'off'
}

export function isLive(a: Card): boolean {
  return a.status === 'running' || a.status === 'waiting'
}

// A section of the pane below Running now: `isUrgent` when something there needs the person, `at` its last activity.
export type Ranked = { key: string; isUrgent: boolean; at: number }

// Sections move up by what needs attention: urgent ones first, then those active in the last two minutes,
// newest first, then the rest in their usual order. Ties keep the usual order, so the pane does not jitter.
export const RECENT_MS = 120_000
export function rank<T extends Ranked>(sections: T[], now: number): T[] {
  const tier = (s: Ranked) => (s.isUrgent ? 0 : now - s.at < RECENT_MS ? 1 : 2)
  return sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => tier(a.s) - tier(b.s) || (tier(a.s) === 1 ? b.s.at - a.s.at : 0) || a.i - b.i)
    .map(x => x.s)
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
