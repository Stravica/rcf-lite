// Status-page probe for observability-essentials (kept under the
// legacy metrics-endpoint filename so the run-metrics-endpoint.mjs
// wrapper and the anatomy test's PROBES list continue to resolve
// without shipping a rename in the same patch).
//
// Anchors AC-7104-2 and AC-7104-3 by asking the fixture for /status
// with declared components in mixed states. AC-7104-2 requires each
// component's state attribute to EQUAL the declared current state
// AND be drawn from the fixed enum. AC-7104-3 requires render order
// equals declaration order. AC-7104-1 (configured-path clause) is
// de-claimed to conformanceOnly: the shipped probe-server hard-codes
// '/status' rather than accepting a paths.status option, so the
// configuration-provenance property is not observed here (the strict-evidence contract).
// Every retained row records the server-echoed x-request-id header
// as its identifier alongside the derived rendered lists.
// Every detail line begins with the first eight words of the anchored
// AC text.
import { randomUUID } from 'node:crypto';
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7104-2';
export const accountBound = false;
const AC2 = 'Each rendered component element carries its current state';
const AC3 = 'The component render order on the page matches';

const DECLARED = [
  { name: 'api', state: 'operational' },
  { name: 'jobs', state: 'degraded' },
  { name: 'billing', state: 'outage' },
  { name: 'search', state: 'maintenance' },
];
const ALLOWED_STATES = new Set(['operational', 'degraded', 'outage', 'maintenance']);

function parseComponents(html) {
  const parsed = [];
  const re = /<li[^>]*class="component"[^>]*data-name="([^"]*)"[^>]*data-state="([^"]*)"[^>]*>([^<]*)<\/li>/g;
  let m;
  while ((m = re.exec(html)) !== null) parsed.push({ nameAttr: m[1], stateAttr: m[2], text: m[3] });
  return parsed;
}

export default async function runProbe() {
  const srv = createProbeServer();
  srv.setComponents(DECLARED);
  const { port } = await srv.listen(envPort());
  const results = [];
  let firstBody, contentType;
  try {
    const suppliedRequestId = randomUUID();
    const res = await fetch(`http://127.0.0.1:${port}/status`, { headers: { 'x-request-id': suppliedRequestId } });
    contentType = res.headers.get('content-type');
    const echoedRequestId = res.headers.get('x-request-id');
    firstBody = await res.text();
    const parsed = parseComponents(firstBody);
    // AC-7104-1: exact declared list (count AND each rendered name
    // equals declared name at same position AND text content equals
    // the declared name). Row de-claimed (conformanceOnly, the strict-evidence contract)
    // because the shipped probe-server hard-codes '/status' rather
    // than accepting a paths.status option; the configured-path
    // clause on AC-7104-1 is not observed here.
    const namesMatch = parsed.length === DECLARED.length && parsed.every((c, i) => c.nameAttr === DECLARED[i].name && c.text === DECLARED[i].name);
    const declaredSet = new Set(DECLARED.map((d) => d.name));
    const renderedSet = new Set(parsed.map((c) => c.nameAttr));
    const phantom = [...renderedSet].filter((n) => !declaredSet.has(n));
    const missing = [...declaredSet].filter((n) => !renderedSet.has(n));
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: `AC-7104-1: the configured-path clause requires the fixture to accept an explicit paths.status option and refuse when the shipped default is used unwrapped. This probe uses the hard-coded '/status' path in both the probe and the fixture, so configuration provenance is not observed here.`,
      verdict: res.status === 200 && (contentType || '').startsWith('text/html') && namesMatch && phantom.length === 0 && missing.length === 0 ? 'pass' : 'fail',
      detail: `observed GET /status -> ${res.status} content-type='${contentType}'; rendered ${parsed.length} components; declared=${JSON.stringify(DECLARED.map((d) => d.name))}; rendered=${JSON.stringify(parsed.map((c) => c.nameAttr))}; phantom=${JSON.stringify(phantom)}; missing=${JSON.stringify(missing)}; namesAndTextMatch=${namesMatch}. AC-7104-1 configured-path clause not exercised.`,
      evidence: { status: res.status, contentType, componentsFound: parsed.length, componentsDeclared: DECLARED.length, bodyExcerpt: firstBody.slice(0, 500), declared: DECLARED.map((d) => d.name), rendered: parsed.map((c) => c.nameAttr), phantom, missing },
    });
    // AC-7104-2: each state EQUALS declared state AND is in enum.
    const enumOk = parsed.length > 0 && parsed.every((c) => ALLOWED_STATES.has(c.stateAttr));
    const equalityOk = parsed.length === DECLARED.length && parsed.every((c, i) => c.stateAttr === DECLARED[i].state);
    const mismatches = parsed.map((c, i) => ({ name: c.nameAttr, rendered: c.stateAttr, declared: DECLARED[i]?.state })).filter((r) => r.rendered !== r.declared);
    results.push({
      anchorAcId: 'AC-7104-2',
      verdict: enumOk && equalityOk && echoedRequestId === suppliedRequestId ? 'pass' : 'fail',
      detail: `${AC2} as a machine-readable attribute drawn from  -  observed every rendered component's data-state; suppliedInput='${suppliedRequestId}' echoedHeader='${echoedRequestId}' echoMatches=${echoedRequestId === suppliedRequestId}; enumMembership=${enumOk}; equalsDeclaredState=${equalityOk}; mismatches=${JSON.stringify(mismatches)}.`,
      evidence: { suppliedInput: suppliedRequestId, derivedResponseHeader: echoedRequestId, stateAttrs: parsed.map((c) => c.stateAttr), declaredStates: DECLARED.map((d) => d.state), enumMembership: enumOk, equalsDeclared: equalityOk, mismatches, bodyExcerpt: firstBody.slice(0, 500) },
    });
    const orderMatches = parsed.length === DECLARED.length && parsed.every((c, i) => c.nameAttr === DECLARED[i].name);
    results.push({
      anchorAcId: 'AC-7104-3',
      verdict: orderMatches && echoedRequestId === suppliedRequestId ? 'pass' : 'fail',
      detail: `${AC3} the declaration order in configuration  -  observed rendered order=${JSON.stringify(parsed.map((c) => c.nameAttr))}; declared order=${JSON.stringify(DECLARED.map((c) => c.name))}; matches=${orderMatches}; suppliedInput='${suppliedRequestId}' echoedHeader='${echoedRequestId}'.`,
      evidence: { suppliedInput: suppliedRequestId, derivedResponseHeader: echoedRequestId, renderedOrder: parsed.map((c) => c.nameAttr), declaredOrder: DECLARED.map((c) => c.name), matches: orderMatches, bodyExcerpt: firstBody.slice(0, 500) },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, declaredComponents: DECLARED, contentType, statusPageBodyExcerpt: (firstBody || '').slice(0, 500) } };
}
