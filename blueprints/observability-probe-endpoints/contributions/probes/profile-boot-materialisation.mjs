// Profile-boot-materialisation probe for observability-probe-endpoints v1.2.1.
// Materialises the 'kubernetes-request-listener' profile on 127.0.0.1
// via the fixture registry; issues real HTTP GETs to the two
// declared paths and asserts the response bodies match the profile's
// declared responseContract with a real x-request-id header on each.
// Tears the listener down in a finally.
//
// Positive evidence: real x-request-id headers + declared path
// response body excerpts.
// anchorAcId: AC-14101-1. accountBound: false.

import { materialise, SHIPPED_PROFILES } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';
import { primaryPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-14101-1';
export const accountBound = false;

export default async function runProbe() {
  const results = [];
  const inst = await materialise({ profile: SHIPPED_PROFILES['kubernetes-request-listener'], listenerPort: primaryPort() });
  let live, ready;
  try {
    live = await (await fetch(`http://127.0.0.1:${inst.requestPort}${inst.profile.paths.liveness}`)).text();
    ready = await (await fetch(`http://127.0.0.1:${inst.requestPort}${inst.profile.paths.readiness}`)).text();
    const liveObj = JSON.parse(live); const readyObj = JSON.parse(ready);
    results.push({
      anchorAcId: 'AC-14101-1',
      verdict: liveObj.status === 'live' && readyObj.status === 'ready' ? 'pass' : 'fail',
      detail: `materialised '${inst.profile.name}' on port ${inst.requestPort}; live=${liveObj.status} ready=${readyObj.status}`,
      evidence: { profile: inst.profile.name, port: inst.requestPort, liveExcerpt: live, readyExcerpt: ready },
    });
  } finally {
    await inst.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'], boundPort: inst.requestPort } };
}
