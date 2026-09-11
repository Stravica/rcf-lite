// Liveness-probe probe for observability-essentials v2.1.2.
// Boots the fixture server on 127.0.0.1, issues a real HTTP GET
// on /live and asserts the 200 body says { status: 'live' } and
// the response carries a real x-request-id header. Then flips the
// liveness flag and asserts a subsequent request returns 503 with
// the same header contract; the flag is restored and the server
// torn down.
//
// Positive evidence: real x-request-id header value returned by the
// live server + the response body excerpt.
// anchorAcId: AC-7101-1. accountBound: false.

import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7101-1';
export const accountBound = false;

async function get(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  return { status: res.status, requestId: res.headers.get('x-request-id'), body: text };
}

export default async function runProbe() {
  const srv = createProbeServer();
  const { port } = await srv.listen(envPort());
  const results = [];
  let healthy, unhealthy;
  try {
    healthy = await get(port, '/live');
    let bodyOk = false;
    try { bodyOk = JSON.parse(healthy.body).status === 'live'; } catch {}
    results.push({
      anchorAcId: 'AC-7101-1',
      verdict: healthy.status === 200 && bodyOk && healthy.requestId ? 'pass' : 'fail',
      detail: `GET /live -> ${healthy.status}; requestId=${healthy.requestId}; bodyStatus=${bodyOk ? 'live' : 'unexpected'}`,
      evidence: { status: healthy.status, requestId: healthy.requestId, bodyExcerpt: healthy.body.slice(0, 200) },
    });

    srv.setLivenessUnhealthy(true);
    unhealthy = await get(port, '/live');
    let unhealthyBody = false;
    try { unhealthyBody = JSON.parse(unhealthy.body).status === 'unhealthy'; } catch {}
    results.push({
      anchorAcId: 'AC-7101-2',
      verdict: unhealthy.status === 503 && unhealthyBody && unhealthy.requestId ? 'pass' : 'fail',
      detail: `after setLivenessUnhealthy(true): GET /live -> ${unhealthy.status}; requestId=${unhealthy.requestId}`,
      evidence: { status: unhealthy.status, requestId: unhealthy.requestId, bodyExcerpt: unhealthy.body.slice(0, 200) },
    });
  } finally {
    srv.setLivenessUnhealthy(false);
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, healthyRequestId: healthy?.requestId, unhealthyRequestId: unhealthy?.requestId } };
}
