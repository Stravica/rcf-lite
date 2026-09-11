// health-probes-distinct probe for application-api-rest v2.1.5.
//
// Verifies that the service exposes three distinct health probes
// (livez / readyz / startupz per REQ-006), each returning 200 with
// a body naming which probe answered. Records the response identifier
// and body excerpt for each probe.
//
// anchorReqId: application-api-rest-REQ-006.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-006';
export const accountBound = false;

const PROBES = [
  { route: '/livez', label: 'alive' },
  { route: '/readyz', label: 'ready' },
  { route: '/startupz', label: 'started' },
];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    for (const p of PROBES) {
      const res = await fetch(`${fixture.baseUrl}${p.route}`);
      const body = await res.text();
      const parsed = JSON.parse(body);
      const pass = res.status === 200 && parsed.status === p.label;
      results.push({
        anchorReqId: 'application-api-rest-REQ-006',
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `GET ${p.route} returned status="${p.label}"`
          : `health fault at ${p.route}: status=${res.status} body=${body.slice(0, 120)}`,
        evidence: evidenceFromResponse({ route: p.route, response: res, bodyText: body }),
      });
    }
    return { results };
  } finally {
    await fixture.close();
  }
}
