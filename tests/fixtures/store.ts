import type { TestBody } from 'claude-code/testing'

import type { BenchRow, Learned, SessionRecord } from '../../types'
import { shapeLearned } from '../../hooks/learn'

type On = Parameters<TestBody>[1]

// A project as the store keeps it: one key per session and per bench row, the memory findings in the project entry.
export function viewOf(store: Map<string, unknown>, cwd = '/p'): Learned {
  const kind = (k: string) => [...store].filter(([key]) => key.startsWith(`${k}:${cwd}:`)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v)
  return { current: '', mem: shapeLearned(store.get(`proj:${cwd}`)).mem, sessions: kind('sess') as SessionRecord[], bench: kind('row') as BenchRow[] }
}

// The store's keys and deletes, for an engine mock that keeps the store in a Map.
export function storeCalls(on: On, store: Map<string, unknown>) {
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
}
