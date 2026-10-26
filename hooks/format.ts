import type { CheckKind } from '../types'
import { cfg } from './state'

// `git status`, `cd x && git push`, `git -C dir log`: the git part of a shell command, else undefined.
export function gitCommand(command: string): string | undefined {
  return command.match(/(?:^|&&|\|\||;|\n)\s*(git\s+[^&|;]*)/)?.[1]?.trim().replace(/\s+/g, ' ')
}

// claude-sonnet-5-5 -> Sonnet 5.5
export function modelName(id: string): string {
  const m = id.match(/claude-([a-z]+)-(\d+)-(\d+)/) ?? id.match(/^([a-z]+)$/)
  if (!m) return id || '?'
  const word = m[1] ?? ''
  const name = word.charAt(0).toUpperCase() + word.slice(1)
  return m[2] ? `${name} ${m[2]}.${m[3]}` : name
}

export function decimal(n: number): string {
  return n.toFixed(1).replace('.', cfg.t.decimal)
}

export function kilo(n: number): string {
  return n >= 1000 ? `${decimal(n / 1000)}k` : String(n)
}

// The one argument that says what a call did: its file, command, pattern, ...
export function brief(call: object): string {
  const a = call as Record<string, unknown>
  const arg = ['file_path', 'command', 'pattern', 'url', 'query', 'description', 'skill'].map(k => a[k]).find(v => typeof v === 'string')
  return typeof arg === 'string' ? arg.replace(/\s+/g, ' ').slice(0, 100) : ''
}

// What a call shows in the detail tabs and under Running now: `git push`, `npm test`, `sentry search_issues crash`.
export function describe(tool: string, call: object): string {
  const git = tool === 'Bash' ? gitCommand(String((call as { command?: unknown }).command ?? '')) : undefined
  // mcp__server__tool -> server tool
  return git ?? (/^mcp__/.test(tool) ? `${tool.split('__').slice(1).join(' ')} ${brief(call)}`.trim() : brief(call))
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

// Cut `s` to `width - 1` terminal columns and pad it to `width`; CJK and full-width characters take two columns.
export function fit(s: string, width: number): string {
  let out = ''
  let used = 0
  for (const c of s) {
    const w = WIDE.test(c) ? 2 : 1
    if (used + w > width - 1) break
    out += c
    used += w
  }
  return out + ' '.repeat(width - used)
}

export function effortBar(effort: string): string {
  const n = ({ low: 1, medium: 2, high: 3, xhigh: 4, max: 4 } as Record<string, number>)[effort] ?? 0
  return '█'.repeat(n) + '▯'.repeat(4 - n)
}

export function clockTime(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes()].map(v => String(v).padStart(2, '0')).join(':')
}

// An elapsed time a person reads at a glance: 45 s, 12 min, 2 h 5 min.
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

// A limit's reset: the time when it is today, else the weekday too (`Thu 15:00`).
export function resetTime(ms: number, now: number): string {
  const d = new Date(ms)
  if (d.toDateString() === new Date(now).toDateString()) return clockTime(ms)
  return `${d.toLocaleDateString(cfg.lang, { weekday: 'short' })} ${clockTime(ms)}`
}

// A failure anywhere wins over a pass count: "3 passed, 2 failed" is a FAIL.
export function testsOf(answer: string): string | undefined {
  if (/\b([1-9]\d*)\s+(?:tests?\s+)?fail(?:ed|ing)?\b/i.test(answer)) return 'FAIL'
  const pass =
    answer.match(/(\d+)\s+(?:tests?|Tests)\s+(?:passed|bestanden|passing)/i) ??
    answer.match(/\bPASS(?:ED)?\b\D{0,12}(\d+)\s+tests?/i)
  if (pass) return cfg.t.testsPass(pass[1] ?? '')
  return undefined
}

