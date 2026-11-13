import type { Actor } from '../types'
import { EDIT_TOOLS } from './bench'
import { mask, shortPath } from './format'
import type { Strings } from './i18n'

export const LABEL_TEXT = 80

const WRAPPERS = /^(sudo|env|time|nohup|command|exec)$/
const HAS_SUBCOMMAND = /^(git|npm|pnpm|yarn|bun|cargo|go|docker|gh|kubectl)$/
const FILE_TOOLS = /^(Read|Write|Edit|MultiEdit|NotebookEdit|NotebookRead)$/

// Who acts in a call, by the tool's name alone: the person, the shell, the files, another agent.
export function actorOf(tool: string): Actor {
  if (/^(AskUserQuestion|SendUserFile)$|^mcp__(ccd_|visualize)/.test(tool)) return 'you'
  if (/playwright|browser|chrome|computer/i.test(tool)) return 'browser'
  if (/^mcp__terminal/.test(tool)) return 'shell'
  if (/^mcp__plugin-authoring/.test(tool)) return 'skills'
  if (tool.startsWith('mcp__')) return 'mcp'
  if (/^(Bash|PowerShell|Monitor|TaskStop)$/.test(tool)) return 'shell'
  if (/^(Read|NotebookRead|Grep|Glob|LSP)$/.test(tool) || EDIT_TOOLS.has(tool)) return 'files'
  if (/^Web(Fetch|Search)$/.test(tool)) return 'web'
  if (/^(Agent|SendMessage|Workflow|ListAgents)$/.test(tool)) return 'agents'
  return tool === 'Skill' ? 'skills' : 'model'
}

// Control and bidi characters to spaces, so a label cannot reorder or break the row it sits in.
export function clean(s: string, max = LABEL_TEXT): string {
  const flat = s.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// `https://user:pw@host/path?q` -> `host`
const hostOf = (url: string) => url.replace(/^[a-z][\w+.-]*:\/\//i, '').replace(/^[^/@]*@/, '').split(/[/?#]/)[0]!.slice(0, 40)

// The program a shell line runs first: `cd x && sudo env A=1 npm test -- a` -> `npm test`.
function commandName(command: string): string | undefined {
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const words = (part.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^["']|["']$/g, ''))
    // PowerShell: `$r = & "C:\Tools\x.exe"`.
    if (words[0]?.startsWith('$') && words[1] === '=') words.splice(0, 2)
    for (;;) {
      const w = words[0] ?? ''
      if (w === 'npx') words.splice(0, /^(-p|--package)$/.test(words[1] ?? '') ? 3 : 1)
      else if (w === 'timeout') words.splice(0, 2)
      else if (WRAPPERS.test(w) || /^[A-Za-z_]\w*=/.test(w) || /^(-.*|&|\.)$/.test(w)) words.shift()
      else break
    }
    const name = words[0]?.replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|cmd|bat)$/i, '')
    if (!name || /^(cd|pushd)$/.test(name)) continue
    // `git -C /repo push`: the folder after `-C` is no subcommand.
    const sub = HAS_SUBCOMMAND.test(name) ? words.slice(1).find((w, i, all) => /^[a-z][\w:-]*$/.test(w) && !/^-[Cc]$/.test(all[i - 1] ?? '')) : undefined
    return sub ? `${name} ${sub}` : name
  }
  return undefined
}

// A short name for a call, shown before its raw text. It names the call and never carries its content: a pattern or a query stays out.
export function labelOf(tool: string, call: object, t: Pick<Strings, 'label'>): string {
  const a = call as Record<string, unknown>
  const text = (k: string) => (typeof a[k] === 'string' && a[k].trim() ? a[k].trim() : undefined)
  const [, server, ...rest] = tool.split('__')
  const raw =
    /^(Bash|PowerShell)$/.test(tool) ? text('description') ?? commandName(text('command') ?? '') ?? 'shell'
    : FILE_TOOLS.test(tool) ? shortPath((text('file_path') ?? text('notebook_path') ?? tool).replace(/\\/g, '/'))
    : tool === 'WebFetch' ? hostOf(text('url') ?? '') || tool
    : tool === 'WebSearch' ? t.label.webSearch
    : tool === 'Agent' ? text('description') ?? t.label.subagent
    : tool === 'SendMessage' ? `${t.label.message} → ${text('to') ?? ''}`
    : /^(Workflow|ListAgents|TaskStop|Monitor)$/.test(tool) ? text('description') ?? tool
    : tool === 'Skill' ? text('skill') ?? tool
    : tool === 'ToolSearch' ? t.label.loadingTools
    : tool === 'AskUserQuestion' ? t.label.question
    : tool === 'SendUserFile' ? t.label.fileForYou
    : tool.startsWith('mcp__') && server ? (/playwright|browser|chrome/i.test(server) && hostOf(text('url') ?? '')) || rest.join(' ').replace(/_+/g, ' ') || server
    : tool
  return clean(mask(raw))
}
