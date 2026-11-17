// Numbers Claude Code's own OTel export lacks, as OTLP/HTTP JSON. No text from a session leaves: no prompt, command, path or tool input.

const NS = 1_000_000n
const ns = ms => String(BigInt(Math.round(ms)) * NS)
const attrs = obj => Object.entries(obj).filter(([, v]) => v !== undefined).map(([key, v]) => ({ key, value: typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) } }))
// Every label is a short name: a sandbox writes its own snapshot, so anything else goes out as `other`.
const KIND = /^[a-z][a-z0-9_-]{0,30}$/
const MODEL = /^[a-zA-Z0-9][\w.:-]{0,59}$/
const ID = /^[\w-]{1,80}$/
const label = (v, re = KIND) => (re.test(String(v)) ? String(v) : 'other')
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [])
// Counters keyed by their labels, so no key is split apart again to read them.
const bump = (counts, labels, n = 1) => {
  const key = JSON.stringify(labels)
  counts[key] = (counts[key] ?? 0) + n
}
const points = counts => Object.entries(counts).map(([key, n]) => [n, JSON.parse(key)])
const tally = (items, labelsOf) => {
  const counts = {}
  for (const x of items) bump(counts, labelsOf(x))
  return points(counts)
}
// A session gone this long starts its counters again when it returns.
const KEEP_SEEN_MS = 60 * 60_000

function headerValue(v) {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

export function otlpTarget(env) {
  if (env.AGENTMON_OTLP !== '1') return undefined
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, '')
  const url = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || (base && `${base}/v1/metrics`)
  if (!url) return undefined
  const headers = Object.fromEntries(
    (env.OTEL_EXPORTER_OTLP_HEADERS ?? '').split(',').map(pair => pair.split('=')).filter(([k, ...v]) => k.trim() && v.length).map(([k, ...v]) => [k.trim(), headerValue(v.join('=').trim())]),
  )
  return { url, headers }
}

// Counters are cumulative from when this server first saw the session; `seen` holds what was already counted.
function count(seen, s, now) {
  const turns = list(s.turns).filter(t => !t.isLive && t.startedAt > seen.turnAt)
  for (const t of turns) {
    seen.turns += 1
    for (const [bucket, ms] of Object.entries(t.buckets ?? {})) if (KIND.test(bucket) && Number.isFinite(ms)) bump(seen.turnMs, { bucket }, ms)
    seen.turnAt = Math.max(seen.turnAt, t.startedAt)
  }
  if (s.gate && s.gate.at > seen.gateAt) {
    bump(seen.gates, { result: s.gate.ok ? 'pass' : 'block', sent: Boolean(s.gate.isSent) })
    seen.gateAt = s.gate.at
  }
  const done = list(s.trace).filter(c => c.ms !== undefined)
  for (const c of done) {
    if (seen.traceIds.has(c.id)) continue
    const who = c.agentId ? 'agent' : 'main'
    if (c.isFailed) bump(seen.failed, { who })
    if (c.isDenied) bump(seen.denied, { who })
  }
  // The trace only drops old calls: its own finished ids are all a later read needs.
  seen.traceIds = new Set(done.map(c => c.id))
  seen.at = now
}

const zero = () => ({ turns: 0, turnMs: {}, gates: {}, failed: {}, denied: {} })

// The first read only marks what is already there as counted.
function firstSeen(s, now) {
  const seen = { start: now, turnAt: 0, gateAt: 0, traceIds: new Set(), ...zero() }
  count(seen, s, now)
  return Object.assign(seen, zero())
}

