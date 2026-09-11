// Status-page probe for observability-essentials (kept under the
// legacy metrics-endpoint filename so the run-metrics-endpoint.mjs
// wrapper and the anatomy test's PROBES list continue to resolve
// without shipping a rename in the same fix pass; the file's
// contents observe the AC-7104 status-page contract exactly, per
// closure guidance that the previous metrics-endpoint anchoring was
// wrong because no essentials AC covers /metrics behaviour).
// Anchors AC-7104-1/2/3 by asking the fixture for /status with
// declared components in mixed states. Every detail line begins
// with the first eight words of the anchored AC text.
import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7104-1';
export const accountBound = false;
const AC1 = 'The application serves the status page at a';
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
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    contentType = res.headers.get('content-type');
    firstBody = await res.text();
    const parsed = parseComponents(firstBody);
    results.push({
      anchorAcId: 'AC-7104-1',
      verdict: res.status === 200 && (contentType || '').startsWith('text/html') && parsed.length === DECLARED.length ? 'pass' : 'fail',
      detail: `${AC1} stable HTTP path  -  observed GET /status -> ${res.status} content-type='${contentType}'; rendered ${parsed.length} component elements against ${DECLARED.length} declared components (bodyExcerpt='${firstBody.slice(0, 200)}').`,
      evidence: { status: res.status, contentType, componentsFound: parsed.length, componentsDeclared: DECLARED.length, bodyExcerpt: firstBody.slice(0, 500), parsedComponents: parsed },
    });
    const invalidState = parsed.find((c) => !ALLOWED_STATES.has(c.stateAttr));
    results.push({
      anchorAcId: 'AC-7104-2',
      verdict: parsed.length > 0 && !invalidState ? 'pass' : 'fail',
      detail: `${AC2} as a machine-readable attribute drawn from  -  observed every rendered component's data-state attribute is one of {operational,degraded,outage,maintenance}; invalidStateFound=${invalidState ? JSON.stringify(invalidState) : 'none'}.`,
      evidence: { stateAttrs: parsed.map((c) => c.stateAttr), invalid: invalidState || null },
    });
    const orderMatches = parsed.length === DECLARED.length && parsed.every((c, i) => c.nameAttr === DECLARED[i].name);
    results.push({
      anchorAcId: 'AC-7104-3',
      verdict: orderMatches ? 'pass' : 'fail',
      detail: `${AC3} the declaration order in configuration  -  observed rendered order=${JSON.stringify(parsed.map((c) => c.nameAttr))}; declared order=${JSON.stringify(DECLARED.map((c) => c.name))}; matches=${orderMatches}.`,
      evidence: { renderedOrder: parsed.map((c) => c.nameAttr), declaredOrder: DECLARED.map((c) => c.name), matches: orderMatches, bodyExcerpt: firstBody.slice(0, 500) },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, declaredComponents: DECLARED, contentType, statusPageBodyExcerpt: (firstBody || '').slice(0, 500) } };
}
