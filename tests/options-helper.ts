import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

// What `$.fs.read` answers for the settings.json holding these options, for a test with its own `fs.read` hook.
export const settingsWith = (options: Record<string, unknown>) => JSON.stringify({ pluginConfigs: { 'agentmon-live@agentmon-live': { options } } })

// The mod reads its options from settings.json at session start. The kit allows one hook per name.
export function withOptions(on: On, options: Record<string, unknown>) {
  on('env.get', () => ({ value: undefined }))
  on('fs.read', (_, e, next) => (e.path.endsWith('/settings.json') ? { value: settingsWith(options) } : next(e)))
}
