import { closeSync, constants, fstatSync, openSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const MAX_FILE = 4 * 1024 * 1024
const KEEP_FILES = 64
const NAME = /^([\w-]{1,80})\.json$/

// shortcut: only the top of the shape is checked, so a sandbox can write a snapshot the page fails to draw; check every field when the sandbox is not your own.
const isSnapshot = v => v !== null && typeof v === 'object' && typeof v.session === 'object' && v.session !== null && Array.isArray(v.turns)

// The file's value when it changed since `mark`. A link is not followed and a pipe does not block: a sandbox writes this folder.
function readChanged(path, mark) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_FILE) return {}
    const now = `${stat.mtimeMs}:${stat.size}`
    return now === mark ? {} : { mark: now, value: JSON.parse(readFileSync(fd, 'utf8')) }
  } finally {
    closeSync(fd)
  }
}

// `[id, snapshot]` of each session that writes its snapshot to this folder because it cannot reach the server: one in a VM or a container.
export function readSpool(dir, now, ttlMs, cache) {
  let names
  try {
    names = readdirSync(dir).filter(n => NAME.test(n)).slice(0, KEEP_FILES)
  } catch {
    return []
  }
  const live = []
  for (const name of names) {
    const id = name.match(NAME)[1]
    const path = join(dir, name)
    try {
      const { mark, value } = readChanged(path, cache.get(id)?.mark)
      // Alive is a change this server saw, not the file's time: a VM's clock may differ.
      if (value?.ended === true) cache.set(id, { mark, seenAt: -Infinity })
      else if (isSnapshot(value)) cache.set(id, { mark, seenAt: now, snapshot: value })
    } catch {
      // Half written, or gone since the listing: the last one read stands.
    }
    const had = cache.get(id)
    if (!had) continue
    if (now - had.seenAt <= ttlMs) {
      live.push([id, had.snapshot])
      continue
    }
    // Ended, or silent like a crashed session. Kept in the cache while the file cannot be removed, so it is not read as new.
    had.seenAt = -Infinity
    try {
      unlinkSync(path)
      cache.delete(id)
    } catch {
      // Stays, unread until it changes.
    }
  }
  for (const id of cache.keys()) if (!names.includes(`${id}.json`)) cache.delete(id)
  return live
}
