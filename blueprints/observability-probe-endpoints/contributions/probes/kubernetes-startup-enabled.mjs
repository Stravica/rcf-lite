// Kubernetes-startup-enabled probe for observability-probe-endpoints.
// Materialises the 'kubernetes-startup' profile with real HTTP round-
// trips against the fixture, VARIES the input (probe supplies a
// distinct x-request-id header per call) and observes the derived
// echo on the response. Asserts /startup returns 503 with body.status
// 'starting' before markStartupReady(), and 200 with body.status
// 'ready' after. Each response's request-id is asserted to equal
// the varied input, so both sides are not merely echoing an authored
// constant.
// anchorAcId: AC-14102-1. accountBound: false.

import { randomUUID } from 'node:crypto';
import { materialise, SHIPPED_PROFILES } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';
import { primaryPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-14102-1';
export const accountBound = false;

async function get(url, rid) {
  const res = await fetch(url, { headers: { 'x-request-id': rid } });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, requestId: res.headers.get('x-request-id'), body: text, parsed };
}

export default async function runProbe() {
  const results = [];
  const inst = await materialise({ profile: SHIPPED_PROFILES['kubernetes-startup'], listenerPort: primaryPort() });
  const suppliedStarting = randomUUID();
  const suppliedReady = randomUUID();
  let starting, ready;
  try {
    starting = await get(`http://127.0.0.1:${inst.requestPort}/startup`, suppliedStarting);
    results.push({
      anchorAcId: 'AC-14102-1',
      verdict: starting.status === 503 && starting.requestId === suppliedStarting && starting.parsed?.status === 'starting' && starting.parsed?.profile === inst.profile.name ? 'pass' : 'fail',
      detail: `pre-ready GET /startup -> ${starting.status}; echoed requestId=${starting.requestId === suppliedStarting}; body.status=${starting.parsed?.status}`,
      evidence: { variedInput: suppliedStarting, derived: { status: starting.status, requestId: starting.requestId, bodyExcerpt: starting.body.slice(0, 300) } },
    });
    inst.markStartupReady();
    ready = await get(`http://127.0.0.1:${inst.requestPort}/startup`, suppliedReady);
    results.push({
      anchorAcId: 'AC-14102-2',
      verdict: ready.status === 200 && ready.requestId === suppliedReady && ready.parsed?.status === 'ready' && ready.parsed?.profile === inst.profile.name ? 'pass' : 'fail',
      detail: `post-markStartupReady GET /startup -> ${ready.status}; echoed requestId=${ready.requestId === suppliedReady}; body.status=${ready.parsed?.status}`,
      evidence: { variedInput: suppliedReady, derived: { status: ready.status, requestId: ready.requestId, bodyExcerpt: ready.body.slice(0, 300) } },
    });
  } finally {
    await inst.close();
  }
  return {
    results,
    extra: {
      envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'],
      boundPort: inst.requestPort,
      variedInputs: { starting: suppliedStarting, ready: suppliedReady },
      derivedStarting: starting && { status: starting.status, requestId: starting.requestId, bodyExcerpt: starting.body.slice(0, 300) },
      derivedReady: ready && { status: ready.status, requestId: ready.requestId, bodyExcerpt: ready.body.slice(0, 300) },
    },
  };
}
