import type { AgentStatus } from 'claude-code'

import type { Card, Insights, Learned, TurnTime, View } from '../types'
import { LANGUAGES } from './i18n'

export const EMPTY_INSIGHTS: Insights = {
  session: {},
  sessionWall: 0,
  turns: 0,
  durations: {},
  slow: [],
  big: [],
  reads: {},
  edits: {},
  fails: {},
  asked: {},
  ctx: [],
  cacheRead: 0,
  cacheTotal: 0,
  tokens: { mainIn: 0, mainOut: 0, mainCached: 0, agentsIn: 0, agentsOut: 0 },
  switches: 0,
  turnSwitches: 0,
  turnAreas: {},
  modelSwitches: 0,
  sizes: {},
  limits: {},
}

// State an older version stored lacks fields this one reads; fill them in.
export function shapeInsights(v: Partial<Insights> | undefined): Insights {
  return { ...EMPTY_INSIGHTS, ...(v ?? {}), tokens: { ...EMPTY_INSIGHTS.tokens, ...(v?.tokens ?? {}) } }
}

export const PANE = 'agentmon-live'
export const VIEWS: View[] = ['git', 'shell', 'mcp']
// Finished agent cards kept; running and waiting ones are never dropped.
const MAX_FINISHED = 12

// Set from the options on each load.
export const cfg = { t: LANGUAGES.en!, lang: 'en', build: '', advisorModel: 'claude-fable-5-1', advisorMode: 'all', advisorBudget: 30, learning: true }

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
  flow: [],
  insights: EMPTY_INSIGHTS,
  learned: { current: '', sessions: [], mem: [] } as Learned,
}

// The main turn's clock as it stands, set by register: the pane reads it live instead of each call writing it to an atom.
export const liveTurn: { read?: () => TurnTime | undefined } = {}

// The `/agentmon advisor` toggle and the advisorMode option both have to allow Fable.
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

// The engine's word on each agent: a card it no longer lists finished while no module listened.
export function reconcile(list: Card[], live: { id: string; status: AgentStatus }[] | undefined): Card[] {
  if (live === undefined) return list
  const statusOf = new Map(live.map(a => [a.id, liveStatus(a.status)]))
  return list.map(a => (isLive(a) ? { ...a, status: statusOf.get(a.id) ?? 'cancelled' } : a))
}
