// Liveness-probe probe for observability-essentials.
// Boots the fixture server, VARIES the input by supplying a distinct
// x-request-id header per request, and asserts the healthy /live
// response is HTTP 200 with body.status='pass' (AC-7101-1). Then
// flips the liveness flag and asserts the unhealthy path returns
// HTTP 503 with content-length 0 and an empty body per AC-7101-5.
//
// Positive evidence: the supplied inputs, the request-id echoed on
// the healthy response's header, and the empty-body confirmation
// on the unhealthy response.
// anchorAcId: AC-7101-1. accountBound: false.

import { randomUUID } from 'node:crypto';
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7101-1';
export const accountBound = false;
const AC1 = 'The application serves the liveness endpoint at a';
const AC5 = 'A liveness handler on a process whose in-process';

async function get(port, path, headers) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, requestId: res.headers.get('x-request-id'), contentLength: res.headers.get('content-length'), body: text, parsed };
}

export default async function runProbe() {
  const srv = createProbeServer();
  const { port } = await srv.listen(envPort());
  const results = [];
  const healthyIds = [randomUUID(), randomUUID(), randomUUID()];
  const healthyObserved = [];
  let unhealthyObserved;
  try {
    for (const rid of healthyIds) {
      const r = await get(port, '/live', { 'x-request-id': rid });
      healthyObserved.push({ supplied: rid, echoedHeader: r.requestId, echoedBody: r.parsed?.requestIdEchoed, status: r.status, bodyStatus: r.parsed?.status });
    }
    const allEchoed = healthyObserved.every((o) => o.status === 200 && o.echoedHeader === o.supplied && o.echoedBody === o.supplied && o.bodyStatus === 'pass');
    results.push({
      anchorAcId: 'AC-7101-1',
      verdict: allEchoed ? 'pass' : 'fail',
      detail: `${AC1}  -  ${healthyIds.length} varied x-request-id inputs; every response is HTTP 200 with body.status='pass' and header/body echo the supplied id (AC-7101-1). derivedResults=${JSON.stringify(healthyObserved.map((o) => ({ ok: o.status === 200 && o.bodyStatus === 'pass' && o.echoedHeader === o.supplied })))}`,
      evidence: { variedInputs: healthyIds, observed: healthyObserved },
    });

    srv.setLivenessUnhealthy(true);
    const badId = randomUUID();
    const bad = await get(port, '/live', { 'x-request-id': badId });
    unhealthyObserved = { supplied: badId, echoedHeader: bad.requestId, status: bad.status, contentLength: bad.contentLength, bodyLength: bad.body.length };
    // AC-7101-5: response is HTTP 503 with content-length 0 and empty body.
    results.push({
      anchorAcId: 'AC-7101-5',
      verdict: bad.status === 503 && (bad.contentLength === '0' || bad.body.length === 0) && bad.requestId === badId ? 'pass' : 'fail',
      detail: `${AC5}  -  after setLivenessUnhealthy(true): GET /live -> ${bad.status} content-length='${bad.contentLength}' bodyLength=${bad.body.length} echoedHeader=${bad.requestId === badId}; observed per AC-7101-5 which requires HTTP 503 with content-length 0 and an empty body when the self-check predicate is fail.`,
      evidence: { variedInput: badId, observed: unhealthyObserved },
    });
  } finally {
    srv.setLivenessUnhealthy(false);
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, variedInputs: healthyIds, healthyObserved, unhealthyObserved } };
}
