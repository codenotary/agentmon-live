import type { EngineInterface } from 'claude-code'

// Metadata only: a prompt, a file's text or a command line never goes in, so the file can be shared.
// shortcut: the host has no append, so each flush rewrites the file; upgrade to append when it does.
const KEEP_LINES = 3000
const KEEP_DAYS = 7
const FLUSH_MS = 10_000
const VALUE_MAX = 200

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

// The day folder and the line times are the person's local clock, the one they read the log by.
export function dayOf(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function debugLine(at: number, event: string, fields: Record<string, unknown>): string {
  const d = new Date(at)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(typeof v === 'string' ? v.slice(0, VALUE_MAX) : v)}`)
  return [time, event, ...parts].join(' ')
}

export function logPath(configDir: string, at: number, sessionId: string): string {
  return `${configDir}/agentmon-live/debug/${dayOf(at)}/${sessionId.replace(/[^\w-]/g, '').slice(0, 8)}.log`
}

// The host has no delete, so `find` removes old logs: argv, no shell, and only under this mod's debug folder.
export function pruneArgvs(root: string): string[][] {
  return [
    ['find', root, '-mindepth', '1', '-type', 'f', '-name', '*.log', '-mtime', `+${KEEP_DAYS}`, '-delete'],
    ['find', root, '-mindepth', '1', '-type', 'd', '-empty', '-delete'],
  ]
}

export async function pruneDebugLogs($: EngineInterface, root: string) {
  for (const argv of pruneArgvs(root)) await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => undefined)
}

let file: string | undefined
let lines: string[] = []
let isFlushQueued = false
let saving: Promise<void> = Promise.resolve()

// Opens this session's file and keeps what an earlier load of the mod wrote, so a reload does not blank it.
export async function openDebugLog($: EngineInterface, at: number) {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
  file = logPath(configDir, at, await $.session.id())
  lines = (await $.fs.read(file).catch(() => '')).split('\n').filter(Boolean).slice(-KEEP_LINES)
  void pruneDebugLogs($, `${configDir}/agentmon-live/debug`).catch(() => undefined)
}

export function debugPath(): string | undefined {
  return file
}

// Never throws: a log that fails must not hold up the session.
export async function debug($: EngineInterface, event: string, fields: Record<string, unknown> = {}) {
  if (file === undefined) return
  try {
    lines = [...lines, debugLine(await $.clock.now(), event, fields)].slice(-KEEP_LINES)
    if (isFlushQueued) return
    isFlushQueued = true
    $.clock.after(FLUSH_MS, () => saveDebugLog($))
  } catch {
    // Dropped line: the next event still writes.
  }
}

// Saves run one after another: a slow write must not land after a newer one and leave older lines on disk.
export function saveDebugLog($: EngineInterface): Promise<void> {
  saving = saving.then(() => flush($))
  return saving
}

async function flush($: EngineInterface) {
  isFlushQueued = false
  if (file === undefined) return
  await $.fs.write(file, `${lines.join('\n')}\n`).catch(() => undefined)
}
