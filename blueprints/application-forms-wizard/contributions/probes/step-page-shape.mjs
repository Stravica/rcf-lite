// step-page-shape probe for application-forms-wizard v1.2.6.
//
// AC-24102-1 describes blur/change/submit browser events on the
// wizard step. The full AC is browser-only; the /validate rebuild
// count is a slice the fixture can observe honestly, but only as
// PART of AC-24102-1. This probe records ONE conformanceOnly row
// carrying that observation with a limitation citing the AC id.
//
// anchorAcId: application-forms-wizard-AC-24102-1.

import { startFixture, evidenceFromResponse, conformanceOnlyResult } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-002';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // /validate rebuild derivation.
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
    results.push(conformanceOnlyResult({
      anchorAcId: 'application-forms-wizard-AC-24102-1',
      anchorReqId: 'application-forms-wizard-REQ-002',
      verdict: rebuildOk ? 'pass' : 'fail',
      detail: `On the wizard step route, focusing a field - server-observable slice: /validate {fullName:""} -> errorCount=${failParsed.errorCount}, {fullName:"Alex Example"} -> errorCount=${okParsed.errorCount} rebuildOf=${okParsed.rebuildOf}`,
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
      limitation: 'application-forms-wizard-AC-24102-1: the AC requires observing blur, change and submit browser events on the DOM; only the /validate rebuild count is server-observable',
    }));

    return { results };
  } finally {
    await fixture.close();
  }
}
