// Readiness-probe probe for observability-essentials.
// Registers a real TCP dependency on a stub server the probe controls,
// asserts /ready returns 200 with body.status='pass' and one entry
// per declared dependency in the checks{} object per AC-7102-1 and
// AC-7103-1/2. Then CLOSES the stub server so the port is refused
// and asserts /ready returns 503 with body.status='fail' and the
// dependency's checks[name].state === 'fail' with a checkedAt
// ISO-8601 timestamp.
//
// Teardown: closes the fixture http server first, then propagates
// any error from a registered teardown callback (per Addendum rule 5).
// If the stub cannot be closed, the teardown throws and the probe
// reports the FAIL.
//
// anchorAcId: AC-7102-1. accountBound: false.

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7102-1';
export const accountBound = false;
const AC1 = 'The application serves the readiness endpoint at a';
const AC71 = 'The readiness dependency set is declared at boot';
const AC72 = 'Each entry in the checks object carries a';

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
  let stubClosed = false;
  srv.addTcpDependency('probe-stub-tcp', '127.0.0.1', stub.port);
  // Register a teardown callback that fails if the stub could not
  // be closed. Errors propagate; they are not swallowed.
  srv.registerTeardown(async () => {
    if (stubClosed) return;
    await new Promise((resolve, reject) => stub.server.close((err) => (err ? reject(err) : resolve())));
    stubClosed = true;
  });
  const { port } = await srv.listen(envPort());
  const results = [];
  let readyObs, unreadyObs;
  const supplied = { host: '127.0.0.1', port: stub.port, name: 'probe-stub-tcp' };
  try {
    const rid1 = randomUUID();
    const ready = await get(port, '/ready', { 'x-request-id': rid1 });
    const passEntry = ready.parsed?.checks?.['probe-stub-tcp'];
    readyObs = { status: ready.status, requestId: ready.requestId, echoedBody: ready.parsed?.requestIdEchoed, checks: ready.parsed?.checks };
    // AC-7102-1: 200 + body.status='pass'; AC-7103-1: checks object.
    results.push({
      anchorAcId: 'AC-7102-1',
      verdict: ready.status === 200 && ready.parsed?.status === 'pass' && ready.requestId === rid1 ? 'pass' : 'fail',
      detail: `${AC1}  -  GET /ready with stub tcp open on port ${stub.port} -> ${ready.status} body.status='${ready.parsed?.status}'; observed per AC-7102-1 which requires 200 and body.status='pass' when every declared readiness dependency is passing.`,
      evidence: { suppliedDependency: supplied, observed: readyObs },
    });
    results.push({
      anchorAcId: 'AC-7103-1',
      verdict: ready.parsed?.checks && typeof ready.parsed.checks === 'object' && Object.keys(ready.parsed.checks).length === 1 && passEntry ? 'pass' : 'fail',
      detail: `${AC71}  -  checks object keys=${JSON.stringify(Object.keys(ready.parsed?.checks || {}))}; observed per AC-7103-1 which requires one entry per declared dependency, keyed by name, with no additional keys.`,
      evidence: { checksKeys: Object.keys(ready.parsed?.checks || {}), entry: passEntry },
    });
    results.push({
      anchorAcId: 'AC-7103-2',
      verdict: passEntry && (passEntry.state === 'pass' || passEntry.state === 'fail') && typeof passEntry.checkedAt === 'string' && !Number.isNaN(Date.parse(passEntry.checkedAt)) && (Date.now() - Date.parse(passEntry.checkedAt)) <= 5000 ? 'pass' : 'fail',
      detail: `${AC72}  -  checks['probe-stub-tcp'] state='${passEntry?.state}' checkedAt='${passEntry?.checkedAt}'; observed per AC-7103-2 which requires state ∈ {pass,fail}, a parseable ISO-8601 checkedAt AND the timestamp no older than the readiness evaluation budget (probe-set 5000ms).`,
      evidence: { entry: passEntry },
    });

    // Close the stub port; the fixture must now observe the dep down.
    await new Promise((resolve, reject) => stub.server.close((err) => (err ? reject(err) : resolve())));
    stubClosed = true;

    const rid2 = randomUUID();
    const unready = await get(port, '/ready', { 'x-request-id': rid2 });
    const failEntry = unready.parsed?.checks?.['probe-stub-tcp'];
    unreadyObs = { status: unready.status, requestId: unready.requestId, checks: unready.parsed?.checks, unreadyDependencies: unready.parsed?.unreadyDependencies };
    // AC-7102-1 also states 503 with body.status='fail' when at least one dep is failing.
    results.push({
      anchorAcId: 'AC-7102-1',
      verdict: unready.status === 503 && unready.parsed?.status === 'fail' && unready.requestId === rid2 && failEntry?.state === 'fail' ? 'pass' : 'fail',
      detail: `${AC1}  -  after stub tcp closed on port ${stub.port}: GET /ready -> ${unready.status} body.status='${unready.parsed?.status}' checks['probe-stub-tcp'].state='${failEntry?.state}'; observed per AC-7102-1 which requires 503 and body.status='fail' when at least one declared readiness dependency is failing.`,
      evidence: { closedDependency: supplied, observed: unreadyObs, entry: failEntry },
    });
  } finally {
    // Fixture close propagates the stub teardown error if any.
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, suppliedDependency: supplied, readyObserved: readyObs, unreadyObserved: unreadyObs } };
}
