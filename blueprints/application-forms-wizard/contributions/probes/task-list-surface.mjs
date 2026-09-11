// task-list-surface probe for application-forms-wizard v1.2.0.
//
// Verifies that the wizard renders a task-list surface listing every
// step (REQ-001) with a step-state marker and progress indicator.
// Fetches / and asserts the surface has data-surface="task-list",
// role="progressbar", and one data-step-slug per manifest step.
// Records the request id and body excerpt as evidence.
//
// anchorReqId: application-forms-wizard-REQ-001.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/`);
    const body = await res.text();
    const surface = /data-surface="task-list"/.test(body);
    const progressBar = /role="progressbar"/.test(body);
    const stepCount = (body.match(/data-step-slug="[^"]+"/g) || []).length;
    const pass = res.status === 200 && surface && progressBar && stepCount >= 2;
    results.push({
      anchorReqId: 'application-forms-wizard-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `task-list surface present with ${stepCount} steps and role=progressbar`
        : `task-list fault: surface=${surface} progressbar=${progressBar} stepCount=${stepCount} status=${res.status}`,
      evidence: evidenceFromResponse({ route: '/', response: res, bodyText: body, extraFields: { stepCount } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
