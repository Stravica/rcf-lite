// Readiness-probe probe for observability-essentials v2.1.2.
// Boots the fixture server, registers two dependencies (postgres
// and redis) as up, asserts /ready -> 200 with both listed as up.
// Flips postgres to down with a detail message and asserts /ready
// -> 503 naming the unready dependency in the body. Real HTTP round-
// trips throughout; teardown always fires.
//
// Positive evidence: real x-request-id header + the dependency list
// excerpted from the response body proves the readiness probe reports
// which dependency turned the replica unready.
// anchorAcId: AC-7102-1. accountBound: false.

import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7102-1';
export const accountBound = false;

async function get(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  return { status: res.status, requestId: res.headers.get('x-request-id'), body: text };
}

export default async function runProbe() {
  const srv = createProbeServer();
  srv.setDependency('postgres', 'up');
  srv.setDependency('redis', 'up');
  const { port } = await srv.listen(envPort());
  const results = [];
  let ready, unready;
  try {
    ready = await get(port, '/ready');
    let readyBody = null;
    try { readyBody = JSON.parse(ready.body); } catch {}
    const allUp = readyBody && readyBody.status === 'ready' && readyBody.dependencies?.every((d) => d.status === 'up');
    results.push({
      anchorAcId: 'AC-7102-1',
      verdict: ready.status === 200 && allUp && ready.requestId ? 'pass' : 'fail',
      detail: `GET /ready with all deps up -> ${ready.status}; deps=${JSON.stringify(readyBody?.dependencies?.map((d) => d.name))}`,
      evidence: { status: ready.status, requestId: ready.requestId, dependencies: readyBody?.dependencies },
    });

    srv.setDependency('postgres', 'down', 'connection refused');
    unready = await get(port, '/ready');
    let unreadyBody = null;
    try { unreadyBody = JSON.parse(unready.body); } catch {}
    const namesUnready = unreadyBody?.dependencies?.find((d) => d.name === 'postgres' && d.status === 'down' && d.detail === 'connection refused');
    results.push({
      anchorAcId: 'AC-7103-1',
      verdict: unready.status === 503 && namesUnready && unreadyBody.status === 'unready' && unready.requestId ? 'pass' : 'fail',
      detail: `after setDependency(postgres, down): GET /ready -> ${unready.status}; postgres.detail='${namesUnready?.detail}'`,
      evidence: { status: unready.status, requestId: unready.requestId, dependencies: unreadyBody?.dependencies },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, readyRequestId: ready?.requestId, unreadyRequestId: unready?.requestId } };
}
