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
  "call": "Call",
  "agentColumn": "Agent",
  "elapsed": "Elapsed",
  "costColumn": "Cost",
  "health": "Health",
  "duration": "Duration",
  "agentsWord": "agents",
  "started": "Started",
  "ended": "ended",
  "model": "Model",
  "turn": "Turn",
  "cached": "cached",
  "showCalls": "Show calls",
  "copySummary": "Copy summary",
  "levelGood": "fine",
  "levelWarn": "worth a look",
  "levelBad": "needs a look",
  "listAll": "Show all",
  "listFewer": "Show fewer",
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
  "overview": "Overview",
  "testEdits": "Test files edited",
  "assertsRemoved": "assertions removed",
  "assertsChanged": "assertions changed",
  "skipsAdded": "skips added",
  "helpInstruments": "Context: how full this session's context window is; near full, Claude compacts the conversation. 5-hour and 7-day quota: how much of your plan's limits is used. Gauges turn yellow at 60% and red at 80%. Session cost: spend so far, with its trend since you opened this page. Turns: prompts answered. Cache hit: share of the main session's input tokens read from the prompt cache; higher is cheaper. Tokens: sent in and out, subagents included.",
  "helpWaterfall": "Every tool call of one turn, in the order it started. A bar shows when the call ran and for how long; a subagent's calls sit under it. Gaps are time the model spent thinking. The slowest call is marked, failures are red and running calls are striped. Click a call for its details; the arrows go to earlier turns.",
  "helpEvents": "What needs you, such as a waiting approval or a failed test. An item that goes away stays here, marked cleared with its time. The history starts when you open this page.",
  "helpRunning": "Each tool call running right now, who runs it and for how long.",
  "helpTurns": "One bar per recent turn, showing where its time went: the model, each kind of tool, and waiting for you. The longest turn sets the scale.",
  "helpCalls": "The session's recent tool calls: when, who, what and the result. Click a column head to sort, filter with the box and the buttons, and click a row for its details.",
  "helpInsights": "The calls worth a look: those that took longest, and those whose results were largest in tokens, since large results fill the context.",
  "helpVerification": "The last test, lint, typecheck and build command and how each ended. A dash means it has not run yet. A number is how many tests ran, with (−n) skipped. Hover for the whole command. Test files edited are listed below, with the changed lines. The list stays until you press x on its item in the pane. Some updates are right, so check them.",
  "helpTasks": "Claude's to-do list for this session, and how many items are done.",
  "helpAgents": "One row per subagent: what it does, its type and model, how long it ran, its calls, tokens, cost, errors and files edited. The three dots show its duration, tokens and errors against the session's other subagents: green is fine, amber worth a look, red needs a look. Agents with the worst dots come first, running ones on top; click a column head to sort. More than eight sharing a name before a colon fold into one row. Click a row for the prompt and its calls. Keys: arrows move, Enter opens, Esc closes, f shows the agent's tool calls. FAIL means it reported failing tests; hover for why.",
  "helpFiles": "The files this session edited and read, the last eight of each, from successful calls only. Hover for the whole path.",
  "helpLog": "Everything the session did, in order: time, who, what and the result. Press / to search. Follow keeps the newest line in view.",
  "helpLearning": "Earlier sessions in this project: date, turns, calls, errors and cost, with the cost trend on top. Use it to see whether sessions are getting better."
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
