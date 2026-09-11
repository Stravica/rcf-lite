// assertive-completion-slot probe for application-file-upload v1.2.0.
//
// Verifies that on successful completion of the upload set the
// surface renders an assertive-slot announcement region per REQ-005
// (aria-live="assertive"). Fetches /upload and asserts the slot is
// present in the shipped shell. Records the request id and body
// excerpt as evidence.
//
// anchorReqId: application-file-upload-REQ-005.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-file-upload-REQ-005';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/upload`);
    const body = await res.text();
    const slot = /data-assertive-slot[^>]+aria-live="assertive"/.test(body);
    const pass = res.status === 200 && slot;
    results.push({
      anchorReqId: 'application-file-upload-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? 'assertive-slot present with aria-live="assertive"'
        : `assertive-slot fault: present=${slot} status=${res.status}`,
      evidence: evidenceFromResponse({ route: '/upload', response: res, bodyText: body }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
