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

// The page's `dur`, so a log line and a subagent's row read the same.
export function took(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`
}

export function kilo(n: number): string {
  return Math.abs(n) >= 1000 ? `${decimal(n / 1000)}k` : String(n)
}

// The one argument that says what a call did: its file, command, pattern, ...
export function brief(call: object): string {
  const a = call as Record<string, unknown>
  const arg = ['file_path', 'command', 'pattern', 'url', 'query', 'description', 'skill'].map(k => a[k]).find(v => typeof v === 'string')
  return typeof arg === 'string' ? mask(arg.slice(0, 2000).replace(/\s+/g, ' ')).slice(0, 100) : ''
}

// A quoted value is masked to its closing quote (spaces and all), an unquoted one to the next space.
// After a bare space only a secret-looking value counts (a digit, 16+ characters or a quote), so `token refresh bug` stays.
// A JSON key's closing quote may sit before the separator: `{"token": "x"}`. `sig` must end there, so `signal 9` stays.
const SECRET_NAME = /((?<![a-z])(?:(?:api[_-]?key|token|secret|key|password|passwd|pwd|bearer|authorization)[\w-]{0,40}|sig(?:nature)?(?![a-z])))(["']?\s*[=:]\s*|\s+(?=["']|(?:bearer|basic|token)\s|[^\s"']*\d|[^\s"']{16}))(?:(["'])((?:bearer|basic|token)\s+)?[^"'\n]{1,200}\3|((?:bearer|basic|token)\s+)?[^\s"'&]+)/gi
// camelCase and prefixed names (`accessToken`, `PGPASSWORD`), only with `=` or `:`, and only when the name ends there: `maxTokens: 4000` stays.
// The prefix is bounded, so a long word cannot make it quadratic.
const PREFIXED_SECRET = /\b([a-z_]{1,40}(?:password|passwd|secret|token|api_?key))(?![a-z])(["']?\s*[=:]\s*)(?:(["'])[^"'\n]{1,200}\3|[^\s"',;]+)/gi
// Only `[^\s:@/]` and `[^\s@/]` follow `://`, so each scan stops at the next slash or space: linear.
const URL_CREDENTIALS = /:\/\/([^\s:@/]+):[^\s@/]+@/g
const SECRET_SHAPE = /\b(?:sk-[\w-]{16,}|[sr]k_(?:live|test)_\w{16,}|gh[pousr]_\w{20,}|hf_\w{20,}|whsec_\w{20,}|ya29\.[\w-]{20,}|xapp-[\w-]{10,}|hooks\.slack\.com\/services\/[\w/]+|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|npm_\w{36}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]+)/g
// `curl -u user:pw`, `mysql -ppw`, `sshpass -p pw`, `redis-cli -a pw`, `--password pw` and cookie headers carry secrets without a telling name.
const FLAG_SECRET = /(\s(?:-u\s*|--user[=\s]\s*)[^\s:"']+:)[^\s"']+|(\b(?:mysql|mysqldump|mariadb)\b[^|;&\n]{0,200}?\s-p)[^\s"']+|(\bsshpass\s+-p\s*|\bredis-cli\b[^|;&\n]{0,200}?\s-a\s+|--password[=\s]\s*)[^\s"']+|(\b(?:set-)?cookie\s*:\s*)[^\n"']+/gi
// A PEM private key spans lines: masked whole, up to its END line or the end of the text.
const PRIVATE_KEY = /(-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----)[\s\S]*?(?:-----END[^\n]*|$)/g

// brief() goes to the advisor model and the pane; the name's tail is bounded so long words cannot make it quadratic.
export function mask(s: string): string {
  return s
    .replace(PRIVATE_KEY, '$1***')
    .replace(URL_CREDENTIALS, '://$1:***@')
    .replace(FLAG_SECRET, (_, user, mysql, flag, cookie) => `${user ?? mysql ?? flag ?? cookie}***`)
    .replace(SECRET_NAME, (_, name, sep, quote, quotedScheme, scheme) => (quote ? `${name}${sep}${quote}${quotedScheme ?? ''}***${quote}` : `${name}${sep}${scheme ?? ''}***`))
    .replace(PREFIXED_SECRET, (_, name, sep, quote = '') => `${name}${sep}${quote}***${quote}`)
    .replace(SECRET_SHAPE, '***')
}

// What a call shows in the detail tabs and under Running now: `git push`, `npm test`, `sentry search_issues crash`.
export function describe(tool: string, call: object): string {
  const git = tool === 'Bash' ? gitCommand(String((call as { command?: unknown }).command ?? '')) : undefined
  // mcp__server__tool -> server tool
  return git !== undefined ? mask(git) : (/^mcp__/.test(tool) ? `${tool.split('__').slice(1).join(' ')} ${brief(call)}`.trim() : brief(call))
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

// Terminal columns `s` takes: CJK and full-width characters take two.
export function width(s: string): number {
  let used = 0
  for (const c of s) used += WIDE.test(c) ? 2 : 1
  return used
}

// The longest start of `s` that fits in `cols` columns; whole characters only, so an emoji is never split.
export function clip(s: string, cols: number): string {
  let out = ''
  let used = 0
  for (const c of s) {
    const w = WIDE.test(c) ? 2 : 1
    if (used + w > cols) break
    out += c
    used += w
  }
  return out
}

// Cut `s` to `width - 1` terminal columns and pad it to `width`.
export function fit(s: string, cols: number): string {
  const out = clip(s, cols - 1)
  return out + ' '.repeat(cols - width(out))
}

// Zero-padded to `width` digits, for clock times and log stamps.
export const pad = (n: number, width = 2) => String(n).padStart(width, '0')

export function clockTime(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes()].map(v => pad(v)).join(':')
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

// `pnpm --filter web test`, `npm --prefix api test`, `yarn workspace web test` run the same script in one package.
const RUN = String.raw`(?:npm|pnpm|yarn|bun)\s+(?:(?:--filter|-F|--prefix|-C|--dir|-w|--workspace)(?:=|\s+)\S+\s+|workspace\s+\S+\s+)*(?:run\s+)?`
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

// Every check a command runs, in command order, one entry per kind unless `isEvery`: `npm run lint && npm test` is lint, then test.
export function findChecks(command: string, isEvery = false): { kind: CheckKind; part: string }[] {
  const found: { kind: CheckKind; part: string }[] = []
  for (const p of partsOf(command).parts) {
    const kind = CHECKS.find(([, re]) => re.test(p.head))?.[0]
    if (kind && (isEvery || !found.some(f => f.kind === kind))) found.push({ kind, part: p.part })
  }
  return found
}

// The commands a shell line runs, each with where it ends in `blank`: heredoc bodies dropped, quoted text blanked, a backslash-newline joined.
function partsOf(command: string): { blank: string; parts: { head: string; part: string; end: number }[] } {
  // The heredoc regex is quadratic on many unterminated `<<A`; a real command never needs more than this.
  const plain = command.slice(0, 20_000).replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '').replace(/\\\n/g, '  ')
  // Quoted text turns to spaces of the same length, so a part found in `blank` is cut from `plain` at the same place.
  const blank = plain.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, q => q[0] + ' '.repeat(q.length - 2) + q[0])
  const parts: { head: string; part: string; end: number }[] = []
  let start = 0
  for (const m of blank.matchAll(/&&|\|\||;|\||\n|$/g)) {
    const head = blank.slice(start, m.index).trim()
    parts.push({ end: m.index, head: head.replace(/^(?:\w+=\S*\s+)*(?:(?:npx(?:\s+(?:(?:-p|--package)(?:=|\s+)\S+|-y|--yes))*|bunx|sudo|time|uv run|poetry run|python3? -m)\s+)*(?:\S*\/)?/, ''), part: plain.slice(start, m.index).trim() })
    start = m.index + m[0].length
    if (m[0] === '') break
  }
  return { blank, parts }
}

// A pipe hides the check's own exit status unless pipefail is set, so success there is only `unknown`.
// `||` turns a failure into exit 0 the same way, and so does a command after `;` or a newline: the shell reports the last one.
export function hidesExit(command: string): boolean {
  if (/\|\|/.test(command) || (/[^|]\|[^|]/.test(command) && !/pipefail/.test(command))) return true
  const { blank, parts } = partsOf(command)
  const first = parts.find(p => CHECKS.some(([, re]) => re.test(p.head)))
  // The first check counts: `npm run lint; npm test` hides the lint. In `blank` quoted text and heredocs are no separators.
  return first !== undefined && /[;\n]\s*\S/.test(blank.slice(first.end))
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

// `to` resolved against `base`, `.` and `..` folded; an absolute `to` wins.
export function joinPath(base: string, to: string): string {
  const out: string[] = []
  for (const seg of (to.startsWith('/') ? to : `${base}/${to}`).split('/')) {
    if (seg === '..') out.pop()
    else if (seg && seg !== '.') out.push(seg)
  }
  return `/${out.join('/')}`
}

const PATH_FLAG = /^(?:--prefix|--dir|--cwd|-C)$/
// The package flags that take a name, per manager: cargo's `--workspace` and pnpm's `-w` (the root) take none; `-w` is watch mode to vitest.
const PKG_FLAG: Record<string, RegExp> = { npm: /^(?:-w|--workspace)$/, pnpm: /^(?:--filter|-F)$/, bun: /^--filter$/, cargo: /^(?:-p|--package)$/ }
// A folder known only at run time: `~`, `$VAR`, a command substitution.
export const UNKNOWN_DIR = '?'
const FOCUS_FLAG = /^(?:-t|--testNamePattern|--test-name-pattern|--grep|-g|-k|-run|--only|--exact)$/

export type TestScope = { dir: string; pkg?: string; isFocused: boolean }

// Where the test part of `command` runs from `shellDir`: a `cd`, `--prefix`, workspace, path argument or name filter narrows it.
// `from` is where to look for `part`, so a repeated `npm test` takes the `cd` before its own place.
export function testScope(command: string, part: string, shellDir: string, from = 0): TestScope {
  // shortcut: whitespace tokens and plain paths only, a runner's own config (`projects`, `testMatch`) is not read; upgrade when a project's runs are misplaced.
  let dir = shellDir
  const go = (to: string) => (dir = dir === UNKNOWN_DIR || /^~|[$`]/.test(to) ? UNKNOWN_DIR : joinPath(dir, to))
  const at = Math.max(0, command.indexOf(part, from))
  for (const m of command.slice(0, at).matchAll(/(?:^|&&|;|\n|\()\s*(?:cd|pushd)\s+([^\s;&|)]+)/g)) go(m[1]!.replace(/^['"]|['"]$/g, ''))
  const words = part.split(/\s+/).map(w => w.replace(/^['"]|['"]$/g, ''))
  const pkgFlag = PKG_FLAG[words[0] ?? '']
  let pkg: string | undefined
  let path: string | undefined
  let isFocused = false
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!
    const eq = word.startsWith('-') ? word.indexOf('=') : -1
    const flag = eq > 0 ? word.slice(0, eq) : word
    const value = () => (eq > 0 ? word.slice(eq + 1) : (words[++i] ?? ''))
    if (PATH_FLAG.test(flag)) go(value())
    // `@acme/web` and `./packages/web` both name the package `web`.
    else if (pkgFlag?.test(flag) || (words[0] === 'yarn' && flag === 'workspace' && i === 1)) pkg = value().replace(/\/+$/, '').replace(/^.*\//, '')
    else if (FOCUS_FLAG.test(flag)) {
      value()
      isFocused = true
    } else if (!flag.startsWith('-') && path === undefined && /\/|^\.|\.\w+$|::/.test(flag)) path = word
  }
  if (path) {
    const isFile = /\.\w+(?:::.*)?$/.test(path) && !/\.\.\.$/.test(path)
    const clean = path.replace(/::.*$/, '').replace(/\/?\.\.\.$/, '')
    go(isFile ? clean.replace(/\/?[^/]*$/, '') || '.' : clean || '.')
    if (isFile) isFocused = true
  }
  return pkg === undefined ? { dir, isFocused } : { dir, pkg, isFocused }
}

const COUNT_FIRST = /(\d+)\s+(?:tests?\s+)?(passed|passing|pass|failed|failing|fail|skipped|pending|ignored|todo)\b/gi
// node's runner: `# pass 3`, `ℹ skipped 1`.
const WORD_FIRST = /^\s*(?:#|ℹ)\s*(pass|fail|skipped|todo)\s+(\d+)\s*$/i
// cargo prints a line per test binary, doc tests last; a workspace's lines can run past any tail.
const CARGO_RESULT = /^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/gm
const NO_TESTS = /No test files found|No tests found|no tests? (?:ran|to run)|\[no test files\]|collected 0 items|Ran 0 tests|^\s*0 passing\b/i

// How many tests a run executed and skipped, from the runner's summary (jest, vitest, node, bun, mocha, pytest, cargo, go).
// undefined when the output holds no summary; `ran: 0` when the runner says it found nothing to run, whatever its exit.
export function testCounts(output: string): { ran: number; skipped: number } | undefined {
  let ran = 0
  let skipped = 0
  let isSeen = false
  let isNone = false
  let isGoRun = false
  for (const m of output.matchAll(CARGO_RESULT)) {
    isSeen = true
    ran += Number(m[1]) + Number(m[2])
    skipped += Number(m[3])
  }
  for (const line of output.slice(-20_000).split('\n').slice(-40)) {
    // Suites and files are not tests: jest's `Test Suites: 2 passed`, vitest's `Test Files  1 passed`.
    if (/^\s*Test (?:Suites|Files)\b|^test result:/.test(line)) continue
    if (NO_TESTS.test(line)) isNone = true
    else if (/^ok\s+\S+\s/.test(line)) isGoRun = true
    const tally = (word: string, n: number) => {
      isSeen = true
      if (/^(?:skipped|pending|ignored|todo)$/i.test(word)) skipped += n
      else ran += n
    }
    const w = line.match(WORD_FIRST)
    if (w) tally(w[1]!, Number(w[2]))
    else for (const m of line.matchAll(COUNT_FIRST)) tally(m[2]!, Number(m[1]))
  }
  // `go test` prints no counts: a package that ran says `ok`.
  if (isSeen) return { ran, skipped }
  return isNone && !isGoRun ? { ran: 0, skipped: 0 } : undefined
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

// The calm layout's spinner: a dot that grows and shrinks in place, no rotation for the eye to follow.
const BREATH = '·∙•●•∙'
export function breath(now: number): string {
  return BREATH[Math.floor(now / 500) % BREATH.length] ?? '•'
}

// A limit's short name for a narrow label: five_hour -> 5h.
export const limitName = (kind: string) => kind.replace('five_hour', '5h').replace('seven_day', '7d').replace(/_/g, ' ')

// The one place the gauges turn the alarm colour.
export const isHigh = (p: number) => p >= 80

// Whether release `a` is newer than `b`, both `major.minor.patch`; anything else is never newer.
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : undefined)
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return false
  const i = x.findIndex((n, k) => n !== y[k])
  return i >= 0 && x[i]! > y[i]!
}
