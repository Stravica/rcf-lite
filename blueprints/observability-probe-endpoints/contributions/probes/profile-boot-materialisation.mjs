// Profile-boot-materialisation probe for observability-probe-endpoints.
//
// Resolves the shipped 'kubernetes' profile and materialises it on
// 127.0.0.1 via the fixture registry; issues real HTTP GETs to the
// resolved liveness and readiness paths with a probe-varied
// x-request-id header per request. Records the response header echo
// and body excerpt and asserts the resolved profile name equals
// 'kubernetes' and the bound listener answers on the profile's
// declared paths.
//
// AC-14101-1 additionally requires observation of fused/separate port
// topology AND absence of handlers outside the resolved path set.
// This row observes only bound-path behaviour; it does not check
// port topology or verify no additional handlers were bound. Row
// de-claimed (conformanceOnly, anchorAcId=null) with the limitation
// naming AC-14101-1.

import { randomUUID } from 'node:crypto';
import { materialise, resolveProfile } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';
import { primaryPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-14101-1';
export const accountBound = false;
const LIM_14101_1 = `AC-14101-1: requires a process configured with probeInterface.profile: kubernetes to bind probe handlers whose paths match the resolved profile AND to observe fused/separate port topology AND absence of handlers outside the resolved path set. This row observes bound-path behaviour (liveness and readiness respond 200 with body.status='pass') but does not verify port-topology or handler-absence clauses.`;

async function get(url, rid) {
  const res = await fetch(url, { headers: { 'x-request-id': rid } });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, requestId: res.headers.get('x-request-id'), contentType: res.headers.get('content-type'), body: text, parsed };
}

export default async function runProbe() {
  const results = [];
  const resolved = resolveProfile('kubernetes');
  const inst = await materialise({ profile: resolved, listenerPort: primaryPort() });
  const suppliedLive = randomUUID();
  const suppliedReady = randomUUID();
  let live, ready;
  try {
    live = await get(`http://127.0.0.1:${inst.requestPort}${inst.profile.paths.liveness}`, suppliedLive);
    ready = await get(`http://127.0.0.1:${inst.requestPort}${inst.profile.paths.readiness}`, suppliedReady);
    const liveOk = live.status === 200 && live.requestId === suppliedLive && live.parsed?.status === 'pass' && live.parsed?.profile === 'kubernetes' && live.parsed?.kind === 'liveness';
    const readyOk = ready.status === 200 && ready.requestId === suppliedReady && ready.parsed?.status === 'pass' && ready.parsed?.profile === 'kubernetes' && ready.parsed?.kind === 'readiness';
    const nameOk = inst.profile.name === 'kubernetes';
    const pathsOk = inst.profile.paths.liveness === '/live' && inst.profile.paths.readiness === '/ready';
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_14101_1,
      verdict: liveOk && readyOk && nameOk && pathsOk ? 'pass' : 'fail',
      detail: `observed resolved profile.name='${inst.profile.name}' paths=${JSON.stringify(inst.profile.paths)} on port ${inst.requestPort}; live status=${live.status} echoed rid=${live.requestId === suppliedLive} body.status='${live.parsed?.status}' body.profile='${live.parsed?.profile}'; ready status=${ready.status} echoed rid=${ready.requestId === suppliedReady} body.status='${ready.parsed?.status}' body.profile='${ready.parsed?.profile}'.`,
      evidence: {
        acceptedProfile: inst.profile.name,
        resolvedTransport: inst.profile.transport,
        resolvedPaths: inst.profile.paths,
        port: inst.requestPort,
        variedInputs: { liveness: suppliedLive, readiness: suppliedReady },
        derivedLive: { status: live.status, requestId: live.requestId, contentType: live.contentType, bodyExcerpt: live.body.slice(0, 300) },
        derivedReady: { status: ready.status, requestId: ready.requestId, contentType: ready.contentType, bodyExcerpt: ready.body.slice(0, 300) },
      },
    });
  } finally { await inst.close(); }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'], boundPort: inst.requestPort,
    variedInputs: { liveness: suppliedLive, readiness: suppliedReady },
    derivedLive: live && { status: live.status, requestId: live.requestId, contentType: live.contentType, bodyExcerpt: live.body.slice(0, 300) },
    derivedReady: ready && { status: ready.status, requestId: ready.requestId, contentType: ready.contentType, bodyExcerpt: ready.body.slice(0, 300) },
  } };
}
