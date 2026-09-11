// category-vocabulary probe for application-error-handling v1.0.5.
//
// Verifies the ADR-1702 recommended default vocabulary (transient,
// permanent, unknown) via REQ-003 for the pass rows and AC-16105-4
// for the unelicited-token refusal row.
//
// anchorReqId: application-error-handling-REQ-003 on the accepted
// vocabulary rows; anchorAcId: application-error-handling-AC-16105-4
// on the refusal row.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-error-handling-REQ-003';
export const accountBound = false;

const RECOMMENDED = ['transient', 'permanent', 'unknown'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
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
        evidence: evidenceFromResponse({
          route: `/construct/${cat}`,
          response: res,
          bodyText: body,
          extraFields: {
            input: { requestedCategory: cat },
            derived: { returnedCategory: rec.category },
          },
        }),
      });
    }

    // AC-16105-4 refusal path: an unelicited token is refused, not
    // silently mapped. The fixture returns 400 with a body naming
    // the refused token and the accepted set.
    const bad = await fetch(`${fixture.baseUrl}/construct/notARealCategory`);
    const badBody = await bad.text();
    const badParsed = JSON.parse(badBody);
    const refusalOk = bad.status === 400
      && badParsed.error === 'unelicited-category'
      && badParsed.refused === 'notARealCategory'
      && Array.isArray(badParsed.accepted)
      && RECOMMENDED.every((c) => badParsed.accepted.includes(c));
    results.push({
      anchorAcId: 'application-error-handling-AC-16105-4',
      anchorReqId: 'application-error-handling-REQ-003',
      verdict: refusalOk ? 'pass' : 'fail',
      detail: refusalOk
        ? 'unelicited category refused at record construction (400 with refused/accepted body)'
        : `refusal fault: status=${bad.status} error=${badParsed.error} refused=${badParsed.refused} accepted=${JSON.stringify(badParsed.accepted)}`,
      evidence: evidenceFromResponse({
        route: '/construct/notARealCategory',
        response: bad,
        bodyText: badBody,
        extraFields: {
          input: { requestedCategory: 'notARealCategory' },
          derived: { httpStatus: bad.status, refused: badParsed.refused, accepted: badParsed.accepted },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