function toResource(id, s, harness, seen, now) {
  if (!seen.has(id)) seen.set(id, firstSeen(s, now))
  const c = seen.get(id)
  count(c, s, now)
  const t = ns(now)
  const start = ns(c.start)
  const gauge = (name, unit, pts) => ({ name, unit, gauge: { dataPoints: pts.map(([value, a = {}]) => ({ attributes: attrs(a), timeUnixNano: t, asDouble: value })) } })
  const sum = (name, unit, pts) => ({ name, unit, sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: pts.map(([value, a = {}]) => ({ attributes: attrs(a), startTimeUnixNano: start, timeUnixNano: t, asDouble: value })) } })
  const editedAt = s.files?.editedAt ?? 0
  const checks = list(s.checks).filter(k => k.result !== 'running')
  const test = checks.find(k => k.kind === 'test')
  const metrics = [
    sum('agentmon.turns', '{turn}', [[c.turns]]),
    sum('agentmon.turn.time', 'ms', points(c.turnMs)),
    sum('agentmon.gate.verdicts', '{verdict}', points(c.gates)),
    sum('agentmon.calls.failed', '{call}', points(c.failed)),
    sum('agentmon.calls.denied', '{call}', points(c.denied)),
    gauge('agentmon.check.failed', '1', checks.map(k => [k.result === 'failed' ? 1 : 0, { kind: label(k.kind) }])),
    gauge('agentmon.check.stale', '1', checks.map(k => [editedAt > k.at ? 1 : 0, { kind: label(k.kind) }])),
    gauge('agentmon.tests.ran', '{test}', Number.isFinite(test?.ran) ? [[test.ran]] : []),
    gauge('agentmon.tests.skipped', '{test}', Number.isFinite(test?.skipped) ? [[test.skipped]] : []),
    gauge('agentmon.tests.weakened', '{file}', [[list(s.testReview?.files).length]]),
    gauge('agentmon.focus', '{item}', tally(list(s.focus), f => ({ kind: label(String(f.key).split(':')[0]), urgent: f.isUrgent === true }))),
    gauge('agentmon.agents', '{agent}', tally(list(s.agents), a => ({ status: label(a.status) }))),
    gauge('agentmon.context.pct', '%', Number.isFinite(s.usage?.ctxPct) ? [[s.usage.ctxPct]] : []),
    gauge('agentmon.context.mcp_tokens', '{token}', [[Number(s.insights?.mcpTokens) || 0]]),
    gauge('agentmon.context.memory_tokens', '{token}', [[Number(s.insights?.memoryTokens) || 0]]),
  ]
  // Claude Code exports its own cost and tokens; the other harnesses have no exporter.
  if (harness !== 'claude') {
    const tk = s.insights?.tokens ?? {}
    const n = v => Number(v) || 0
    metrics.push(
      // A curly unit, so Prometheus keeps the name `agentmon_usage_usd` the dashboard reads.
      gauge('agentmon.usage.usd', '{usd}', [[n(s.usage?.usd)]]),
      gauge('agentmon.usage.tokens', '{token}', [[n(tk.mainIn) + n(tk.agentsIn), { type: 'input' }], [n(tk.mainOut) + n(tk.agentsOut), { type: 'output' }]]),
      ...(Number.isFinite(s.usage?.credits) ? [gauge('agentmon.usage.credits', '{credit}', [[s.usage.credits]])] : []),
    )
  }
  return {
    resource: { attributes: attrs({ 'service.name': 'agentmon', 'service.instance.id': id, 'session.id': id, 'agentmon.harness': harness, 'agentmon.place': s.session?.place === 'sandbox' ? 'sandbox' : undefined, 'agentmon.model': s.main?.model ? label(s.main.model, MODEL) : undefined }) },
    scopeMetrics: [{ scope: { name: 'agentmon-live' }, metrics: metrics.filter(m => (m.gauge ?? m.sum).dataPoints.length) }],
  }
}

// `sessions`: [id, snapshot, harness] for each live session. `seen` keeps counter state per id. A malformed snapshot is skipped, never thrown.
export function toOtlp(sessions, seen, now) {
  const live = new Set(sessions.map(([id]) => id))
  for (const [id, c] of seen) if (!live.has(id) && now - c.at > KEEP_SEEN_MS) seen.delete(id)
  const resourceMetrics = []
  for (const [id, s, harness] of sessions) {
    if (!ID.test(id) || !s || typeof s !== 'object') continue
    try {
      resourceMetrics.push(toResource(id, s, harness, seen, now))
    } catch {
      seen.delete(id)
    }
  }
  return { resourceMetrics }
}

// Fails silent: an exporter that is down or slow never touches the server.
export async function postOtlp(target, body) {
  try {
    const res = await fetch(target.url, { method: 'POST', headers: { 'content-type': 'application/json', ...target.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    await res.arrayBuffer()
    return res.status
  } catch {
    return 0
  }
}
