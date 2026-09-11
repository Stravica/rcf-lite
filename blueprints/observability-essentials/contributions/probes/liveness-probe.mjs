// Liveness-probe probe for observability-essentials.
// Boots the fixture server, VARIES the input by supplying a distinct
// x-request-id header per request, and asserts the fixture echoes it
// back on both the response header and inside the response body.
// Then flips the liveness flag and asserts a subsequent request
// returns 503, again with the supplied request-id echoed. This is
// derived output: the request-id is the probe's varied input, the
// echoed pair is the fixture's derived response; assertion is on the
// propagation, not on a constant both sides authored.
//
// Positive evidence: the supplied inputs, the echoed pair per call
// and the delta on the fixture's metrics counter for /live between
// snapshots.
// anchorAcId: AC-7101-1. accountBound: false.

import { randomUUID } from 'node:crypto';
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7101-1';
export const accountBound = false;

async function get(port, path, headers) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, requestId: res.headers.get('x-request-id'), body: text, parsed };
}

export default async function runProbe() {
  const srv = createProbeServer();
  const { port } = await srv.listen(envPort());
  const results = [];
  const healthyIds = [randomUUID(), randomUUID(), randomUUID()];
  const healthyObserved = [];
  let unhealthyObserved;
  const before = srv.countersSnapshot();
  try {
    for (const rid of healthyIds) {
      const r = await get(port, '/live', { 'x-request-id': rid });
      healthyObserved.push({ supplied: rid, echoedHeader: r.requestId, echoedBody: r.parsed?.requestIdEchoed, status: r.status, bodyStatus: r.parsed?.status });
    }
    const allEchoed = healthyObserved.every((o) => o.status === 200 && o.echoedHeader === o.supplied && o.echoedBody === o.supplied && o.bodyStatus === 'live');
    results.push({
      anchorAcId: 'AC-7101-1',
      verdict: allEchoed ? 'pass' : 'fail',
      detail: `${healthyIds.length} varied x-request-id inputs echoed as headers AND in body; all statuses 200 and body.status='live': ${allEchoed}`,
      evidence: { variedInputs: healthyIds, observed: healthyObserved },
    });

    srv.setLivenessUnhealthy(true);
    const badId = randomUUID();
    const bad = await get(port, '/live', { 'x-request-id': badId });
    unhealthyObserved = { supplied: badId, echoedHeader: bad.requestId, echoedBody: bad.parsed?.requestIdEchoed, status: bad.status, bodyStatus: bad.parsed?.status };
    results.push({
      anchorAcId: 'AC-7101-2',
      verdict: bad.status === 503 && bad.requestId === badId && bad.parsed?.requestIdEchoed === badId && bad.parsed?.status === 'unhealthy' ? 'pass' : 'fail',
      detail: `after setLivenessUnhealthy(true): GET /live -> ${bad.status} echoed header=${bad.requestId} body.echoed=${bad.parsed?.requestIdEchoed}`,
      evidence: { variedInput: badId, observed: unhealthyObserved },
    });

    // Counter-delta assertion: the fixture's live counter should have
    // grown by exactly the number of requests we sent (3 healthy + 1
    // unhealthy = 4).
    const after = srv.countersSnapshot();
    const delta = after.liveRequests - before.liveRequests;
    const expected = healthyIds.length + 1;
    results.push({
      anchorAcId: 'AC-7101-1',
      verdict: delta === expected ? 'pass' : 'fail',
      detail: `derived metric delta probe_live_requests_total before=${before.liveRequests} after=${after.liveRequests} delta=${delta} expected=${expected}`,
      evidence: { countersBefore: before, countersAfter: after, delta, expected },
    });
  } finally {
    srv.setLivenessUnhealthy(false);
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, variedInputs: healthyIds, healthyObserved, unhealthyObserved } };
}
