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

// A share in percent that never claims 100 % unless it is: from 99 % on, one decimal, rounded down.
export function percent(part: number, whole: number): string {
  const p = (part / whole) * 100
  if (p >= 100) return '100'
  return p >= 99 ? (Math.floor(p * 10) / 10).toFixed(1).replace('.', cfg.t.decimal) : String(Math.round(p))
}

export function kilo(n: number): string {
  return n >= 1000 ? `${decimal(n / 1000)}k` : String(n)
}

// The one argument that says what a call did: its file, command, pattern, ...
export function brief(call: object): string {
  const a = call as Record<string, unknown>
  const arg = ['file_path', 'command', 'pattern', 'url', 'query', 'description', 'skill'].map(k => a[k]).find(v => typeof v === 'string')
  return typeof arg === 'string' ? mask(arg.replace(/\s+/g, ' ')).slice(0, 100) : ''
}

// A quoted value is masked to its closing quote (spaces and all), an unquoted one to the next space.
const SECRET_NAME = /((?:api[_-]?key|token|secret|key|password|passwd|pwd|bearer|authorization)[\w-]{0,40})(\s*[=:]\s*|\s+)(?:(["'])((?:bearer|basic)\s+)?[^"'\n]{1,200}\3|((?:bearer|basic)\s+)?[^\s"']+)/gi
// Only `[^\s:@/]` and `[^\s@/]` follow `://`, so each scan stops at the next slash or space: linear.
const URL_CREDENTIALS = /:\/\/([^\s:@/]+):[^\s@/]+@/g
const SECRET_SHAPE = /\b(?:sk-[\w-]{16,}|[sr]k_(?:live|test)_\w{16,}|ghp_\w{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[bp]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|npm_\w{36}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]+)/g
// `curl -u user:pw`, `mysql -ppw` and cookie headers carry secrets without a telling name.
const FLAG_SECRET = /(\s(?:-u\s*|--user[=\s]\s*)[^\s:"']+:)[^\s"']+|(\b(?:mysql|mysqldump|mariadb)\b[^|;&\n]{0,200}?\s-p)[^\s"']+|(\b(?:set-)?cookie\s*:\s*)[^\n"']+/gi

// brief() goes to the advisor model and the pane; the name's tail is bounded so long words cannot make it quadratic.
export function mask(s: string): string {
  return s
    .replace(URL_CREDENTIALS, '://$1:***@')
    .replace(FLAG_SECRET, (_, user, mysql, cookie) => `${user ?? mysql ?? cookie}***`)
    .replace(SECRET_NAME, (_, name, sep, quote, quotedScheme, scheme) => (quote ? `${name}${sep}${quote}${quotedScheme ?? ''}***${quote}` : `${name}${sep}${scheme ?? ''}***`))
    .replace(SECRET_SHAPE, '***')
}

// What a call shows in the detail tabs and under Running now: `git push`, `npm test`, `sentry search_issues crash`.
export function describe(tool: string, call: object): string {
  const git = tool === 'Bash' ? gitCommand(String((call as { command?: unknown }).command ?? '')) : undefined
  // mcp__server__tool -> server tool
  return git !== undefined ? mask(git) : (/^mcp__/.test(tool) ? `${tool.split('__').slice(1).join(' ')} ${brief(call)}`.trim() : brief(call))
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
const ANSWER_FAIL = /\b([1-9]\d*)\s+(?:tests?\s+)?fail(?:ed|ing)?\b/i

// Quoted text and code are what an agent read, not what it ran: a file that says '1 failing' is no failed test.
const prose = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/"[^"\n]*"|(?<!\w)'[^'\n]*'(?!\w)/g, ' ')

export function testsOf(answer: string): string | undefined {
  if (ANSWER_FAIL.test(prose(answer))) return 'FAIL'
  const pass =
    answer.match(/(\d+)\s+(?:tests?|Tests)\s+(?:passed|bestanden|passing)/i) ??
    answer.match(/\bPASS(?:ED)?\b\D{0,12}(\d+)\s+tests?/i)
  if (pass) return cfg.t.testsPass(pass[1] ?? '')
  return undefined
}

// The line of an answer that made it a FAIL, so the person can judge whether it is real.
export function failLine(answer: string): string | undefined {
  return answer.split('\n').find(l => ANSWER_FAIL.test(prose(l)))?.trim().slice(0, 200)
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
  return findChecks(command)[0]
}

// Every check a command runs, in command order, one entry per kind: `npm run lint && npm test` is lint, then test.
export function findChecks(command: string): { kind: CheckKind; part: string }[] {
  // The heredoc regex is quadratic on many unterminated `<<A`; a real command never needs more than this.
  const plain = command.slice(0, 20_000).replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '')
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
  const found: { kind: CheckKind; part: string }[] = []
  for (const p of parts) {
    const kind = CHECKS.find(([, re]) => re.test(p.head))?.[0]
    if (kind && !found.some(f => f.kind === kind)) found.push({ kind, part: p.part })
  }
  return found
}

// A pipe hides the check's own exit status unless pipefail is set, so success there is only `unknown`.
export function hidesExit(command: string): boolean {
  return /[^|]\|[^|]/.test(command) && !/pipefail/.test(command)
}

const FAIL_COUNT = /\b[1-9]\d*\s+(?:tests?\s+)?fail(?:ed|ures?|ing)?\b|\bfail(?:ed|ures?)?:?\s+[1-9]/i
// `fail 0` is node's test runner summary.
const PASSES = /\b0\s+(?:fail(?:ed|ures?)?|errors?|problems?)\b|\bfail(?:ed|ures?)?:?\s+0\b|\b\d+\s+(?:tests?\s+)?pass(?:ed|ing)?\b|✔|\bpassed\b|\bno (?:errors|problems)\b/i

// With the exit hidden (`npm test | tail`) the summary decides, bottom up, so a passing test named "2 errors" is no failure.
export function outcomeOf(output: string, kind: CheckKind): 'ok' | 'failed' | 'unknown' {
  // The summary is at the end; the cap keeps the scans cheap on huge logs.
  const out = output.slice(-20_000)
  for (const line of out.split('\n').filter(l => l.trim()).slice(-15).reverse()) {
    if (FAIL_COUNT.test(line) || /^\s*FAIL\b/.test(line)) return 'failed'
    if (PASSES.test(line)) return 'ok'
  }
  if (/\b[1-9]\d*\s+(?:tests?\s+)?(?:fail(?:ed|ures?|ing)?|errors?|problems?)\b|✘|✖|error TS\d+|^error\b/im.test(out) || /\bFAIL(?:ED)?\b/.test(out)) return 'failed'
  if (PASSES.test(out)) return 'ok'
  return out.trim() === '' && (kind === 'typecheck' || kind === 'lint') ? 'ok' : 'unknown'
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
