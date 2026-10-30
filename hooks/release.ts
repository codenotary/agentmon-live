import type { EngineInterface } from 'claude-code'

import { readBase } from './git'
import { isNewer, mask } from './format'
import { cfg } from './state'

// Which build is loaded: the manifest's version and, in a git checkout, the commit (`0.6.0 · 3366336`).
export async function build($: EngineInterface): Promise<string> {
  const root = $.plugin.root
  const read = (path: string) => $.fs.read(`${root}/${path}`).catch(() => '')
  const manifest = await read('.claude-plugin/plugin.json')
  const version = String((manifest ? (JSON.parse(manifest) as { version?: unknown }) : {}).version ?? '')
  cfg.version = version
  const head = (await read('.git/HEAD')).trim()
  const ref = head.match(/^ref: (\S+)$/)?.[1]
  // A ref with `..` would read outside .git.
  const sha =
    ref === undefined
      ? head
      : ref.includes('..')
        ? ''
        : (await read(`.git/${ref}`)).trim() ||
          ((await read('.git/packed-refs')).split('\n').find(line => line.endsWith(` ${ref}`))?.split(' ')[0] ?? '')
  // A worktree's `.git` is a file (`gitdir: …`), so what reads here need not be a commit.
  return [version, /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : ''].filter(Boolean).join(' · ')
}

// Where the branch stands against its base, read again every `minutes`; a fetch first only when asked for and the network is allowed.
// shortcut: polls on a timer, no push; watch .git/refs if a poll proves too slow.
export async function watchBase($: EngineInterface, cwd: string, minutes: number, fetch: boolean) {
  await refreshBase($, cwd, fetch && !(await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')))
  $.clock.after(minutes * 60_000, () => watchBase($, cwd, minutes, fetch))
}

export async function refreshBase($: EngineInterface, cwd: string, fetch: boolean) {
  cfg.base = await readBase($, cwd, fetch).catch(() => undefined)
  $.ui.invalidate('ui.render')
}

const RELEASES = 'https://api.github.com/repos/codenotary/agentmon-live/releases/latest'
// GitHub allows 60 unauthenticated calls an hour. A newer release found is kept a day, anything else an hour;
// an install or update since the last look (`installed` differs) asks again at once.
const RELEASE_TTL_MS = 24 * 3_600_000
const CURRENT_TTL_MS = 3_600_000

// The latest GitHub release, so Focus can offer the update; cached in the store, silent on any failure.
export async function checkRelease($: EngineInterface) {
  cfg.release = undefined
  if (await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')) return
  const now = await $.clock.now()
  const kept = (await $.store.get('release')) as { at?: unknown; version?: unknown; notes?: unknown; installed?: unknown } | undefined
  const isFresh =
    typeof kept?.at === 'number' && typeof kept.version === 'string' && kept.installed === cfg.version && now - kept.at < (isNewer(kept.version, cfg.version) ? RELEASE_TTL_MS : CURRENT_TTL_MS)
  let release = isFresh ? { version: String(kept!.version), notes: String(kept!.notes ?? '') } : undefined
  if (!release) {
    const r = await $.http.fetch(RELEASES, { headers: { accept: 'application/vnd.github+json' } })
    if (!r.ok) return
    const body = JSON.parse(r.text) as { tag_name?: unknown; body?: unknown }
    if (typeof body.tag_name !== 'string') return
    release = { version: body.tag_name.replace(/^v/, ''), notes: mask(String(body.body ?? '')).slice(0, 1500) }
    await $.store.set('release', { at: now, ...release, installed: cfg.version })
  }
  cfg.release = release
  $.ui.invalidate('ui.render')
}
