// The snapshot's keys, in one place: the kit cannot load the JSON fixture, so its test holds toSnapshot to this and the server test holds the fixture to it.
export const SHAPE = {
  top: ['v', 'session', 'now', 'lang', 'labels', 'main', 'isPaneOpen', 'build', 'testReview', 'focus', 'usage', 'turns', 'turnCount', 'active', 'calls', 'trace', 'agents', 'checks', 'files', 'log', 'tasks', 'insights', 'learned'],
  session: ['id', 'cwd', 'branch'],
  usage: ['ctxPct', 'rate', 'usd'],
  insights: ['slow', 'big', 'tokens', 'cacheRead', 'cacheTotal'],
  learned: ['sessions', 'bench'],
  labels: ['page', 'main', 'status', 'check', 'cat', 'buckets', 'result'],
  page: ['disconnected', 'noSessions', 'update', 'cache', 'tokensIn', 'tokensOut', 'context', 'quota', 'cost', 'turns', 'events', 'cleared', 'paneHide', 'paneShow', 'waterfall', 'prevTurn', 'nextTurn', 'running', 'turnClock', 'toolCalls', 'when', 'who', 'what', 'result', 'edited', 'read', 'subagents', 'insights', 'slow', 'big', 'tasks', 'log', 'search', 'learning', 'sessions', 'calls', 'errors', 'none', 'live', 'idle', 'quota5h', 'cacheHit', 'tokens', 'commands', 'paletteHint', 'jumpTo', 'actions', 'themeAuto', 'themeDark', 'themeLight', 'copyCwd', 'onlyFailures', 'showAll', 'filterCalls', 'everyone', 'follow', 'copy', 'copied', 'details', 'error', 'noMatch', 'verification', 'files', 'overview', 'testEdits', 'assertsRemoved', 'skipsAdded', 'helpInstruments', 'helpWaterfall', 'helpEvents', 'helpRunning', 'helpTurns', 'helpCalls', 'helpInsights', 'helpVerification', 'helpTasks', 'helpAgents', 'helpFiles', 'helpLog', 'helpLearning'],
}
