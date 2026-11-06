import type { Tone } from './format.ts'

// As `REREADS` in hooks/insights.ts, which flags the same files in Focus.
const REREAD_OFTEN = 3

export type FileRow = { path: string; at?: number; edits?: number; isNew: boolean }
export type ReadRow = { path: string; reads?: number; isOften: boolean }
export type FileGroups = {
  // What the first group's heading says: edited since a passing test, the last test failed, or no passing test is known.
  state: 'green' | 'failed' | 'none'
  tone: Tone
  toCheck: FileRow[]
  beforeGreen: FileRow[]
  greenAt?: number
  readOnly: ReadRow[]
}

type Input = {
  files: { read: readonly string[]; edited: readonly string[]; editedTimes?: Record<string, number> }
  checks: readonly { kind: string; at: number; result: string }[]
  insights: { reads?: Record<string, number>; edits?: Record<string, number>; sizes?: Record<string, { first?: number; now: number }> }
}

const latestFirst = (a: FileRow, b: FileRow) => (b.at ?? 0) - (a.at ?? 0)

export function fileGroups({ files, checks, insights }: Input): FileGroups {
  const test = checks.find(c => c.kind === 'test')
  const greenAt = test?.result === 'ok' ? test.at : undefined
  const rows = files.edited.map((path): FileRow => {
    const at = files.editedTimes?.[path]
    const edits = insights.edits?.[path]
    const size = insights.sizes?.[path]
    return { path, ...(at === undefined ? {} : { at }), ...(edits === undefined ? {} : { edits }), isNew: size !== undefined && size.first === undefined }
  })
  // A path with no time comes from an older session: it cannot be shown to come before the test.
  const isBefore = (r: FileRow) => greenAt !== undefined && r.at !== undefined && r.at <= greenAt
  const edited = new Set(files.edited)
  const readOnly = [...files.read].reverse().filter(path => !edited.has(path)).map((path): ReadRow => {
    const reads = insights.reads?.[path]
    return { path, ...(reads === undefined ? {} : { reads }), isOften: (reads ?? 0) >= REREAD_OFTEN }
  }).sort((a, b) => (b.reads ?? 0) - (a.reads ?? 0))
  const state = greenAt !== undefined ? 'green' : test?.result === 'failed' ? 'failed' : 'none'
  return {
    state,
    tone: state === 'none' ? 'warn' : 'bad',
    toCheck: rows.filter(r => !isBefore(r)).sort(latestFirst),
    beforeGreen: rows.filter(isBefore).sort(latestFirst),
    ...(greenAt === undefined ? {} : { greenAt }),
    readOnly,
  }
}
