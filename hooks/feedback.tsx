import type { EngineInterface } from 'claude-code'

import { mask } from './format'
import { cfg } from './state'

export const FEEDBACK_URL = 'https://agentmon-live-feedback.dolbik.workers.dev/feedback'
export const FEEDBACK_TOOL = 'mcp__agentmon-live__feedback'
const ISSUES = 'https://github.com/codenotary/agentmon-live/issues/new'
const KINDS = ['problem', 'idea', 'thanks', 'other']
const MAX_TEXT = 2000

export type Draft = { type: string; text: string; details: string }

export async function loadFeedback($: EngineInterface): Promise<void> {
  const isQuiet = await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC').catch(() => undefined)
  cfg.feedbackUrl = isQuiet ? '' : (await $.env.get('AGENTMON_FEEDBACK_URL').catch(() => undefined)) || FEEDBACK_URL
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
export function holdDraft($: EngineInterface, input: { readonly [key: string]: unknown }): string {
  const text = mask(String(input.text ?? '')).trim()
  const details = mask(String(input.details ?? '')).trim()
  if (!KINDS.includes(String(input.type))) return `Not taken: type must be one of ${KINDS.join(', ')}.`
  if (!text) return 'Not taken: text is required.'
  if ([...text].length > MAX_TEXT || [...details].length > MAX_TEXT) return `Not taken: text and details take at most ${MAX_TEXT} characters each.`
  cfg.feedbackDraft = { type: String(input.type), text, details }
  $.ui.invalidate('ui.render')
  return 'The draft is in the AgentMon Live pane. The person sends or cancels it there; do not send it any other way.'
}

export function dropDraft($: EngineInterface): void {
  cfg.feedbackDraft = undefined
  $.ui.invalidate('ui.render')
}

export async function sendDraft($: EngineInterface): Promise<void> {
  const draft = cfg.feedbackDraft
  if (!draft || !cfg.feedbackUrl) return
  const body = { ...draft, app: 'agentmon-live', version: cfg.version, claude_code: cfg.claudeCode, language: cfg.lang }
  const failure = await $.http
    .fetch(cfg.feedbackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => (r.ok ? '' : `${r.status} ${r.text.trim().slice(0, 200)}`), e => String((e as { message?: unknown })?.message ?? e))
  // A draft that did not go stays, so the person can try again or open it as an issue.
  if (failure) return void $.ui.toast(cfg.t.feedbackFailed(failure))
  dropDraft($)
  $.ui.toast(cfg.t.feedbackSent)
}

// shortcut: the body is cut so the address stays under what browsers and GitHub take; post through the API if whole texts must go.
export function issueLink(draft: Draft): string {
  const body = [draft.text, draft.details, `AgentMon Live ${cfg.version} · Claude Code ${cfg.claudeCode}`].filter(Boolean).join('\n\n').slice(0, 3000)
  const title = draft.text.split('\n')[0]!.slice(0, 80)
  return `${ISSUES}?${new URLSearchParams({ title, body, labels: draft.type === 'idea' ? 'enhancement' : 'bug' })}`
}
