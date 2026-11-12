import type { EngineInterface } from 'claude-code'

import type { Leak } from '../types'
import { hasSecret, mask } from './format'
import { isIgnored } from './git'
import { LANGUAGES } from './i18n'
import { configDir } from './learning'
import { configureSize } from './sizeguard'
import { cfg } from './state'

type Options = Record<string, unknown>

// This mod's options in the text of a settings.json; none when it does not parse.
export function pickOptions(settings: string): Options {
  try {
    const configs = (JSON.parse(settings) as { pluginConfigs?: Record<string, { options?: Options }> }).pluginConfigs ?? {}
    const entries = Object.entries(configs).filter(([id]) => id === 'agentmon-live' || id.startsWith('agentmon-live@'))
    return Object.assign({}, ...entries.map(([, entry]) => entry?.options))
  } catch {
    return {}
  }
}

// Every string value; one under a name (`env`, `headers`) carries it, since the name is what marks it a secret.
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(typeof x === 'string' && !Array.isArray(v) ? `${k}=${x}` : x, out)
  return out
}

// The values in a settings.json that hold a literal secret, masked; none when it does not parse.
export function secretStrings(settings: string): string[] {
  try {
    return strings(JSON.parse(settings)).filter(hasSecret).map(mask)
  } catch {
    return []
  }
}

// The project's settings files: "don't ask again" saves a command there whole, token and all.
export async function loadLeaks($: EngineInterface, cwd: string): Promise<void> {
  const leaks: Leak[] = []
  for (const file of ['.claude/settings.local.json', '.claude/settings.json']) {
    const found = secretStrings(await $.fs.read(`${cwd}/${file}`).catch(() => ''))
    if (found.length > 0) leaks.push({ file, count: found.length, isIgnored: await isIgnored($, cwd, file), sample: found[0]!.slice(0, 60) })
  }
  cfg.leaks = leaks
}

// `de_CH.UTF-8` is `de`. Undefined for `C`, `POSIX` or a language the mod lacks.
export function languageFromEnv(locale: string | undefined): string | undefined {
  const code = locale?.slice(0, 2).toLowerCase()
  return code && Object.hasOwn(LANGUAGES, code) ? code : undefined
}

export function applyOptions(options: Options, envLanguage: string | undefined): void {
  cfg.lang = [String(options.language), envLanguage].find(l => l !== undefined && Object.hasOwn(LANGUAGES, l)) ?? 'en'
  cfg.t = LANGUAGES[cfg.lang]!
  cfg.advisorModel = String(options.advisorModel || 'claude-fable-5-1')
  // `plan` was the plan-only mode, gone with the plan check; its nearest is the gate without a model.
  cfg.advisorMode = String(options.advisorMode || 'all').replace(/^plan$/, 'gate')
  const budget = Number(options.advisorBudget ?? 30)
  cfg.advisorBudget = Number.isFinite(budget) && budget >= 0 ? budget : 30
  cfg.sizeLimit = options.sizeLimit
  cfg.sizeExclude = options.sizeExclude
  configureSize(cfg.sizeLimit, cfg.sizeExclude, cfg.sizeExceptions)
  cfg.learning = String(options.learning ?? 'on') !== 'off'
  cfg.debugLog = String(options.debugLog ?? 'on') !== 'off'
  cfg.hidden = String(options.hiddenSections ?? '').split(',').map(s => s.trim()).filter(Boolean)
  // `live` or anything not a positive number redraws on every change.
  const refresh = Number(options.refreshRate ?? 'live')
  cfg.refreshMs = Number.isFinite(refresh) && refresh > 0 ? refresh * 1000 : 0
  cfg.isClassic = String(options.layout ?? 'calm') === 'classic'
  const basePoll = Number(options.gitPollMinutes ?? 5)
  cfg.baseMinutes = Number.isFinite(basePoll) && basePoll > 0 ? basePoll : 0
  cfg.isFetching = String(options.gitFetch ?? false) === 'true'
  cfg.web = String(options.web ?? 'on') !== 'off'
  const webPort = Number(options.webPort ?? 47311)
  cfg.webPort = Number.isInteger(webPort) && webPort >= 1024 && webPort <= 65535 ? webPort : 47311
  cfg.webOpenOnStart = String(options.webOpenOnStart ?? false) === 'true'
  cfg.isWebLocked = String(options.webToken ?? 'on') !== 'off'
}

// The manifest declares no `userConfig`, because Claude Code then opens its options dialog on install whatever the defaults.
// shortcut: reads only the user's settings.json, not --settings or managed settings; upgrade when Claude Code can skip that dialog.
export async function loadOptions($: EngineInterface): Promise<void> {
  const path = (await $.env.get('AGENTMON_SETTINGS')) || `${(await configDir($)).conf}/settings.json`
  const settings = await $.fs.read(path).catch(() => '{}')
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  applyOptions(pickOptions(settings), languageFromEnv(locale))
}
