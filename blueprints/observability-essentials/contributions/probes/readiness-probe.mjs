// Readiness-probe probe for observability-essentials.
//
// AC-7102-1 requires the readiness endpoint to be served at a path
// SUPPLIED BY PROJECT CONFIGURATION under probeInterface.paths.readiness
// (no shipped default from v2.0.0), and that path MUST be distinct
// from the liveness path. This probe boots the fixture with an
// explicit non-default readiness path and a distinct liveness path
// (both sourced from the probe's configuration input), then asserts:
//   - a GET at the CONFIGURED readiness path returns 200 body.status=pass
//     when the declared dependency is healthy;
//   - a GET at the CONFIGURED readiness path returns 503 body.status=fail
//     when the declared dependency has failed;
//   - a GET at the SAME readiness path when the liveness path is /live-cfg
//     is NOT reached by the liveness handler (distinctness);
//   - a GET at the liveness path against the same listener returns
//     the liveness body shape, not the readiness body shape.
//
// Teardown closes the fixture http server first and propagates any
// error from a registered teardown callback; a failing teardown fails
// the verdict.
//
// AC-7103-1 (boot-refusal on missing/malformed declaration) and
// AC-7103-2 (checkedAt within a fixture-configured evaluation budget)
// are de-claimed with limitations naming the respective ACs.

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7102-1';
export const accountBound = false;
const AC1 = 'The application serves the readiness endpoint at a';

const LIM_7103_1 = `AC-7103-1: requires the readiness dependency set to be declared at boot AND the endpoint to refuse a missing or malformed declaration at boot. This row observes only the checks object shape at request time; the boot-refusal clause is not observed.`;
const LIM_7103_2 = `AC-7103-2: requires the checks[name].checkedAt timestamp to be no older than an evaluation budget declared in fixture configuration. This row applies a probe-authored 5000 ms upper-bound constant, not a value declared in fixture configuration.`;

