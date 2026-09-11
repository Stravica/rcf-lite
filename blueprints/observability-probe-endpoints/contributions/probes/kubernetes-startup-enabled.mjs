// Kubernetes-startup-enabled probe for observability-probe-endpoints v1.2.1.
// Materialises the 'kubernetes-startup' profile and asserts /startup
// returns 503 (starting) before markStartupReady() and 200 (ready)
// after. The response bodies name the profile and startup phase.
// Real HTTP round-trips.
// anchorAcId: AC-14102-1. accountBound: false.

import { materialise, SHIPPED_PROFILES } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';
import { primaryPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-14102-1';
export const accountBound = false;

export default async function runProbe() {
  const results = [];
  const inst = await materialise({ profile: SHIPPED_PROFILES['kubernetes-startup'], listenerPort: primaryPort() });
  let starting, ready;
  try {
    starting = await fetch(`http://127.0.0.1:${inst.requestPort}/startup`);
    const startingBody = await starting.text();
    results.push({
      anchorAcId: 'AC-14102-1',
      verdict: starting.status === 503 && JSON.parse(startingBody).status === 'starting' ? 'pass' : 'fail',
      detail: `pre-ready GET /startup -> ${starting.status}; requestId=${starting.headers.get('x-request-id')}`,
      evidence: { status: starting.status, requestId: starting.headers.get('x-request-id'), body: startingBody },
    });
    inst.markStartupReady();
    ready = await fetch(`http://127.0.0.1:${inst.requestPort}/startup`);
    const readyBody = await ready.text();
    results.push({
      anchorAcId: 'AC-14102-2',
      verdict: ready.status === 200 && JSON.parse(readyBody).status === 'ready' ? 'pass' : 'fail',
      detail: `post-markStartupReady GET /startup -> ${ready.status}; requestId=${ready.headers.get('x-request-id')}`,
      evidence: { status: ready.status, requestId: ready.headers.get('x-request-id'), body: readyBody },
    });
  } finally {
    await inst.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'] } };
}
