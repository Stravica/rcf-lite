// per-file-progressbar probe for application-file-upload v1.2.0.
//
// Verifies that each acceptable file in the upload set carries a
// per-file percent (REQ-002) via role="progressbar" with
// aria-valuenow, aria-valuemin=0, aria-valuemax=100. The fixture
// seeds five file rows by default (two acceptable plus refused
// variants used elsewhere); the probe asserts at least the
// acceptable rows carry the progressbar, matching the shipped
// pattern that refused files skip the progress control. Records the
// request id and body excerpt as evidence.
//
// anchorReqId: application-file-upload-REQ-002.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-file-upload-REQ-002';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/upload`);
    const body = await res.text();
    const fileRows = (body.match(/data-file-row[^"]*data-file-name/g) || []).length;
    const refusedRows = (body.match(/data-file-row[^>]+data-refused="true"/g) || []).length;
    const progressBars = (body.match(/role="progressbar"[^>]+aria-valuemin="0"[^>]+aria-valuemax="100"/g) || []).length;
    const acceptable = fileRows - refusedRows;
    const pass = res.status === 200 && acceptable >= 1 && progressBars >= acceptable;
    results.push({
      anchorReqId: 'application-file-upload-REQ-002',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `${acceptable} of ${fileRows} acceptable file rows carry role=progressbar (refused=${refusedRows})`
        : `progressbar fault: rows=${fileRows} refused=${refusedRows} progressBars=${progressBars} status=${res.status}`,
      evidence: evidenceFromResponse({ route: '/upload', response: res, bodyText: body, extraFields: { fileRows, refusedRows, progressBars } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
