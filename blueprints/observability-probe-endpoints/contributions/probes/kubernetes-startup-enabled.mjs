// Kubernetes-startup-enabled probe for observability-probe-endpoints.
// Resolves the shipped 'kubernetes' profile with startup.enabled=true
// (per AC-14102-4) and materialises it with real HTTP round-trips
// against the fixture. VARIES the input (probe supplies a distinct
// x-request-id header per call). Asserts pre-ready GET /startup
// returns HTTP 503 with body.status='fail' and post-markStartupReady()
// GET /startup returns HTTP 200 with body.status='pass'.
//
// Anchor: AC-14102-4. Every detail line begins with the first eight
// words of the AC text.
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
  const resolved = resolveProfile('kubernetes', { startup: { enabled: true } });
  const inst = await materialise({ profile: resolved, listenerPort: primaryPort() });
  const suppliedStarting = randomUUID();
  const suppliedReady = randomUUID();
  let starting, ready;
  try {
    starting = await get(`http://127.0.0.1:${inst.requestPort}/startup`, suppliedStarting);
    results.push({
      anchorAcId: 'AC-14102-4',
      verdict: starting.status === 503 && starting.requestId === suppliedStarting && starting.parsed?.status === 'fail' && starting.parsed?.profile === 'kubernetes' ? 'pass' : 'fail',
      detail: `${AC4} shipped kubernetes profile  -  observed pre-ready GET /startup -> ${starting.status} body.status='${starting.parsed?.status}'; echoed requestId=${starting.requestId === suppliedStarting}.`,
      evidence: { variedInput: suppliedStarting, suppliedInput: suppliedStarting, derived: { status: starting.status, requestId: starting.requestId, bodyExcerpt: starting.body.slice(0, 300) }, derivedStarting: { status: starting.status, requestId: starting.requestId, bodyExcerpt: starting.body.slice(0, 300) } },
    });
    inst.markStartupReady();
    ready = await get(`http://127.0.0.1:${inst.requestPort}/startup`, suppliedReady);
    results.push({
      anchorAcId: 'AC-14102-4',
      verdict: ready.status === 200 && ready.requestId === suppliedReady && ready.parsed?.status === 'pass' && ready.parsed?.profile === 'kubernetes' ? 'pass' : 'fail',
      detail: `${AC4} shipped kubernetes profile  -  observed post-markStartupReady GET /startup -> ${ready.status} body.status='${ready.parsed?.status}'; echoed requestId=${ready.requestId === suppliedReady}.`,
      evidence: { variedInput: suppliedReady, suppliedInput: suppliedReady, derived: { status: ready.status, requestId: ready.requestId, bodyExcerpt: ready.body.slice(0, 300) }, derivedReady: { status: ready.status, requestId: ready.requestId, bodyExcerpt: ready.body.slice(0, 300) } },
    });
  } finally { await inst.close(); }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'], boundPort: inst.requestPort,
    variedInputs: { starting: suppliedStarting, ready: suppliedReady },
    derivedStarting: starting && { status: starting.status, requestId: starting.requestId, bodyExcerpt: starting.body.slice(0, 300) },
    derivedReady: ready && { status: ready.status, requestId: ready.requestId, bodyExcerpt: ready.body.slice(0, 300) },
  } };
}
