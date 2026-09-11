// Readiness-probe probe for observability-essentials.
//
// Registers a real TCP dependency on a stub server the probe controls,
// asserts /ready returns 200 with body.status='pass' and a checks{}
// entry per declared dependency, then CLOSES the stub server so the
// port is refused and asserts /ready returns 503 with body.status='fail'
// and the dependency's checks[name].state === 'fail'.
//
// Teardown closes the fixture http server first and propagates any
// error from a registered teardown callback; a failing teardown fails
// the verdict.
//
// AC-7102-1 is anchored (endpoint behaviour observable at shelf).
//
// AC-7103-1 requires the readiness dependency set to be declared at
// boot AND requires the endpoint to refuse a missing or malformed
// declaration at boot. This probe observes only the checks object
// shape at request time; the boot-refusal clause is not observed.
// Row de-claimed (conformanceOnly, anchorAcId=null) with the
// limitation naming AC-7103-1.
//
// AC-7103-2 requires the checkedAt timestamp to be no older than an
// evaluation budget declared in fixture configuration. This probe
// uses a probe-authored 5000 ms constant, not a value declared in
// fixture configuration. Row de-claimed with the limitation naming
// AC-7103-2.

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7102-1';
export const accountBound = false;
const AC1 = 'The application serves the readiness endpoint at a';
const AC71 = 'The readiness dependency set is declared at boot';
const AC72 = 'Each entry in the checks object carries a';

const LIM_7103_1 = `AC-7103-1: requires the readiness dependency set to be declared at boot AND the endpoint to refuse a missing or malformed declaration at boot. This row observes only the checks object shape at request time; the boot-refusal clause is not observed.`;
const LIM_7103_2 = `AC-7103-2: requires the checks[name].checkedAt timestamp to be no older than an evaluation budget declared in fixture configuration. This row applies a probe-authored 5000 ms upper-bound constant, not a value declared in fixture configuration.`;

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
    results.push({
      anchorAcId: 'AC-7102-1',
      verdict: ready.status === 200 && ready.parsed?.status === 'pass' && ready.requestId === rid1 ? 'pass' : 'fail',
      detail: `${AC1}  -  GET /ready with stub tcp open on port ${stub.port} -> ${ready.status} body.status='${ready.parsed?.status}'; observes AC-7102-1 (200 + body.status='pass' when every declared readiness dependency is passing).`,
      evidence: { suppliedDependency: supplied, observed: readyObs },
    });
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_7103_1,
      verdict: ready.parsed?.checks && typeof ready.parsed.checks === 'object' && Object.keys(ready.parsed.checks).length === 1 && passEntry ? 'pass' : 'fail',
      detail: `${AC71}  -  checks object keys=${JSON.stringify(Object.keys(ready.parsed?.checks || {}))}; the boot-refusal clause on AC-7103-1 (missing or malformed declaration refused at boot) is not observed here.`,
      evidence: { checksKeys: Object.keys(ready.parsed?.checks || {}), entry: passEntry },
    });
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_7103_2,
      verdict: passEntry && (passEntry.state === 'pass' || passEntry.state === 'fail') && typeof passEntry.checkedAt === 'string' && !Number.isNaN(Date.parse(passEntry.checkedAt)) && (Date.now() - Date.parse(passEntry.checkedAt)) <= 5000 ? 'pass' : 'fail',
      detail: `${AC72}  -  checks['probe-stub-tcp'] state='${passEntry?.state}' checkedAt='${passEntry?.checkedAt}'; state ∈ {pass,fail} AND ISO-8601 checkedAt observed. Evaluation-budget upper bound is a probe-authored 5000 ms constant, not a fixture-configured value.`,
      evidence: { entry: passEntry },
    });

    await new Promise((resolve, reject) => stub.server.close((err) => (err ? reject(err) : resolve())));
    stubClosed = true;

    const rid2 = randomUUID();
    const unready = await get(port, '/ready', { 'x-request-id': rid2 });
    const failEntry = unready.parsed?.checks?.['probe-stub-tcp'];
    unreadyObs = { status: unready.status, requestId: unready.requestId, checks: unready.parsed?.checks, unreadyDependencies: unready.parsed?.unreadyDependencies };
    results.push({
      anchorAcId: 'AC-7102-1',
      verdict: unready.status === 503 && unready.parsed?.status === 'fail' && unready.requestId === rid2 && failEntry?.state === 'fail' ? 'pass' : 'fail',
      detail: `${AC1}  -  after stub tcp closed on port ${stub.port}: GET /ready -> ${unready.status} body.status='${unready.parsed?.status}' checks['probe-stub-tcp'].state='${failEntry?.state}'; observes AC-7102-1 (503 + body.status='fail' when at least one declared readiness dependency is failing).`,
      evidence: { closedDependency: supplied, observed: unreadyObs, entry: failEntry },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, suppliedDependency: supplied, readyObserved: readyObs, unreadyObserved: unreadyObs } };
}
