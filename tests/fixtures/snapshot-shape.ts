// The snapshot's keys, in one place: the kit cannot load the JSON fixture, so its test holds toSnapshot to this and the server test holds the fixture to it.
export const SHAPE = {
  top: ['v', 'session', 'now', 'lang', 'labels', 'main', 'focus', 'usage', 'turns', 'turnCount', 'active', 'calls', 'agents', 'checks', 'files', 'log', 'tasks', 'insights', 'learned'],
  session: ['id', 'cwd', 'branch'],
  usage: ['ctxPct', 'rate', 'usd'],
  insights: ['slow', 'big', 'tokens', 'cacheRead', 'cacheTotal'],
  learned: ['sessions', 'bench'],
  labels: ['page', 'status', 'check', 'cat', 'buckets', 'result'],
  page: ['disconnected', 'noSessions', 'update', 'cache', 'tokensIn', 'tokensOut', 'context', 'quota', 'cost', 'turns', 'focus', 'running', 'turnClock', 'toolCalls', 'when', 'who', 'what', 'result', 'changes', 'edited', 'read', 'subagents', 'insights', 'slow', 'big', 'tasks', 'log', 'search', 'learning', 'sessions', 'calls', 'errors', 'none'],
}
