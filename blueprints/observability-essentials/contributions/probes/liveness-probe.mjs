// Liveness-probe probe for observability-essentials.
//
// Boots the fixture server, VARIES the input by supplying a distinct
// x-request-id header per request, and observes the /live endpoint.
//
// AC-7101-1 requires the endpoint path to come from project
// configuration under probeInterface.paths.liveness (no shipped
// default). This probe uses a hard-coded '/live' path against the
// fixture rather than reading a configured path from a downstream
// project; row de-claimed (conformanceOnly, anchorAcId=null) with
// the limitation naming AC-7101-1. The observation (HTTP 200 with
// body.status='pass' on the healthy path) is retained.
//
// AC-7101-5 requires the unhealthy path to answer HTTP 503 with
// content-length 0 AND for a follow-up GET while the predicate stays
// fail to continue answering 503 AND for a GET after the predicate
// returns pass to answer 200. This probe exercises all three requests
// (unhealthy, repeat unhealthy, restored healthy) and anchors AC-7101-5.

import { randomUUID } from 'node:crypto';
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7101-5';
export const accountBound = false;
const AC5 = 'A liveness handler on a process whose in-process';
const LIM_7101_1 = `AC-7101-1: requires the liveness endpoint path to come from project configuration under probeInterface.paths.liveness (no shipped default from v2.0.0). This row observes the endpoint behaviour at the hard-coded fixture path '/live'; it does not observe the path being sourced from configuration in a downstream project.`;

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
  let unhealthyObserved, repeatObserved, restoredObserved;
  try {
    for (const rid of healthyIds) {
      const r = await get(port, '/live', { 'x-request-id': rid });
      healthyObserved.push({ supplied: rid, echoedHeader: r.requestId, echoedBody: r.parsed?.requestIdEchoed, status: r.status, bodyStatus: r.parsed?.status });
    }
    const allEchoed = healthyObserved.every((o) => o.status === 200 && o.echoedHeader === o.supplied && o.echoedBody === o.supplied && o.bodyStatus === 'pass');
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_7101_1,
      verdict: allEchoed ? 'pass' : 'fail',
      detail: `observed ${healthyIds.length} varied x-request-id inputs at the hard-coded fixture path '/live'; every response is HTTP 200 with body.status='pass' and header/body echo the supplied id. Path-from-configuration clause not observed.`,
      evidence: { variedInputs: healthyIds, observed: healthyObserved },
    });

    srv.setLivenessUnhealthy(true);
    const badId = randomUUID();
    const bad = await get(port, '/live', { 'x-request-id': badId });
    unhealthyObserved = { supplied: badId, echoedHeader: bad.requestId, status: bad.status, contentLength: bad.contentLength, bodyLength: bad.body.length };
    const badId2 = randomUUID();
    const bad2 = await get(port, '/live', { 'x-request-id': badId2 });
    repeatObserved = { supplied: badId2, echoedHeader: bad2.requestId, status: bad2.status, contentLength: bad2.contentLength, bodyLength: bad2.body.length };
    srv.setLivenessUnhealthy(false);
    const goodId = randomUUID();
    const restored = await get(port, '/live', { 'x-request-id': goodId });
    restoredObserved = { supplied: goodId, echoedHeader: restored.requestId, status: restored.status, bodyStatus: restored.parsed?.status };

    const failOk = bad.status === 503 && (bad.contentLength === '0' || bad.body.length === 0) && bad.requestId === badId;
    const repeatOk = bad2.status === 503 && (bad2.contentLength === '0' || bad2.body.length === 0) && bad2.requestId === badId2;
    const restoredOk = restored.status === 200 && restored.parsed?.status === 'pass' && restored.requestId === goodId;
    results.push({
      anchorAcId: 'AC-7101-5',
      verdict: failOk && repeatOk && restoredOk ? 'pass' : 'fail',
      detail: `${AC5}  -  fail: HTTP ${bad.status} content-length='${bad.contentLength}' bodyLength=${bad.body.length}; repeat-fail: HTTP ${bad2.status} content-length='${bad2.contentLength}' bodyLength=${bad2.body.length}; restored-pass: HTTP ${restored.status} body.status='${restored.parsed?.status}'. Observes AC-7101-5 three-step contract (503 -> 503 while predicate fails -> 200 after predicate restored).`,
      evidence: { variedInput: badId, observed: unhealthyObserved, repeatObserved, restoredObserved },
    });
  } finally {
    srv.setLivenessUnhealthy(false);
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, variedInputs: healthyIds, healthyObserved, unhealthyObserved, repeatObserved, restoredObserved } };
}
