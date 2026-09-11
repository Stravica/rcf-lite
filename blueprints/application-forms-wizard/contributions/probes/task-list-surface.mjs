// task-list-surface probe for application-forms-wizard v1.2.2.
//
// Verifies AC-24101-1: the task-list surface exposes
// data-surface="task-list" carrying a role="progressbar" with
// aria-valuenow, aria-valuemax and aria-valuetext, and one child
// element per step carrying data-step-slug and data-step-state
// whose value is drawn from the four-state GOV.UK enum ("Not
// started", "In progress", "Cannot start yet", "Completed"). The
// step order matches the manifest.
//
// anchorAcId: application-forms-wizard-AC-24101-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-001';
export const accountBound = false;

const ALLOWED_STATES = new Set(['Not started', 'In progress', 'Cannot start yet', 'Completed']);
const EXPECTED_STEPS = ['contact-details', 'shipping-address', 'payment'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/task-list`);
    const body = await res.text();
    const surface = /data-surface="task-list"/.test(body);
    const progressbar = /role="progressbar"[^>]*aria-valuenow="(\d+)"[^>]*aria-valuemax="(\d+)"[^>]*aria-valuetext="([^"]+)"/.exec(body);
    const rowRe = /data-step-slug="([^"]+)"[^>]*data-step-state="([^"]+)"/g;
    const rows = [];
    let m;
    while ((m = rowRe.exec(body)) !== null) rows.push({ slug: m[1], state: m[2] });
    const slugsInOrder = rows.map((r) => r.slug);
    const statesValid = rows.every((r) => ALLOWED_STATES.has(r.state));
    const orderMatches = slugsInOrder.length === EXPECTED_STEPS.length && slugsInOrder.every((s, i) => s === EXPECTED_STEPS[i]);
    const progressOk = !!progressbar && Number(progressbar[2]) === EXPECTED_STEPS.length;
    const pass = res.status === 200 && surface && progressOk && rows.length === EXPECTED_STEPS.length && statesValid && orderMatches;
    results.push({
      anchorAcId: 'application-forms-wizard-AC-24101-1',
      anchorReqId: 'application-forms-wizard-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `Given the wizard task-list route, the rendered surface - task-list surface carries progressbar (valuemax=${progressbar[2]}) and ${rows.length} step rows in manifest order with states from the closed enum`
        : `Given the wizard task-list route, the rendered surface - task-list fault: surface=${surface} progressbar=${!!progressbar} rows=${rows.length} statesValid=${statesValid} orderMatches=${orderMatches}`,
      evidence: evidenceFromResponse({
        route: '/task-list',
        response: res,
        bodyText: body,
        extraFields: {
          input: { expectedSteps: EXPECTED_STEPS, allowedStates: [...ALLOWED_STATES] },
          derived: { rows, progressBarValues: progressbar ? { now: progressbar[1], max: progressbar[2], text: progressbar[3] } : null, statesValid, orderMatches },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
