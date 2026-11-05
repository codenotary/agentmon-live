import type { WebSnapshot } from '../../types/index'

// With no session there are no labels, and an older session's lack the newest; a test holds this to the English the mod sends.
export const PAGE_EN = {
  "disconnected": "Disconnected from the session server. Trying again…",
  "noSessions": "No session is running. Start Claude Code and this page fills in.",
  "update": "This session runs a different AgentMon Live version. Update it to see everything here.",
  "cache": "cache",
  "tokensIn": "in",
  "tokensOut": "out",
  "context": "Context",
  "quota": "7-day quota",
  "cost": "Session cost",
  "turns": "Turns",
  "events": "Events",
  "cleared": "cleared",
  "paneHide": "Hide the pane in Claude Code",
  "paneShow": "Show the pane in Claude Code",
  "waterfall": "Turn waterfall",
  "prevTurn": "Previous turn",
  "nextTurn": "Next turn",
  "running": "Running now",
  "turnClock": "Where each turn went",
  "toolCalls": "Tool calls",
  "when": "When",
  "who": "Who",
  "what": "What",
  "result": "Result",
  "edited": "Edited",
  "read": "Read",
  "subagents": "Subagents",
  "insights": "Insights",
  "slow": "Slowest calls",
  "big": "Largest results",
  "tasks": "Tasks",
  "log": "Session log",
  "search": "Search the log",
  "learning": "Across sessions",
  "sessions": "Sessions",
  "calls": "Calls",
  "errors": "Errors",
  "none": "Nothing yet.",
  "live": "live",
  "idle": "idle",
  "quota5h": "5-hour quota",
  "cacheHit": "Cache hit",
  "tokens": "Tokens",
  "commands": "Commands",
  "paletteHint": "Type a command…",
  "jumpTo": "Jump to",
  "actions": "Actions",
  "themeAuto": "Theme: system",
  "themeDark": "Theme: dark",
  "themeLight": "Theme: light",
  "copyCwd": "Copy the working directory",
  "onlyFailures": "Only failures",
  "showAll": "Show all calls",
  "filterCalls": "Filter calls",
  "everyone": "Everyone",
  "follow": "Follow",
  "copy": "Copy",
  "copied": "Copied",
  "details": "Call details",
  "error": "Error",
  "noMatch": "No match.",
  "verification": "Verification",
  "files": "Files",
  "overview": "Overview"
}

export type Page = typeof PAGE_EN
export type Labels = {
  page: Page
  main: string
  status: Record<string, string>
  check: Record<string, string>
  cat: Record<string, string>
  buckets: Record<string, string>
  result: Record<string, string>
}

export function pageOf(s: { labels?: Record<string, unknown> } | undefined): Page {
  return { ...PAGE_EN, ...(s?.labels?.page as Partial<Page> | undefined) }
}

export function labelsOf(s: WebSnapshot): Labels {
  const raw = s.labels as Partial<Labels>
  return { page: pageOf(s), main: raw.main ?? 'main session', status: raw.status ?? {}, check: raw.check ?? {}, cat: raw.cat ?? {}, buckets: raw.buckets ?? {}, result: raw.result ?? {} }
}
