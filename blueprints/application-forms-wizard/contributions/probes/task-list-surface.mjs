// task-list-surface probe for application-forms-wizard v1.2.3.
//
// Verifies AC-24101-1: the task-list surface exposes
// data-surface="task-list" carrying a role="progressbar" and one
// child element per step whose data-step-state value is drawn from
// the four-state GOV.UK enum. The expected manifest is read from
// the fixture's /__task-manifest endpoint (independent source of
// truth) rather than duplicated in the probe, closing the reviewer
// finding.
//
// anchorAcId: application-forms-wizard-AC-24101-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Read manifest from the fixture (independent of the shell HTML).
    const manifestRes = await fetch(`${fixture.baseUrl}/__task-manifest`);
    const manifestBody = await manifestRes.text();
    const manifest = JSON.parse(manifestBody);
    const expectedSlugs = (manifest.steps || []).map((s) => s.slug);
    const allowedStates = new Set(manifest.allowedStates || []);

    const res = await fetch(`${fixture.baseUrl}/task-list`);
    const body = await res.text();
    const surface = /data-surface="task-list"/.test(body);
    const progressbar = /role="progressbar"[^>]*aria-valuenow="(\d+)"[^>]*aria-valuemax="(\d+)"[^>]*aria-valuetext="([^"]+)"/.exec(body);
    const rowRe = /data-step-slug="([^"]+)"[^>]*data-step-state="([^"]+)"/g;
    const rows = [];
    let m;
    while ((m = rowRe.exec(body)) !== null) rows.push({ slug: m[1], state: m[2] });
    const slugsInOrder = rows.map((r) => r.slug);
    const statesValid = rows.every((r) => allowedStates.has(r.state));
    const orderMatches = slugsInOrder.length === expectedSlugs.length && slugsInOrder.every((s, i) => s === expectedSlugs[i]);
    const progressOk = !!progressbar && Number(progressbar[2]) === expectedSlugs.length;
    const pass = res.status === 200 && surface && progressOk && rows.length === expectedSlugs.length && statesValid && orderMatches;
    results.push({
      anchorAcId: 'application-forms-wizard-AC-24101-1',
      anchorReqId: 'application-forms-wizard-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: `Given the wizard task-list route, the rendered surface - task-list carries progressbar (valuemax=${progressbar ? progressbar[2] : 'null'}) and ${rows.length} step rows in manifest order [${slugsInOrder.join(',')}]; states from allowed enum: ${statesValid}`,
      evidence: evidenceFromResponse({
        route: '/task-list',
        response: res,
        bodyText: body,
        extraFields: {
          input: { manifestSteps: expectedSlugs, allowedStates: [...allowedStates] },
          derived: { rows, progressBarValues: progressbar ? { now: progressbar[1], max: progressbar[2], text: progressbar[3] } : null, statesValid, orderMatches },
          altBodyExcerpt: manifestBody.slice(0, 240),
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