const RUN = String.raw`(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?`
// Each pattern must start a command; the first kind that matches wins, so `tsc` is a typecheck, not a build.
const CHECKS: [CheckKind, RegExp][] = [
  ['typecheck', new RegExp(String.raw`^(?:tsc|${RUN}(?:typecheck|type-check)|mypy|pyright|cargo check)\b`)],
  ['lint', new RegExp(String.raw`^(?:${RUN}lint|eslint|ruff|clippy|golangci-lint|flake8|biome (?:check|lint)|(?:claude )?plugin validate)\b`)],
  ['test', new RegExp(String.raw`^(?:${RUN}test|go test|cargo test|pytest|jest|vitest|mocha|(?:claude )?plugin test|make test)\b`)],
  ['build', new RegExp(String.raw`^(?:${RUN}build|cargo build|go build|make(?!\s+(?:clean|distclean|install|help)\b)|webpack|esbuild|vite build)\b`)],
]

// Which check a shell command runs, if any, and the part of the command that runs it. Only the commands
// themselves count: heredoc bodies are dropped, quoted text blanked, and a runner must start a command, so
// `cat <<EOF … npm test … EOF`, `echo "x; npm test"` or `grep lint x` is no check. Wrappers (`npx`, `uv run`,
// `python -m`, a path) are skipped.
export function findCheck(command: string): { kind: CheckKind; part: string } | undefined {
  const plain = command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '')
  // Quoted text turns to spaces of the same length, so a part found in `blank` is cut from `plain` at the same place.
  const blank = plain.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, q => q[0] + ' '.repeat(q.length - 2) + q[0])
  const parts: { head: string; part: string }[] = []
  let start = 0
  for (const m of blank.matchAll(/&&|\|\||;|\||\n|$/g)) {
    const head = blank.slice(start, m.index).trim()
    parts.push({ head: head.replace(/^(?:\w+=\S*\s+)*(?:(?:npx|bunx|sudo|time|uv run|poetry run|python3? -m)\s+)*(?:\S*\/)?/, ''), part: plain.slice(start, m.index).trim() })
    start = m.index + m[0].length
    if (m[0] === '') break
  }
  for (const [kind, re] of CHECKS) {
    const found = parts.find(p => re.test(p.head))
    if (found) return { kind, part: found.part }
  }
  return undefined
}

// A pipe hides the check's own exit status unless pipefail is set, so success there is only `unknown`.
export function hidesExit(command: string): boolean {
  return /[^|]\|[^|]/.test(command) && !/pipefail/.test(command)
}

// With the exit status hidden (`npm test | tail`), the output's own summary says how the check went.
// A failure count wins; a silent typecheck or lint passed; anything else stays unknown.
export function outcomeOf(output: string, kind: CheckKind): 'ok' | 'failed' | 'unknown' {
  if (/\b[1-9]\d*\s+(?:tests?\s+)?(?:fail(?:ed|ures?|ing)?|errors?|problems?)\b|✘|✖|error TS\d+|^error\b/im.test(output) || /\bFAIL(?:ED)?\b/.test(output)) return 'failed'
  if (/\b0\s+(?:fail(?:ed|ures?)?|errors?|problems?)\b|\b\d+\s+(?:tests?\s+)?pass(?:ed|ing)?\b|✔|\bpassed\b|\bno (?:errors|problems)\b/i.test(output)) return 'ok'
  return output.trim() === '' && (kind === 'typecheck' || kind === 'lint') ? 'ok' : 'unknown'
}

// /home/me/repo/hooks/state.ts -> hooks/state.ts
export function shortPath(path: string): string {
  return path.split('/').slice(-2).join('/')
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// A bar `width` cells wide filled to `fraction` in eighths of a cell, padded with spaces.
export function smoothBar(fraction: number, width: number): string {
  const eighths = Math.round(Math.min(1, Math.max(0, fraction || 0)) * width * 8)
  const bar = '█'.repeat(Math.floor(eighths / 8)) + EIGHTHS[eighths % 8]
  return bar.padEnd(width)
}

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

// The spinner frame for `now`; the pane redraws twice a second while something runs.
export function spinner(now: number): string {
  return FRAMES[Math.floor(now / 500) % FRAMES.length] ?? '⠋'
}
