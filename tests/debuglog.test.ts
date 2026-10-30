import { expect, test } from 'claude-code/testing'

import { debugLine, dayOf, logPath, pruneArgvs } from '../hooks/debuglog'

const at = new Date(2026, 9, 30, 14, 5, 9, 42).getTime()

test('a line is local time, the event, then key=value metadata', () => {
  expect(debugLine(at, 'tool.call', { tool: 'Bash', ms: 12, denied: false })).toBe('14:05:09.042 tool.call tool="Bash" ms=12 denied=false')
})

test('undefined fields are left out, and a long string is cut', () => {
  expect(debugLine(at, 'turn.start', { tokens: undefined, text: 'x'.repeat(300) })).toBe(`14:05:09.042 turn.start text="${'x'.repeat(200)}"`)
})

test('the day folder is the local date of the session start', () => {
  expect(dayOf(at)).toBe('2026-10-30')
  expect(logPath('/home/u/.claude', at, 'c2da587d-28d5-4c46-a0bc-27f84409b6cd')).toBe('/home/u/.claude/agentmon-live/debug/2026-10-30/c2da587d.log')
})

test('a session id with path characters cannot leave the debug folder', () => {
  expect(logPath('/cfg', at, '../../etc')).toBe('/cfg/agentmon-live/debug/2026-10-30/etc.log')
})

test('pruning deletes only logs older than seven days, under the debug folder, and then empty folders', () => {
  const [files, folders] = pruneArgvs('/cfg/agentmon-live/debug')
  expect(files).toEqual(['find', '/cfg/agentmon-live/debug', '-mindepth', '1', '-type', 'f', '-name', '*.log', '-mtime', '+7', '-delete'])
  expect(folders).toEqual(['find', '/cfg/agentmon-live/debug', '-mindepth', '1', '-type', 'd', '-empty', '-delete'])
})