// Configuration-sourced paths (probe's stand-in for project config
// under probeInterface.paths.*). Deliberately non-default so the
// observation cannot be a lucky match against a shipped default.
const CONFIGURED_PATHS = { liveness: '/live-cfg-v2', readiness: '/readiness-cfg-v2' };

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
  const srv = createProbeServer({ paths: CONFIGURED_PATHS });
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
  const supplied = { host: '127.0.0.1', port: stub.port, name: 'probe-stub-tcp' };
  const readinessPathFromConfig = CONFIGURED_PATHS.readiness;
  const livenessPathFromConfig = CONFIGURED_PATHS.liveness;
  const readinessPathServed = srv.resolvedPaths?.readiness;
  const livenessPathServed = srv.resolvedPaths?.liveness;
  const pathsDistinct = readinessPathFromConfig !== livenessPathFromConfig
    && readinessPathServed === readinessPathFromConfig
    && livenessPathServed === livenessPathFromConfig;
  let readyObs, unreadyObs, distinctnessObs, defaultAbsent;
  try {
    // Healthy GET at the CONFIGURED readiness path.
    const rid1 = randomUUID();
    const ready = await get(port, readinessPathFromConfig, { 'x-request-id': rid1 });
    const passEntry = ready.parsed?.checks?.['probe-stub-tcp'];
    readyObs = { status: ready.status, requestId: ready.requestId, echoedBody: ready.parsed?.requestIdEchoed, checks: ready.parsed?.checks };
    // Confirm the shipped default path '/ready' is NOT served (the
    // fixture routes the readiness handler to the CONFIGURED path).
    const defaultRes = await fetch(`http://127.0.0.1:${port}/ready`);
    defaultAbsent = defaultRes.status === 404;

    results.push({
      anchorAcId: 'AC-7102-1',
      verdict: pathsDistinct && defaultAbsent && ready.status === 200 && ready.parsed?.status === 'pass' && ready.requestId === rid1 ? 'pass' : 'fail',
      detail: `${AC1}  -  GET ${readinessPathFromConfig} (from probe configuration input, no shipped default) with stub tcp open on port ${stub.port} -> ${ready.status} body.status='${ready.parsed?.status}'; configured liveness path='${livenessPathFromConfig}' is distinct; the shipped default '/ready' returns ${defaultRes.status} (expect 404 = default absent). Observes AC-7102-1 configuration-sourced-path + distinct-from-liveness + 200-on-healthy clauses.`,
      evidence: {
        suppliedInput: rid1,
        derivedResponseHeader: ready.requestId,
        readinessPathFromConfig,
        livenessPathDistinct: `configured='${livenessPathFromConfig}' vs readiness='${readinessPathFromConfig}'`,
        readinessPathServedByFixture: readinessPathServed,
        livenessPathServedByFixture: livenessPathServed,
        defaultReadyStatus: defaultRes.status,
        defaultAbsent,
        pathsDistinct,
        suppliedDependency: supplied,
        observed: readyObs,
        bodyExcerpt: ready.body.slice(0, 300),
      },
    });
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_7103_1,
      verdict: ready.parsed?.checks && typeof ready.parsed.checks === 'object' && Object.keys(ready.parsed.checks).length === 1 && passEntry ? 'pass' : 'fail',
      detail: `AC-7103-1 boot-declaration: checks object keys=${JSON.stringify(Object.keys(ready.parsed?.checks || {}))}; the boot-refusal clause on AC-7103-1 (missing or malformed declaration refused at boot) is not observed here.`,
      evidence: { checksKeys: Object.keys(ready.parsed?.checks || {}), entry: passEntry },
    });
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_7103_2,
      verdict: passEntry && (passEntry.state === 'pass' || passEntry.state === 'fail') && typeof passEntry.checkedAt === 'string' && !Number.isNaN(Date.parse(passEntry.checkedAt)) && (Date.now() - Date.parse(passEntry.checkedAt)) <= 5000 ? 'pass' : 'fail',
      detail: `AC-7103-2 checked-at budget: checks['probe-stub-tcp'] state='${passEntry?.state}' checkedAt='${passEntry?.checkedAt}'; state in {pass,fail} AND ISO-8601 checkedAt observed. Evaluation-budget upper bound is a probe-authored 5000 ms constant, not a fixture-configured value.`,
      evidence: { entry: passEntry },
    });

    // Distinctness observation: GET the configured LIVENESS path,
    // confirm the response is the liveness body shape (no checks{}).
    const ridDistinct = randomUUID();
    const distinct = await get(port, livenessPathFromConfig, { 'x-request-id': ridDistinct });
    distinctnessObs = { status: distinct.status, requestId: distinct.requestId, hasChecks: Boolean(distinct.parsed?.checks), bodyStatus: distinct.parsed?.status };
    results.push({
      anchorAcId: 'AC-7102-1',
      verdict: pathsDistinct && distinct.status === 200 && distinct.parsed?.status === 'pass' && distinctnessObs.hasChecks === false && distinct.requestId === ridDistinct ? 'pass' : 'fail',
      detail: `${AC1}  -  distinctness: GET ${livenessPathFromConfig} (liveness) -> ${distinct.status} body.status='${distinct.parsed?.status}' checks-present=${distinctnessObs.hasChecks} (readiness body shape carries a checks object; liveness body shape does not). Observes AC-7102-1 readiness-distinct-from-liveness clause.`,
      evidence: {
        suppliedInput: ridDistinct,
        derivedResponseHeader: distinct.requestId,
        readinessPathFromConfig,
        livenessPathDistinct: `configured='${livenessPathFromConfig}' vs readiness='${readinessPathFromConfig}'`,
        observed: distinctnessObs,
        bodyExcerpt: distinct.body.slice(0, 300),
      },
    });

    // Unhealthy GET at the CONFIGURED readiness path.
    await new Promise((resolve, reject) => stub.server.close((err) => (err ? reject(err) : resolve())));
    stubClosed = true;
    const rid2 = randomUUID();
    const unready = await get(port, readinessPathFromConfig, { 'x-request-id': rid2 });
    const failEntry = unready.parsed?.checks?.['probe-stub-tcp'];
    unreadyObs = { status: unready.status, requestId: unready.requestId, checks: unready.parsed?.checks, unreadyDependencies: unready.parsed?.unreadyDependencies };
    results.push({
      anchorAcId: 'AC-7102-1',
      verdict: pathsDistinct && unready.status === 503 && unready.parsed?.status === 'fail' && unready.requestId === rid2 && failEntry?.state === 'fail' ? 'pass' : 'fail',
      detail: `${AC1}  -  after stub tcp closed on port ${stub.port}: GET ${readinessPathFromConfig} -> ${unready.status} body.status='${unready.parsed?.status}' checks['probe-stub-tcp'].state='${failEntry?.state}'; observes AC-7102-1 503+body.status='fail' clause on the configured path.`,
      evidence: {
        suppliedInput: rid2,
        derivedResponseHeader: unready.requestId,
        readinessPathFromConfig,
        livenessPathDistinct: `configured='${livenessPathFromConfig}' vs readiness='${readinessPathFromConfig}'`,
        closedDependency: supplied,
        observed: unreadyObs,
        entry: failEntry,
        bodyExcerpt: unready.body.slice(0, 300),
      },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, suppliedDependency: supplied, configuredPaths: CONFIGURED_PATHS, resolvedPaths: srv.resolvedPaths, readyObserved: readyObs, unreadyObserved: unreadyObs, distinctnessObserved: distinctnessObs, defaultReadyPathAbsent: defaultAbsent } };
}
