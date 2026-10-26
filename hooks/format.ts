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
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0')).join(':')
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
