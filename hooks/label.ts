import type { Actor } from '../types'
import { EDIT_TOOLS } from './bench'
import { gitCommand, mask, shortPath } from './format'
import type { Category, Strings } from './i18n'

export const LABEL_TEXT = 80

const WRAPPERS = /^(sudo|env|time|nohup|command|exec|timeout|npx)$/
const KEYWORDS = /^(if|then|else|elif|fi|for|while|until|do|done|case|esac|function|select|\[\[?)$/
const HAS_SUBCOMMAND = /^(git|npm|pnpm|yarn|bun|cargo|go|docker|gh|kubectl)$/
const FILE_TOOLS = /^(Read|Write|Edit|MultiEdit|NotebookEdit|NotebookRead)$/

// Which kind of work a call is, for the tool counts and the turn clock.
export function category(tool: string, call: object): Category {
  if (tool === 'Bash' && gitCommand(String((call as { command?: unknown }).command ?? ''))) return 'git'
  if (/^(Read|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Grep|Glob|LSP|ToolSearch)$/.test(tool)) return 'search'
  if (/^Web(Fetch|Search)$|fetch_and_index/.test(tool)) return 'web'
  if (/^(Bash|PowerShell|Monitor|TaskStop)$/.test(tool)) return 'shell'
  if (EDIT_TOOLS.has(tool)) return 'edit'
  if (/^(Agent|SendMessage|Workflow|ListAgents)$/.test(tool)) return 'agents'
  if (/^Skill$/.test(tool)) return 'skills'
  if (/playwright|browser|chrome/i.test(tool)) return 'browser'
  if (/computer/i.test(tool)) return 'computer'
  if (/^mcp__/.test(tool)) return 'mcp'
  return 'other'
}

const ACTOR_OF: Record<Category, Actor> = { git: 'shell', shell: 'shell', read: 'files', search: 'files', edit: 'files', web: 'web', agents: 'agents', skills: 'skills', browser: 'browser', computer: 'browser', mcp: 'mcp', other: 'model' }

// Who acts in a call, by the tool's name alone: the person, the shell, the files, another agent.
export function actorOf(tool: string): Actor {
  if (/^(AskUserQuestion|SendUserFile)$|^mcp__(ccd_|visualize)/.test(tool)) return 'you'
  if (/^mcp__terminal/.test(tool)) return 'shell'
  if (/^mcp__plugin-authoring/.test(tool)) return 'skills'
  // Loading tool definitions is the model's own doing, not work on files.
  return tool === 'ToolSearch' ? 'model' : ACTOR_OF[category(tool, {})]
}

// Control and bidi characters to spaces, so a label cannot reorder or break the row it sits in.
export function clean(s: string, max = LABEL_TEXT): string {
  const flat = s.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// `https://user:pw@host/path?q=a@b` -> `host`: cut at the path first, so an `@` further on is not taken for the user part.
const hostOf = (url: string) => url.replace(/^[a-z][\w+.-]*:\/\//i, '').split(/[/?#]/)[0]!.replace(/^.*@/, '').slice(0, 40)

// The program a shell line runs first: `cd x && sudo env A=1 npm test -- a` -> `npm test`.
// It never reads past an option, whose value it cannot tell from a program: `sudo -u deploy x`, `timeout -s KILL 5 x` and a line
// that opens with a shell keyword have no name, and `git -C repo push` is `git`. The row then shows the raw command.
function commandName(command: string): string | undefined {
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    // The split knows no quoting: a part that opens with a redirect, or holds half a quote or a substitution, is not a command to name.
    if (/^\s*[<>]|\$\(|`/.test(part) || [/"/g, /'/g].some(q => (part.match(q)?.length ?? 0) % 2)) return undefined
    // `(cd web && npm test)`, `{ npm test; }`, `! grep x`: the bracket or bang is not part of the program's name. `A="b c"` is one word.
    const words = part.replace(/^[\s({!]+/, '').match(/(?:[A-Za-z_]\w*=)?(?:"[^"]*"|'[^']*')\S*|\S+/g) ?? []
    // PowerShell: `$r = & "C:\Tools\x.exe"`.
    if (words[0]?.startsWith('$') && words[1] === '=') words.splice(0, 2)
    if (/^[&.]$/.test(words[0] ?? '')) words.shift()
    while (/^[A-Za-z_]\w*=/.test(words[0] ?? '') || WRAPPERS.test(words[0] ?? '')) {
      const wrapper = words.shift()
      if (wrapper === 'npx' && /^(-y|--yes)$/.test(words[0] ?? '')) words.shift()
      if (wrapper === 'timeout' && /^\d/.test(words[0] ?? '')) words.shift()
    }
    const name = (words[0] ?? '').replace(/^["']|["']$/g, '').replace(/\\/g, '/').split('/').pop()!.replace(/\.(exe|cmd|bat)$/i, '')
    // A comment line or a change of folder says nothing: the next part does.
    if (!name || name.startsWith('#') || /^(cd|pushd)$/.test(name)) continue
    if (name.startsWith('-') || KEYWORDS.test(name)) return undefined
    return HAS_SUBCOMMAND.test(name) && /^[a-z][\w:-]*$/.test(words[1] ?? '') ? `${name} ${words[1]}` : name
  }
  return undefined
}

// A short name for a call, shown before its raw text; empty when it has none. It names the call and never carries its content: a pattern or a query stays out.
export function labelOf(tool: string, call: object, t: Pick<Strings, 'label'>): string {
  const a = call as Record<string, unknown>
  const text = (k: string) => (typeof a[k] === 'string' && a[k].trim() ? a[k].trim() : undefined)
  const [, server, ...rest] = tool.split('__')
  const raw =
    /^(Bash|PowerShell)$/.test(tool) ? text('description') ?? commandName(text('command') ?? '') ?? ''
    : FILE_TOOLS.test(tool) ? shortPath((text('file_path') ?? text('notebook_path') ?? tool).replace(/\\/g, '/'))
    : tool === 'WebFetch' ? hostOf(text('url') ?? '') || tool
    : tool === 'WebSearch' ? t.label.webSearch
    : tool === 'Agent' ? text('description') ?? t.label.subagent
    : tool === 'SendMessage' ? [t.label.message, text('to')].filter(Boolean).join(' → ')
    : /^(Workflow|ListAgents|TaskStop|Monitor)$/.test(tool) ? text('description') ?? tool
    : tool === 'Skill' ? text('skill') ?? tool
    : tool === 'ToolSearch' ? t.label.loadingTools
    : tool === 'AskUserQuestion' ? t.label.question
    : tool === 'SendUserFile' ? t.label.fileForYou
    : tool.startsWith('mcp__') && server ? (/playwright|browser|chrome/i.test(server) && hostOf(text('url') ?? '')) || rest.join(' ').replace(/_+/g, ' ') || server
    : tool
  return clean(mask(raw))
}
