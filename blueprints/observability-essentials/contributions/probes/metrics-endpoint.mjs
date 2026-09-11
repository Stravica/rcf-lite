// Metrics-endpoint probe for observability-essentials.
// Boots the fixture server, snapshots the /metrics counters, sends
// N /live requests, and asserts the /metrics text now reports the
// live counter increased by exactly N. This is derived output: the
// probe controls the number of requests it sends; the fixture
// computes the counter value; assertion is on the DELTA.
// Also asserts the content-type contract and that the response
// carries a real request id echoed from the probe's inbound header.
// anchorAcId: AC-7104-1. accountBound: false.

import { randomUUID } from 'node:crypto';
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7104-1';
export const accountBound = false;

function readCounter(text, name) {
  const line = text.split('\n').find((l) => l && !l.startsWith('#') && l.startsWith(name + ' '));
  if (!line) return null;
  const value = Number(line.split(' ').pop());
  return Number.isFinite(value) ? value : null;
}

async function fetchMetrics(port, rid) {
  const res = await fetch(`http://127.0.0.1:${port}/metrics`, { headers: { 'x-request-id': rid } });
  const body = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    requestId: res.headers.get('x-request-id'),
    body,
    liveTotal: readCounter(body, 'probe_live_requests_total'),
    readyTotal: readCounter(body, 'probe_ready_requests_total'),
    metricsTotal: readCounter(body, 'probe_metrics_requests_total'),
  };
}

export default async function runProbe() {
  const srv = createProbeServer();
  const { port } = await srv.listen(envPort());
  const results = [];
  const rid1 = randomUUID(), rid2 = randomUUID();
  let before, after;
  const N = 4;
  try {
    before = await fetchMetrics(port, rid1);
    results.push({
      anchorAcId: 'AC-7104-1',
      verdict: before.status === 200 && before.contentType?.startsWith('text/plain') && before.requestId === rid1 && typeof before.liveTotal === 'number' ? 'pass' : 'fail',
      detail: `GET /metrics baseline -> ${before.status} content-type='${before.contentType}' requestIdEcho=${before.requestId === rid1}; liveTotal=${before.liveTotal}`,
      evidence: { status: before.status, contentType: before.contentType, requestId: before.requestId, suppliedInput: rid1, bodyExcerpt: before.body.slice(0, 500), liveTotal: before.liveTotal },
    });
    // Send N /live requests to force the counter to move.
    for (let i = 0; i < N; i++) await fetch(`http://127.0.0.1:${port}/live`);
    after = await fetchMetrics(port, rid2);
    const delta = (after.liveTotal ?? 0) - (before.liveTotal ?? 0);
    results.push({
      anchorAcId: 'AC-7104-1',
      verdict: after.status === 200 && after.requestId === rid2 && delta === N ? 'pass' : 'fail',
      detail: `sent ${N} /live requests; probe_live_requests_total moved before=${before.liveTotal} -> after=${after.liveTotal} delta=${delta} expected=${N}`,
      evidence: { delta, expected: N, before: before.liveTotal, after: after.liveTotal, requestIdEcho: after.requestId === rid2, bodyExcerpt: after.body.slice(0, 500) },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, requestsSent: N, beforeCounters: before && { liveTotal: before.liveTotal, readyTotal: before.readyTotal, metricsTotal: before.metricsTotal }, afterCounters: after && { liveTotal: after.liveTotal, readyTotal: after.readyTotal, metricsTotal: after.metricsTotal } } };
}
