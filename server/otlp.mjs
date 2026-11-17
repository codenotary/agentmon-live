// Numbers Claude Code's own OTel export lacks, as OTLP/HTTP JSON. No text from a session leaves: no prompt, command, path or tool input.

const NS = 1_000_000n
const ns = ms => String(BigInt(Math.round(ms)) * NS)
const attrs = obj => Object.entries(obj).filter(([, v]) => v !== undefined).map(([key, v]) => ({ key, value: typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) } }))
const KIND = /^[a-z][a-z0-9_-]{0,30}$/
const tally = (list, keyOf) => Object.entries(list.reduce((acc, x) => ({ ...acc, [keyOf(x)]: (acc[keyOf(x)] ?? 0) + 1 }), {}))
const kindOf = key => (KIND.test(String(key).split(':')[0]) ? String(key).split(':')[0] : 'other')

export function otlpTarget(env) {
  if (env.AGENTMON_OTLP !== '1') return undefined
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, '')
  const url = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || (base && `${base}/v1/metrics`)
  if (!url) return undefined
  const headers = Object.fromEntries(
    (env.OTEL_EXPORTER_OTLP_HEADERS ?? '').split(',').map(pair => pair.split('=')).filter(([k, ...v]) => k.trim() && v.length).map(([k, ...v]) => [k.trim(), decodeURIComponent(v.join('=').trim())]),
  )
  return { url, headers }
}

// Counters are cumulative from when this server first saw the session; `seen` holds what was already counted.
function count(seen, s, now) {
  const turns = (s.turns ?? []).filter(t => !t.isLive && t.startedAt > seen.turnAt)
  for (const t of turns) {
    seen.turns += 1
    for (const [bucket, ms] of Object.entries(t.buckets ?? {})) if (KIND.test(bucket)) seen.turnMs[bucket] = (seen.turnMs[bucket] ?? 0) + ms
  }
  if (turns.length) seen.turnAt = Math.max(...turns.map(t => t.startedAt))
  if (s.gate && s.gate.at > seen.gateAt) {
    const key = `${s.gate.ok ? 'pass' : 'block'}:${s.gate.isSent}`
    seen.gates[key] = (seen.gates[key] ?? 0) + 1
    seen.gateAt = s.gate.at
  }
  const trace = s.trace ?? []
  for (const c of trace) {
    if (seen.traceIds.has(c.id) || c.ms === undefined) continue
    const who = c.agentId ? 'agent' : 'main'
    if (c.isFailed) seen.failed[who] = (seen.failed[who] ?? 0) + 1
    if (c.isDenied) seen.denied[who] = (seen.denied[who] ?? 0) + 1
  }
  // Only finished calls count, and the trace only drops old ones: its own ids are all a later read needs.
  seen.traceIds = new Set(trace.filter(c => c.ms !== undefined).map(c => c.id))
  seen.at = now
}

const firstSeen = (s, now) => ({ start: now, at: now, turnAt: Math.max(0, ...(s.turns ?? []).filter(t => !t.isLive).map(t => t.startedAt)), gateAt: s.gate?.at ?? 0, turns: 0, turnMs: {}, gates: {}, failed: {}, denied: {}, traceIds: new Set((s.trace ?? []).filter(c => c.ms !== undefined).map(c => c.id)) })

// `sessions`: [id, snapshot, harness] for each live session. `seen` keeps counter state per id; ids gone from `sessions` are removed.
export function toOtlp(sessions, seen, now) {
  for (const id of seen.keys()) if (!sessions.some(([sid]) => sid === id)) seen.delete(id)
  const resourceMetrics = sessions.map(([id, s, harness]) => {
    if (!seen.has(id)) seen.set(id, firstSeen(s, now))
    const c = seen.get(id)
    count(c, s, now)
    const t = ns(now)
    const start = ns(c.start)
    const gauge = (name, unit, points) => ({ name, unit, gauge: { dataPoints: points.map(([value, a = {}]) => ({ attributes: attrs(a), timeUnixNano: t, asDouble: value })) } })
    const sum = (name, unit, points) => ({ name, unit, sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: points.map(([value, a = {}]) => ({ attributes: attrs(a), startTimeUnixNano: start, timeUnixNano: t, asDouble: value })) } })
    const editedAt = s.files?.editedAt ?? 0
    const checks = (s.checks ?? []).filter(k => k.result !== 'running')
    const test = checks.find(k => k.kind === 'test')
    const agents = tally(s.agents ?? [], a => a.status).map(([status, n]) => [n, { status }])
    const focus = tally(s.focus ?? [], f => `${kindOf(f.key)}:${f.isUrgent}`).map(([k, n]) => [n, { kind: k.split(':')[0], urgent: k.endsWith('true') }])
    const metrics = [
      sum('agentmon.turns', '{turn}', [[c.turns]]),
      sum('agentmon.turn.time', 'ms', Object.entries(c.turnMs).map(([bucket, ms]) => [ms, { bucket }])),
      sum('agentmon.gate.verdicts', '{verdict}', Object.entries(c.gates).map(([k, n]) => [n, { result: k.split(':')[0], sent: k.endsWith('true') }])),
      sum('agentmon.calls.failed', '{call}', Object.entries(c.failed).map(([who, n]) => [n, { who }])),
      sum('agentmon.calls.denied', '{call}', Object.entries(c.denied).map(([who, n]) => [n, { who }])),
      gauge('agentmon.check.failed', '1', checks.map(k => [k.result === 'failed' ? 1 : 0, { kind: k.kind }])),
      gauge('agentmon.check.stale', '1', checks.map(k => [editedAt > k.at ? 1 : 0, { kind: k.kind }])),
      gauge('agentmon.tests.ran', '{test}', test?.ran === undefined ? [] : [[test.ran]]),
      gauge('agentmon.tests.skipped', '{test}', test?.skipped === undefined ? [] : [[test.skipped]]),
      gauge('agentmon.tests.weakened', '{file}', [[s.testReview?.files?.length ?? 0]]),
      gauge('agentmon.focus', '{item}', focus),
      gauge('agentmon.agents', '{agent}', agents),
      gauge('agentmon.context.pct', '%', s.usage?.ctxPct === undefined ? [] : [[s.usage.ctxPct]]),
      gauge('agentmon.context.mcp_tokens', '{token}', [[s.insights?.mcpTokens ?? 0]]),
      gauge('agentmon.context.memory_tokens', '{token}', [[s.insights?.memoryTokens ?? 0]]),
    ]
    // Claude Code exports its own cost and tokens; the other harnesses have no exporter.
    if (harness !== 'claude') {
      const tk = s.insights?.tokens ?? {}
      metrics.push(
        gauge('agentmon.usage.usd', 'USD', [[s.usage?.usd ?? 0]]),
        gauge('agentmon.usage.tokens', '{token}', [[(tk.mainIn ?? 0) + (tk.agentsIn ?? 0), { type: 'input' }], [(tk.mainOut ?? 0) + (tk.agentsOut ?? 0), { type: 'output' }]]),
        ...(s.usage?.credits === undefined ? [] : [gauge('agentmon.usage.credits', '{credit}', [[s.usage.credits]])]),
      )
    }
    return {
      resource: { attributes: attrs({ 'service.name': 'agentmon', 'service.instance.id': id, 'session.id': id, 'agentmon.harness': harness, 'agentmon.place': s.session?.place, 'agentmon.model': s.main?.model || undefined }) },
      scopeMetrics: [{ scope: { name: 'agentmon-live' }, metrics: metrics.filter(m => (m.gauge ?? m.sum).dataPoints.length) }],
    }
  })
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
