import { expect, test } from 'claude-code/testing'

import { LANGUAGES } from '../hooks/i18n'
import { actorOf, clean, labelOf } from '../hooks/label'

const t = LANGUAGES.en!
const of = (tool: string, call: object = {}) => labelOf(tool, call, t)

test('a shell call is named by its description, else by the program it runs first', async () => {
  expect(of('Bash', { command: 'ls -la /opt/x', description: ' List the install folder ' })).toBe('List the install folder')
  expect(of('Bash', { command: 'cd x && npm test -- a' })).toBe('npm test')
  expect(of('Bash', { command: '(cd web && npm run build)' })).toBe('npm run')
  expect(of('Bash', { command: '! grep -q x f' })).toBe('grep')
  expect(of('Bash', { command: '# run the suite\nnpm test' })).toBe('npm test')
  expect(of('Bash', { command: 'sudo env A=1 curl -s https://x.dev' })).toBe('curl')
  expect(of('Bash', { command: 'FOO="a b" timeout 60 /usr/local/bin/git push origin' })).toBe('git push')
  expect(of('Bash', { command: 'npx -y tsc --noEmit' })).toBe('tsc')
  expect(of('Bash', { command: "python3 - <<'EOF'\nprint(1)\nEOF" })).toBe('python3')
  expect(of('PowerShell', { command: '$r = & "C:\\Program Files\\Tools\\x.exe" -v' })).toBe('x')
  expect(of('PowerShell', { command: 'Get-PhysicalDisk | Select-Object DeviceId' })).toBe('Get-PhysicalDisk')
})

test('a shell line is never named past an option: its value could be taken for the program', async () => {
  // The program is known, the subcommand is not.
  for (const [command, name] of [['git -C repo push origin', 'git'], ['npm --prefix web test', 'npm'], ['kubectl -n prod get pods', 'kubectl'], ['git -c user.name=x commit', 'git']] as const) expect(of('Bash', { command })).toBe(name)
  // Nothing is known: the row shows the raw command.
  for (const command of ['sudo -u deploy systemctl restart x', 'env -u VAR make', 'timeout -s KILL 5 npm test', 'timeout -k 5 30 npm test', 'npx -p typescript tsc --noEmit', 'for f in *.ts; do npm test; done', 'if [ -f x ]; then make; fi', '[ -f x ] && make', ' ']) expect(of('Bash', { command })).toBe('')
})

test('other calls get a name and never their content', async () => {
  expect(of('Read', { file_path: '/home/me/repo/hooks/state.ts' })).toBe('hooks/state.ts')
  expect(of('Edit', { file_path: 'C:\\a\\b\\c.ts' })).toBe('b/c.ts')
  expect(of('Grep', { pattern: 'password=hunter2' })).toBe('Grep')
  expect(of('WebFetch', { url: 'https://user:pw@docs.example.com/a/b?q=1#x' })).toBe('docs.example.com')
  expect(of('WebFetch', { url: 'https://example.com?x=a@b.com' })).toBe('example.com')
  expect(of('WebFetch', { url: 'https://example.com/x#u@evil' })).toBe('example.com')
  expect(of('WebSearch', { query: 'my secret plan' })).toBe(t.label.webSearch)
  expect(of('Agent', { description: 'Read the mod', prompt: 'long' })).toBe('Read the mod')
  expect(of('Agent')).toBe(t.label.subagent)
  expect(of('SendMessage', { to: 'tester', message: 'hi' })).toBe(`${t.label.message} → tester`)
  expect(of('SendMessage', { message: 'hi' })).toBe(t.label.message)
  expect(of('Skill', { skill: 'run' })).toBe('run')
  expect(of('ToolSearch', { query: 'x' })).toBe(t.label.loadingTools)
  expect(of('AskUserQuestion')).toBe(t.label.question)
  expect(of('mcp__codegraph__codegraph_search', { query: 'x' })).toBe('codegraph search')
  expect(of('mcp__playwright__browser_navigate', { url: 'https://app.example.com/login' })).toBe('app.example.com')
  expect(of('TodoWrite', { todos: [] })).toBe('TodoWrite')
})

test('a label is masked, cleaned of control and bidi characters, and capped', async () => {
  // A fake value, joined here so the source holds nothing a secret scanner takes for a key.
  const fake = ['sk-live-', '9f8e7d6c', '5b4a3f2e', '1d0c9b8a'].join('')
  expect(of('Bash', { command: 'x', description: `Deploy with token=${fake}` })).not.toContain('5b4a3f2e')
  expect(clean('a\u202eb\tc\n\u0007d')).toBe('a b c d')
  // Nothing left to show is no label, not an empty one.
  expect(of('Bash', { command: 'ls', description: '\u0007\u202e' })).toBe('')
  const long = of('Bash', { command: 'x', description: 'd'.repeat(300) })
  expect(long.length).toBe(80)
  expect(long.endsWith('…')).toBe(true)
})

test('who acts in a call follows from the tool alone', async () => {
  const actors = ['AskUserQuestion', 'mcp__ccd_session__mark_chapter', 'Bash', 'PowerShell', 'Edit', 'Grep', 'WebSearch', 'Agent', 'Skill', 'mcp__playwright__browser_click', 'mcp__sentry__search_issues', 'TodoWrite', 'ToolSearch', 'Monitor', 'mcp__terminal__run'].map(actorOf)
  expect(actors).toEqual(['you', 'you', 'shell', 'shell', 'files', 'files', 'web', 'agents', 'skills', 'browser', 'mcp', 'model', 'model', 'shell', 'shell'])
})
