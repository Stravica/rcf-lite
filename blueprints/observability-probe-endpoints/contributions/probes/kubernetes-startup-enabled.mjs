// Kubernetes-startup-enabled probe for observability-probe-endpoints.
//
// Anchors AC-14102-4. The AC has two clauses:
//   - enabled: probeInterface.options.kubernetes.startup.enabled=true
//     -> resolver returns a three-path set including /startup; first
//     GET on /startup returns 503 body {status:fail}; a second GET
//     after the predicate returns pass returns 200 body {status:pass}.
//   - disabled (without the enable flag): resolver returns two paths
//     and no /startup handler is registered.
// This probe exercises BOTH clauses.

import { randomUUID } from 'node:crypto';
import { materialise, resolveProfile } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';
import { primaryPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-14102-4';
export const accountBound = false;
const AC4 = 'When the operator sets probeInterface.options.kubernetes.startup.enabled: true on the';

async function get(url, rid) {
  const res = await fetch(url, { headers: { 'x-request-id': rid } });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, requestId: res.headers.get('x-request-id'), body: text, parsed };
}

export default async function runProbe() {
  const results = [];

  // ENABLED clause
  const resolvedEnabled = resolveProfile('kubernetes', { startup: { enabled: true } });
  const enabledPathCount = Object.keys(resolvedEnabled.paths ?? {}).length;
  const enabledHasStartup = Boolean(resolvedEnabled.paths?.startup);
  const inst = await materialise({ profile: resolvedEnabled, listenerPort: primaryPort() });
  const suppliedStarting = randomUUID();
  const suppliedReady = randomUUID();
  let starting, ready;
  try {
    starting = await get(`http://127.0.0.1:${inst.requestPort}/startup`, suppliedStarting);
    results.push({
      anchorAcId: 'AC-14102-4',
      verdict: enabledPathCount === 3 && enabledHasStartup && starting.status === 503 && starting.requestId === suppliedStarting && starting.parsed?.status === 'fail' && starting.parsed?.profile === 'kubernetes' ? 'pass' : 'fail',
      detail: `${AC4} shipped kubernetes profile  -  ENABLED clause: paths=${JSON.stringify(Object.keys(resolvedEnabled.paths ?? {}))} startup path='${resolvedEnabled.paths?.startup}'; pre-ready GET /startup -> ${starting.status} body.status='${starting.parsed?.status}'; echoed requestId=${starting.requestId === suppliedStarting}.`,
      evidence: { variedInput: suppliedStarting, suppliedInput: suppliedStarting, derived: { status: starting.status, requestId: starting.requestId, bodyExcerpt: starting.body.slice(0, 300) }, derivedStarting: { status: starting.status, requestId: starting.requestId, bodyExcerpt: starting.body.slice(0, 300) } },
    });
    inst.markStartupReady();
    ready = await get(`http://127.0.0.1:${inst.requestPort}/startup`, suppliedReady);
    results.push({
      anchorAcId: 'AC-14102-4',
      verdict: ready.status === 200 && ready.requestId === suppliedReady && ready.parsed?.status === 'pass' && ready.parsed?.profile === 'kubernetes' ? 'pass' : 'fail',
      detail: `${AC4} shipped kubernetes profile  -  ENABLED clause: post-markStartupReady GET /startup -> ${ready.status} body.status='${ready.parsed?.status}'; echoed requestId=${ready.requestId === suppliedReady}.`,
      evidence: { variedInput: suppliedReady, suppliedInput: suppliedReady, derived: { status: ready.status, requestId: ready.requestId, bodyExcerpt: ready.body.slice(0, 300) }, derivedReady: { status: ready.status, requestId: ready.requestId, bodyExcerpt: ready.body.slice(0, 300) } },
    });
  } finally { await inst.close(); }

  // DISABLED clause: no enable flag; resolver must yield two paths and
  // /startup must be a 404 (no handler registered).
  const resolvedDisabled = resolveProfile('kubernetes');
  const disabledPathCount = Object.keys(resolvedDisabled.paths ?? {}).length;
  const disabledHasStartup = Boolean(resolvedDisabled.paths?.startup);
  const inst2 = await materialise({ profile: resolvedDisabled, listenerPort: primaryPort() });
  let disabledResp;
  const disabledId = randomUUID();
  try {
    disabledResp = await get(`http://127.0.0.1:${inst2.requestPort}/startup`, disabledId);
    results.push({
      anchorAcId: 'AC-14102-4',
      verdict: disabledPathCount === 2 && !disabledHasStartup && disabledResp.status === 404 ? 'pass' : 'fail',
      detail: `${AC4} shipped kubernetes profile  -  DISABLED clause (no enable flag): paths=${JSON.stringify(Object.keys(resolvedDisabled.paths ?? {}))} (expect two paths); GET /startup -> ${disabledResp.status} (expect 404 with no /startup handler registered).`,
      evidence: { variedInput: disabledId, suppliedInput: disabledId, derived: { status: disabledResp.status, requestId: disabledResp.requestId, bodyExcerpt: disabledResp.body.slice(0, 300) }, resolvedPaths: resolvedDisabled.paths, acceptedProfile: resolvedDisabled.name },
    });
  } finally { await inst2.close(); }

  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'], boundPort: inst.requestPort,
    variedInputs: { starting: suppliedStarting, ready: suppliedReady, disabled: disabledId },
    derivedStarting: starting && { status: starting.status, requestId: starting.requestId, bodyExcerpt: starting.body.slice(0, 300) },
    derivedReady: ready && { status: ready.status, requestId: ready.requestId, bodyExcerpt: ready.body.slice(0, 300) },
    derivedDisabled: disabledResp && { status: disabledResp.status, requestId: disabledResp.requestId, bodyExcerpt: disabledResp.body.slice(0, 300) },
  } };
}
