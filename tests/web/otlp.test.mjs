import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { otlpTarget, postOtlp, toOtlp } from '../../server/otlp.mjs'

const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'))
const metricsOf = body => Object.fromEntries(body.resourceMetrics[0].scopeMetrics[0].metrics.map(m => [m.name, (m.sum ?? m.gauge).dataPoints]))
const attr = (point, key) => point.attributes.find(a => a.key === key)?.value
const valueOf = (points, key, val) => points.find(p => Object.values(attr(p, key) ?? {})[0] === val)?.asDouble

test('export is off unless asked for and given an endpoint', () => {
  assert.equal(otlpTarget({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://x' }), undefined)
  assert.equal(otlpTarget({ AGENTMON_OTLP: '1' }), undefined)
  assert.deepEqual(otlpTarget({ AGENTMON_OTLP: '1', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example/otlp/', OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20abc=,dd-api-key = k ' }), {
    url: 'https://otlp.example/otlp/v1/metrics',
    headers: { Authorization: 'Basic abc=', 'dd-api-key': 'k' },
  })
  assert.equal(otlpTarget({ AGENTMON_OTLP: '1', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://a', OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://b/m' }).url, 'http://b/m')
})

test('a session becomes numbers with no text from it', () => {
  const s = fixture()
  const body = toOtlp([['s1', s, 'claude']], new Map(), s.now)
  const res = body.resourceMetrics[0].resource.attributes
  assert.deepEqual(Object.fromEntries(res.map(a => [a.key, a.value.stringValue])), { 'service.name': 'agentmon', 'service.instance.id': 's1', 'session.id': 's1', 'agentmon.harness': 'claude', 'agentmon.model': s.main.model })
  const m = metricsOf(body)
  assert.equal(valueOf(m['agentmon.check.failed'], 'kind', 'test'), 1)
  assert.equal(valueOf(m['agentmon.check.failed'], 'kind', 'typecheck'), 0)
  assert.equal(m['agentmon.context.pct'][0].asDouble, 62)
  assert.equal(valueOf(m['agentmon.focus'], 'kind', 'check'), 1)
  assert.equal(m['agentmon.usage.usd'], undefined, 'Claude Code exports its own cost')
  const sent = JSON.stringify(body)
  for (const text of [s.session.cwd, s.gate.text, ...s.checks.map(c => c.command), ...s.focus.map(f => f.text), ...s.trace.map(c => c.what), ...s.turns.map(t => t.prompt).filter(Boolean)]) assert.ok(!sent.includes(text), text)
})

test('counters count what is new, once', () => {
  const s = fixture()
  const seen = new Map()
  toOtlp([['s1', s, 'codex']], seen, s.now)
  let m = metricsOf(toOtlp([['s1', s, 'codex']], seen, s.now + 1))
  assert.equal(m['agentmon.turns'][0].asDouble, 0)
  assert.equal(m['agentmon.gate.verdicts'], undefined)
  assert.ok(m['agentmon.usage.usd'], 'no other exporter for Codex')

  const later = { ...s, gate: { ...s.gate, ok: true, at: s.gate.at + 1 }, turns: [...s.turns, { startedAt: s.now + 5, wallMs: 10, buckets: { model: 7, shell: 3 } }], trace: [...s.trace, { id: 'new', at: s.now, who: 'x', tool: 'Bash', what: 'secret', ms: 5, isFailed: true }] }
  for (let i = 0; i < 2; i += 1) {
    m = metricsOf(toOtlp([['s1', later, 'codex']], seen, s.now + 10 + i))
    assert.equal(m['agentmon.turns'][0].asDouble, 1)
    assert.equal(valueOf(m['agentmon.turn.time'], 'bucket', 'model'), 7)
    assert.equal(valueOf(m['agentmon.gate.verdicts'], 'result', 'pass'), 1)
    assert.equal(valueOf(m['agentmon.calls.failed'], 'who', 'main'), 1)
  }
  toOtlp([], seen, s.now + 20)
  assert.equal(seen.size, 0)
})

test('a down endpoint fails silent', async () => {
  let got
  const server = createServer((req, res) => {
    const parts = []
    req.on('data', c => parts.push(c)).on('end', () => {
      got = { type: req.headers['content-type'], auth: req.headers.authorization, body: JSON.parse(Buffer.concat(parts)) }
      res.end()
    })
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${server.address().port}/v1/metrics`
  assert.equal(await postOtlp({ url, headers: { authorization: 'Basic x' } }, { resourceMetrics: [] }), 200)
  assert.deepEqual(got, { type: 'application/json', auth: 'Basic x', body: { resourceMetrics: [] } })
  server.close()
  assert.equal(await postOtlp({ url, headers: {} }, {}), 0)
})
