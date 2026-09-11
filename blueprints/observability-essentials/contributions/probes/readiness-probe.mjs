// Readiness-probe probe for observability-essentials.
// Registers a real TCP dependency on a stub server the probe controls,
// asserts /ready returns 200 (fixture actually dialled and got a
// connect). Then CLOSES the stub server so the port is refused, and
// asserts /ready returns 503 naming that same dependency in the
// derived unreadyDependencies list. This is derived output: the
// probe controls the varied input (open/closed port), the fixture
// computes the response from a live dial - the sides are not
// authoring the same constant.
//
// Positive evidence: the supplied dependency (host, port), the
// x-request-id echo on both responses, the derived dependency list
// on each response.
// anchorAcId: AC-7102-1. accountBound: false.

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7102-1';
export const accountBound = false;

async function openStubTcp() {
  return new Promise((resolve, reject) => {
    const s = createServer((sock) => { sock.destroy(); });
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}

async function get(port, path, headers) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, requestId: res.headers.get('x-request-id'), body: text, parsed };
}

export default async function runProbe() {
  const srv = createProbeServer();
  const stub = await openStubTcp();
  srv.addTcpDependency('probe-stub-tcp', '127.0.0.1', stub.port);
  const { port } = await srv.listen(envPort());
  const results = [];
  let readyObs, unreadyObs;
  const supplied = { host: '127.0.0.1', port: stub.port, name: 'probe-stub-tcp' };
  try {
    const rid1 = randomUUID();
    const ready = await get(port, '/ready', { 'x-request-id': rid1 });
    const upDep = ready.parsed?.dependencies?.find((d) => d.name === 'probe-stub-tcp' && d.status === 'up' && d.port === stub.port);
    readyObs = { status: ready.status, requestId: ready.requestId, echoedBody: ready.parsed?.requestIdEchoed, dependencies: ready.parsed?.dependencies };
    results.push({
      anchorAcId: 'AC-7102-1',
      verdict: ready.status === 200 && ready.requestId === rid1 && ready.parsed?.requestIdEchoed === rid1 && upDep && ready.parsed?.status === 'ready' ? 'pass' : 'fail',
      detail: `GET /ready with stub tcp open on port ${stub.port} -> ${ready.status}; fixture dialled and observed status=${upDep?.status}; derived requestId echo ok=${ready.requestId === rid1}`,
      evidence: { suppliedDependency: supplied, observed: readyObs },
    });

    // Close the stub port; the fixture must now observe the dep down.
    await new Promise((r) => stub.server.close(() => r()));

    const rid2 = randomUUID();
    const unready = await get(port, '/ready', { 'x-request-id': rid2 });
    const downDep = unready.parsed?.dependencies?.find((d) => d.name === 'probe-stub-tcp' && d.status === 'down');
    const namesUnready = Array.isArray(unready.parsed?.unreadyDependencies) && unready.parsed.unreadyDependencies.includes('probe-stub-tcp');
    unreadyObs = { status: unready.status, requestId: unready.requestId, echoedBody: unready.parsed?.requestIdEchoed, dependencies: unready.parsed?.dependencies, unreadyDependencies: unready.parsed?.unreadyDependencies };
    results.push({
      anchorAcId: 'AC-7103-1',
      verdict: unready.status === 503 && unready.requestId === rid2 && unready.parsed?.requestIdEchoed === rid2 && downDep && namesUnready && unready.parsed?.status === 'unready' ? 'pass' : 'fail',
      detail: `after stub tcp closed on port ${stub.port}: GET /ready -> ${unready.status}; fixture-derived down.detail='${downDep?.detail}'; unreadyDependencies=${JSON.stringify(unready.parsed?.unreadyDependencies)}`,
      evidence: { closedDependency: supplied, observed: unreadyObs },
    });
  } finally {
    try { await new Promise((r) => stub.server.close(() => r())); } catch {}
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, suppliedDependency: supplied, readyObserved: readyObs, unreadyObserved: unreadyObs } };
}
