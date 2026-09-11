// step-page-shape probe for application-forms-wizard v1.2.2.
//
// Verifies AC-24102-1's validation timing through real HTTP round
// trips against the fixture's rendered timing states:
//   - pristine baseline (no error, no aria-invalid)
//   - blur (message present via aria-describedby, no aria-invalid)
//   - submit-failure (aria-invalid=true, top-of-page error summary)
//   - corrected/rebuilt (summary removed, no aria-invalid, no message)
// The rebuild is also exercised via POST /validate, which returns
// the error set for the submitted body. AC-24102-1 requires that
// blur, submit-failure, change and rebuild all be observed on the
// same step. The probe emits one row per state transition and one
// row per /validate call, each carrying its varied input and the
// derived output.
//
// anchorAcId: application-forms-wizard-AC-24102-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-002';
export const accountBound = false;

function observeStep(body) {
  return {
    // Match a real error-summary section (not the CSS selector
    // literal inside <style>) - the fixture emits <section
    // data-surface="error-summary" ...> only when refused=1.
    hasErrorSummary: /<section[^>]+data-surface="error-summary"/.test(body),
    ariaInvalid: /id="field-fullName"[^>]+aria-invalid="true"/.test(body),
    ariaDescribedBy: /id="field-fullName"[^>]+aria-describedby="err-fullName"/.test(body),
    errorMessage: /<p[^>]+data-error-message[^>]+id="err-fullName"/.test(body),
    stateMarker: (body.match(/data-validation-state="([^"]+)"/) || [])[1] || null,
  };
}

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Row 1: pristine baseline.
    const pristineRes = await fetch(`${fixture.baseUrl}/step/1`);
    const pristineBody = await pristineRes.text();
    const pristine = observeStep(pristineBody);
    results.push({
      anchorAcId: 'application-forms-wizard-AC-24102-1',
      anchorReqId: 'application-forms-wizard-REQ-002',
      verdict: pristineRes.status === 200 && !pristine.hasErrorSummary && !pristine.ariaInvalid && pristine.stateMarker === 'pristine' ? 'pass' : 'fail',
      detail: `On the wizard step route, focusing a field - pristine step 1 observed: ${JSON.stringify(pristine)}`,
      evidence: evidenceFromResponse({
        route: '/step/1',
        response: pristineRes,
        bodyText: pristineBody,
        extraFields: { input: { state: 'pristine' }, derived: pristine },
      }),
    });

    // Row 2: blur before submit - message via aria-describedby, no aria-invalid.
    const blurRes = await fetch(`${fixture.baseUrl}/step/1?blurred=1`);
    const blurBody = await blurRes.text();
    const blur = observeStep(blurBody);
    results.push({
      anchorAcId: 'application-forms-wizard-AC-24102-1',
      anchorReqId: 'application-forms-wizard-REQ-002',
      verdict: blurRes.status === 200 && blur.ariaDescribedBy && !blur.ariaInvalid && blur.errorMessage && blur.stateMarker === 'blur' ? 'pass' : 'fail',
      detail: `On the wizard step route, focusing a field - blur transition observed: ${JSON.stringify(blur)}`,
      evidence: evidenceFromResponse({
        route: '/step/1?blurred=1',
        response: blurRes,
        bodyText: blurBody,
        extraFields: { input: { state: 'blur' }, derived: blur },
      }),
    });

    // Row 3: submit-failure - aria-invalid, error-summary.
    const refusedRes = await fetch(`${fixture.baseUrl}/step/1?refused=1`);
    const refusedBody = await refusedRes.text();
    const refused = observeStep(refusedBody);
    results.push({
      anchorAcId: 'application-forms-wizard-AC-24102-1',
      anchorReqId: 'application-forms-wizard-REQ-002',
      verdict: refusedRes.status === 200 && refused.hasErrorSummary && refused.ariaInvalid && refused.ariaDescribedBy && refused.stateMarker === 'submit-failure' ? 'pass' : 'fail',
      detail: `On the wizard step route, focusing a field - submit-failure observed: ${JSON.stringify(refused)}`,
      evidence: evidenceFromResponse({
        route: '/step/1?refused=1',
        response: refusedRes,
        bodyText: refusedBody,
        extraFields: { input: { state: 'submit-failure' }, derived: refused },
      }),
    });

    // Row 4: rebuild on next submit - summary removed, no aria-invalid.
    const correctedRes = await fetch(`${fixture.baseUrl}/step/1?corrected=1`);
    const correctedBody = await correctedRes.text();
    const corrected = observeStep(correctedBody);
    results.push({
      anchorAcId: 'application-forms-wizard-AC-24102-1',
      anchorReqId: 'application-forms-wizard-REQ-002',
      verdict: correctedRes.status === 200 && !corrected.hasErrorSummary && !corrected.ariaInvalid && !corrected.errorMessage && corrected.stateMarker === 'rebuilt' ? 'pass' : 'fail',
      detail: `On the wizard step route, focusing a field - rebuild observed: ${JSON.stringify(corrected)}`,
      evidence: evidenceFromResponse({
        route: '/step/1?corrected=1',
        response: correctedRes,
        bodyText: correctedBody,
        extraFields: { input: { state: 'rebuilt' }, derived: corrected },
      }),
    });

    // Row 5: /validate rebuild derived output - a failed body gives
    // errors.fullName; a subsequent valid body gives errors={} and
    // errorCount 0 - proving each submit rebuilds the error set.
    const failRes = await fetch(`${fixture.baseUrl}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'contact-details', fullName: '' }),
    });
    const failParsed = JSON.parse(await failRes.text());
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
      detail: rebuildOk
        ? `On the wizard step route, focusing a field - /validate rebuild: {fullName:""} -> errorCount=1 fullName error; {fullName:"Alex Example"} -> errorCount=0 rebuildOf=1`
        : `On the wizard step route, focusing a field - /validate rebuild fault: failCount=${failParsed.errorCount} okCount=${okParsed.errorCount} rebuildOf=${okParsed.rebuildOf}`,
      evidence: evidenceFromResponse({
        route: '/validate',
        response: okRes,
        bodyText: okBody,
        extraFields: {
          input: { firstSubmit: { fullName: '' }, secondSubmit: { fullName: 'Alex Example' } },
          derived: { failErrorCount: failParsed.errorCount, okErrorCount: okParsed.errorCount, rebuildOf: okParsed.rebuildOf },
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
