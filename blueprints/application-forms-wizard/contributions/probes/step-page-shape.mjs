// step-page-shape probe for application-forms-wizard v1.2.0.
//
// Verifies that each step renders its own answers page with a form
// element and a labelled input per REQ-002 (a step validates before
// advancing). GETs /step/1 and asserts a <form> with a labelled
// input and a submit button appears. Records the request id and
// body excerpt as evidence.
//
// anchorReqId: application-forms-wizard-REQ-002.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-002';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/step/1`);
    const body = await res.text();
    const hasForm = /<form[^>]+method="post"/.test(body);
    const labelledInput = /<label[^>]+for="field-[^"]+"/.test(body) && /<input[^>]+id="field-[^"]+"/.test(body);
    const submit = /<button[^>]+type="submit"/.test(body);
    const pass = res.status === 200 && hasForm && labelledInput && submit;
    results.push({
      anchorReqId: 'application-forms-wizard-REQ-002',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? 'step page renders <form method="post"> with labelled input and submit'
        : `step page fault: form=${hasForm} labelledInput=${labelledInput} submit=${submit} status=${res.status}`,
      evidence: evidenceFromResponse({ route: '/step/1', response: res, bodyText: body }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
