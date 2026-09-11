// Profile-boot-materialisation probe for observability-probe-endpoints.
// Materialises 'kubernetes-request-listener' on 127.0.0.1 via the fixture
// registry; issues real HTTP GETs to /live and /ready with a probe-
// varied x-request-id header per request. Records the response header
// echo and body excerpt. Body status is 'pass' per AC-14102-1 semantics.
// Anchor: AC-14101-1 (a process configured with `probeInterface.profile:
// kubernetes` boots and binds probe handlers matching the resolved
// profile). Every detail line begins with the first eight words.
import { randomUUID } from 'node:crypto';
import { materialise, SHIPPED_PROFILES } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';
import { primaryPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-14101-1';
export const accountBound = false;
const AC1 = 'A process configured with `probeInterface.profile: kubernetes` boots and';

async function get(url, rid) {
  const res = await fetch(url, { headers: { 'x-request-id': rid } });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, requestId: res.headers.get('x-request-id'), contentType: res.headers.get('content-type'), body: text, parsed };
}

export default async function runProbe() {
  const results = [];
  const inst = await materialise({ profile: SHIPPED_PROFILES['kubernetes-request-listener'], listenerPort: primaryPort() });
  const suppliedLive = randomUUID();
  const suppliedReady = randomUUID();
  let live, ready;
  try {
    live = await get(`http://127.0.0.1:${inst.requestPort}${inst.profile.paths.liveness}`, suppliedLive);
    ready = await get(`http://127.0.0.1:${inst.requestPort}${inst.profile.paths.readiness}`, suppliedReady);
    const liveOk = live.status === 200 && live.requestId === suppliedLive && live.parsed?.status === 'pass' && live.parsed?.profile === inst.profile.name && live.parsed?.kind === 'liveness';
    const readyOk = ready.status === 200 && ready.requestId === suppliedReady && ready.parsed?.status === 'pass' && ready.parsed?.profile === inst.profile.name && ready.parsed?.kind === 'readiness';
    results.push({
      anchorAcId: 'AC-14101-1',
      verdict: liveOk && readyOk ? 'pass' : 'fail',
      detail: `${AC1}  -  observed materialised '${inst.profile.name}' on port ${inst.requestPort}; live status=${live.status} echoed rid=${live.requestId === suppliedLive} body.status='${live.parsed?.status}'; ready status=${ready.status} echoed rid=${ready.requestId === suppliedReady} body.status='${ready.parsed?.status}'.`,
      evidence: {
        profile: inst.profile.name, port: inst.requestPort,
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
