// step-page-shape probe for application-forms-wizard v1.2.3.
//
// AC-24102-1's validation timing (blur, submit-failure, change,
// rebuild) is defined as browser events on the step. Server-side
// query-flag seeding of the claimed state is refused under Addendum
// 3 rule 13 ("no query-string seeding of the property under test"),
// so the visual timing rows are recorded as notObservableHere. The
// /validate POST rebuild is a real server-observable derivation
// (input body -> derived error set) and stays as evidence.
//
// anchorAcId: application-forms-wizard-AC-24102-1.

import { startFixture, evidenceFromResponse, notObservableHereResult } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-002';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Row 1: notObservableHere for the visual timing transitions.
    results.push(notObservableHereResult({
      anchorAcId: 'application-forms-wizard-AC-24102-1',
      anchorReqId: 'application-forms-wizard-REQ-002',
      ac: 'application-forms-wizard-AC-24102-1',
      detail: 'On the wizard step route, focusing a field - blur/submit-failure/input/rebuild are browser-only per Addendum 3 rule 11; query-flag seeding of the claimed state is refused under rule 13',
      reason: 'AC-24102-1 requires observing blur/submit/input/change transitions in a running browser; server-side probe pack cannot cause or observe those events',
      evidence: { requires: 'browser focus/blur/submit/input events + DOM inspection' },
    }));

    // Row 2: /validate rebuild - a real derived observation. First
    // POST with an empty fullName produces errorCount=1; second POST
    // with a valid fullName produces errorCount=0 AND rebuildOf=1,
    // proving the fixture recomputes the error set on every call.
    const failRes = await fetch(`${fixture.baseUrl}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'contact-details', fullName: '' }),
    });
    const failBody = await failRes.text();
    const failParsed = JSON.parse(failBody);
    const okRes = await fetch(`${fixture.baseUrl}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'contact-details', fullName: 'Alex Example', previousErrorCount: failParsed.errorCount }),
    });
    const okBody = await okRes.text();
    const okParsed = JSON.parse(okBody);
    const rebuildOk = failRes.status === 200 && failParsed.errorCount === 1 && !!failParsed.errors.fullName
      && okRes.status === 200 && okParsed.errorCount === 0 && okParsed.rebuildOf === 1;
    results.push({
      anchorAcId: 'application-forms-wizard-AC-24102-1',
      anchorReqId: 'application-forms-wizard-REQ-002',
      verdict: rebuildOk ? 'pass' : 'fail',
      detail: `On the wizard step route, focusing a field - /validate rebuild derived: {fullName:""} -> errorCount=${failParsed.errorCount}, {fullName:"Alex Example"} -> errorCount=${okParsed.errorCount} rebuildOf=${okParsed.rebuildOf}`,
      evidence: evidenceFromResponse({
        route: '/validate',
        response: okRes,
        bodyText: okBody,
        extraFields: {
          input: { firstSubmit: { fullName: '' }, secondSubmit: { fullName: 'Alex Example' } },
          derived: { failErrorCount: failParsed.errorCount, okErrorCount: okParsed.errorCount, rebuildOf: okParsed.rebuildOf },
          altBodyExcerpt: failBody.slice(0, 240),
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
