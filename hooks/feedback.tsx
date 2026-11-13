import type { EngineInterface } from 'claude-code'

import type { FeedbackDraft as Draft } from '../types'
import { mask } from './format'
import { isQuiet } from './release'
import { cfg } from './state'

export const FEEDBACK_URL = 'https://agentmon-live-feedback.dolbik.workers.dev/feedback'
export const FEEDBACK_TOOL = 'mcp__agentmon-live__feedback'
const ISSUES = 'https://github.com/codenotary/agentmon-live/issues/new'
const KINDS = ['problem', 'idea', 'thanks', 'other']
export const MAX_TEXT = 2000
// What a browser's address bar and GitHub both take, with room for the title and the footer.
const MAX_ISSUE_BODY = 5000


export async function loadFeedback($: EngineInterface): Promise<void> {
  cfg.feedbackUrl = (await isQuiet($).catch(() => false)) ? '' : (await $.env.get('AGENTMON_FEEDBACK_URL').catch(() => undefined)) || FEEDBACK_URL
  cfg.claudeCode = await $.session.version().then(v => v.version, () => '')
}

export async function registerFeedback($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: 'feedback',
    description:
      'Hands a feedback draft for the makers of AgentMon Live to the AgentMon Live pane, where the person reads it and sends or cancels it. Sends nothing by itself. Use only when the person asks for feedback to AgentMon Live.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: KINDS },
        text: { type: 'string', description: `The feedback, at most ${MAX_TEXT} characters. No code, file paths, prompt text, names or secrets.` },
        details: { type: 'string', description: `Optional, at most ${MAX_TEXT} characters.` },
      },
      required: ['type', 'text'],
    },
  })
}

// The tool's answer goes to the model, so it says who sends: the person, in the pane.
export function holdDraft($: EngineInterface, input: { readonly type?: unknown; readonly text?: unknown; readonly details?: unknown }): string {
  const text = mask(String(input.text ?? '')).trim()
  const details = mask(String(input.details ?? '')).trim()
  if (!KINDS.includes(String(input.type))) return `Not taken: type must be one of ${KINDS.join(', ')}.`
  if (!text) return 'Not taken: text is required.'
  if ([...text].length > MAX_TEXT || [...details].length > MAX_TEXT) return `Not taken: text and details take at most ${MAX_TEXT} characters each.`
  if (cfg.feedbackDraft) return 'Not taken: a draft is already in the AgentMon Live pane. The person sends or cancels that one first.'
  cfg.feedbackDraft = { type: String(input.type), text, details }
  $.ui.invalidate('ui.render')
  return 'The draft is in the AgentMon Live pane. The person sends or cancels it there; do not send it any other way.'
}

export function dropDraft($: EngineInterface): void {
  cfg.feedbackDraft = undefined
  $.ui.invalidate('ui.render')
}

let isSending = false

export async function sendDraft($: EngineInterface): Promise<void> {
  const draft = cfg.feedbackDraft
  if (!draft || !cfg.feedbackUrl || isSending) return
  isSending = true
  const body = { ...draft, app: 'agentmon-live', version: cfg.version, claude_code: cfg.claudeCode, language: cfg.lang }
  const failure = await $.http
    .fetch(cfg.feedbackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => (r.ok ? '' : `${r.status} ${r.text.trim().slice(0, 200)}`), e => String((e as { message?: unknown })?.message ?? e))
  isSending = false
  // A draft that did not go stays, so the person can try again or open it as an issue.
  if (failure) return void $.ui.toast(cfg.t.feedbackFailed(failure))
  if (cfg.feedbackDraft === draft) dropDraft($)
  $.ui.toast(cfg.t.feedbackSent)
}

const encoded = (s: string) => new URLSearchParams({ s }).toString().length

// shortcut: a long text is cut to fit the address, the footer never; post through the API if whole texts must go.
export function issueLink(draft: Draft): string {
  let said = [...[draft.text, draft.details].filter(Boolean).join('\n\n')]
  while (encoded(said.join('')) > MAX_ISSUE_BODY) said = said.slice(0, Math.floor(said.length * 0.9))
  const body = `${said.join('')}\n\nAgentMon Live ${cfg.version} · Claude Code ${cfg.claudeCode}`
  const title = [...draft.text.split('\n')[0]!].slice(0, 80).join('')
  return `${ISSUES}?${new URLSearchParams({ title, body, labels: draft.type === 'idea' ? 'enhancement' : 'bug' })}`
}
