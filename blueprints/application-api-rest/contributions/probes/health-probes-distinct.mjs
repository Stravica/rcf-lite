// health-probes-distinct probe for application-api-rest v2.1.7.
//
// Verifies AC-2108-1 (liveness), AC-2108-2 (readiness with declared
// dependency checks) and AC-2108-4 (startup with pending-step
// enumeration). Each probe endpoint answers its own question and
// carries a body distinguishable from the others. Row anchoring
// splits per AC so a defect at one probe surfaces on its own line.
//
// anchorAcId: application-api-rest-AC-2108-1 (per-row: -1, -2, -4).

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-006';
export const accountBound = false;

const PROBES = [
  { route: '/livez', label: 'alive', expectField: 'probe', expectValue: 'livez', ac: 'application-api-rest-AC-2108-1', expectExtra: () => true },
  { route: '/readyz', label: 'ready', expectField: 'probe', expectValue: 'readyz', ac: 'application-api-rest-AC-2108-2', expectExtra: (p) => Array.isArray(p.checks) && p.checks.length >= 1 },
  { route: '/startupz', label: 'started', expectField: 'probe', expectValue: 'startupz', ac: 'application-api-rest-AC-2108-4', expectExtra: (p) => Array.isArray(p.pending) },
];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    for (const p of PROBES) {
      const res = await fetch(`${fixture.baseUrl}${p.route}`);
      const body = await res.text();
      const parsed = JSON.parse(body);
      const answered = parsed.status === p.label && parsed[p.expectField] === p.expectValue;
      const extra = p.expectExtra(parsed);
      const pass = res.status === 200 && answered && extra;
      results.push({
        anchorAcId: p.ac,
        anchorReqId: 'application-api-rest-REQ-006',
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `Probe endpoints: liveness, readiness, and startup with specified - GET ${p.route} returned probe="${p.expectValue}" status="${p.label}" with the AC-specific body extension`
          : `Probe endpoints: liveness, readiness, and startup with specified - health fault at ${p.route}: httpStatus=${res.status} answered=${answered} extraShape=${extra} body=${body.slice(0, 120)}`,
        evidence: evidenceFromResponse({
          route: p.route,
          response: res,
          bodyText: body,
          extraFields: {
            input: { route: p.route },
            derived: { probeLabel: parsed.probe, status: parsed.status, extraShape: extra },
          },
        }),
      });
    }
    return { results };
  } finally {
    await fixture.close();
  }
}
