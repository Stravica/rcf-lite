// category-vocabulary probe for application-error-handling v1.0.12.
//
// Verifies the ADR-1702 recommended default vocabulary (transient,
// permanent, unknown) via REQ-003 for the pass rows and AC-16105-4
// for the unelicited-token refusal row.
//
// anchorReqId: application-error-handling-REQ-003 on the accepted
// vocabulary rows; anchorAcId: application-error-handling-AC-16105-4
// on the refusal row.

import { startFixture, evidenceFromResponse, conformanceOnlyResult } from './probe-utils.mjs';

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
          ? `Every error class is classified transient, permanent or - /construct/${cat} returned record with category="${cat}"`
          : `Every error class is classified transient, permanent or - category fault: cat=${cat} status=${res.status} returnedCategory=${rec.category}`,
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

    // AC-16105-4 partial slice: the AC covers an applying project
    // that elicited additional categories via the
    // classification-additions elicit and asserts (a) the mapper
    // reads the applied per-class contract, (b) it writes the
    // elicited retry hint alongside the ADR-1702 defaults, and
    // (c) an unelicited category token is refused at record
    // construction per REQ-002. This probe pack ships no
    // classification-additions elicit and no applied per-class
    // retry contract, so clauses (a) and (b) cannot be observed
    // here. The probe observes clause (c) only: /construct/<token>
    // returns 400 naming the refused token and the accepted set,
    // which is the record-construction refusal REQ-002 requires.
    // The row is conformanceOnly anchored on AC-16105-4 with a
    // limitation naming the two clauses not observed here.
    const bad = await fetch(`${fixture.baseUrl}/construct/notARealCategory`);
    const badBody = await bad.text();
    const badParsed = JSON.parse(badBody);
    const refusalOk = bad.status === 400
      && badParsed.error === 'unelicited-category'
      && badParsed.refused === 'notARealCategory'
      && Array.isArray(badParsed.accepted)
      && RECOMMENDED.every((c) => badParsed.accepted.includes(c));
    results.push(conformanceOnlyResult({
      anchorAcId: 'application-error-handling-AC-16105-4',
      anchorReqId: 'application-error-handling-REQ-003',
      verdict: refusalOk ? 'pass' : 'fail',
      detail: refusalOk
        ? `Given a project that elicited additional categories via - refusal-of-unelicited slice observed: /construct/notARealCategory returns 400 error=unelicited-category refused=${badParsed.refused} accepted=${JSON.stringify(badParsed.accepted)}`
        : `Given a project that elicited additional categories via - refusal fault: status=${bad.status} error=${badParsed.error} refused=${badParsed.refused} accepted=${JSON.stringify(badParsed.accepted)}`,
      evidence: evidenceFromResponse({
        route: '/construct/notARealCategory',
        response: bad,
        bodyText: badBody,
        extraFields: {
          input: { requestedCategory: 'notARealCategory' },
          derived: { httpStatus: bad.status, refused: badParsed.refused, accepted: badParsed.accepted },
        },
      }),
      limitation: 'application-error-handling-AC-16105-4: the AC also requires (a) that the mapper reads the applied per-class contract for an elicited additional category and (b) that the wire response carries the retry hint the elicited class contract specifies; this probe pack ships no classification-additions elicit and no applied per-class retry contract, so those two clauses are not observed here. The observed clause is (c): an unelicited category token is refused at record construction (REQ-002 refusal path)',
    }));
    return { results };
  } finally {
    await fixture.close();
  }
}
