// export-handle-formats probe for application-dashboard v1.0.4.
//
// Verifies that the export handle is a labelled <button> opening a
// list of the three shipped formats (REQ-005): csv, pdf, png-chart.
// Fetches the shell HTML, asserts the button and the listbox with
// exactly the three data-export-format entries, and records the
// request id and body excerpt as evidence.
//
// anchorReqId: application-dashboard-REQ-005.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-005';
export const accountBound = false;

const EXPECTED_FORMATS = ['csv', 'pdf', 'png-chart'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/`);
    const body = await res.text();
    const hasBtn = /<button[^>]+class="exportButton"[^>]+aria-haspopup="listbox"/.test(body);
    const formats = Array.from(body.matchAll(/data-export-format="([^"]+)"/g)).map((m) => m[1]);
    const formatsOk = EXPECTED_FORMATS.every((f) => formats.includes(f)) && formats.length === EXPECTED_FORMATS.length;
    const pass = res.status === 200 && hasBtn && formatsOk;
    results.push({
      anchorReqId: 'application-dashboard-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `export handle button opens list of formats: ${formats.join(', ')}`
        : `export fault: buttonPresent=${hasBtn} formats=${JSON.stringify(formats)} expected=${JSON.stringify(EXPECTED_FORMATS)}`,
      evidence: evidenceFromResponse({ route: '/', response: res, bodyText: body, extraFields: { formats } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
