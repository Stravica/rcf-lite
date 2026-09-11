// category-vocabulary probe for application-error-handling v1.0.3.
//
// Verifies that constructed records honour the ADR-1702 category
// vocabulary (REQ-003). Iterates every recommended category, calls
// /construct/<category>, asserts the response carries the same
// category verbatim, and rejects an unknown category with 400.
//
// anchorReqId: application-error-handling-REQ-003.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-error-handling-REQ-003';
export const accountBound = false;

const RECOMMENDED = ['validation', 'authorization', 'notFound', 'conflict', 'downstream', 'internal'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    for (const cat of RECOMMENDED) {
      const res = await fetch(`${fixture.baseUrl}/construct/${cat}`);
      const body = await res.text();
      const rec = JSON.parse(body);
      const pass = res.status === 200 && rec.category === cat;
      results.push({
        anchorReqId: 'application-error-handling-REQ-003',
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `/construct/${cat} returned record with category="${cat}"`
          : `category fault: cat=${cat} status=${res.status} returnedCategory=${rec.category}`,
        evidence: evidenceFromResponse({ route: `/construct/${cat}`, response: res, bodyText: body, extraFields: { requestedCategory: cat, returnedCategory: rec.category } }),
      });
    }

    const bad = await fetch(`${fixture.baseUrl}/construct/notARealCategory`);
    const badBody = await bad.text();
    const badPass = bad.status === 400 && JSON.parse(badBody).error === 'unknown category';
    results.push({
      anchorReqId: 'application-error-handling-REQ-003',
      verdict: badPass ? 'pass' : 'fail',
      detail: badPass
        ? 'unknown category rejected with 400'
        : `unknown-category fault: status=${bad.status} body=${badBody.slice(0, 120)}`,
      evidence: evidenceFromResponse({ route: '/construct/notARealCategory', response: bad, bodyText: badBody }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
