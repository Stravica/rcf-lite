// upload-surface-shape probe for application-file-upload v1.2.0.
//
// Verifies that the upload surface renders a labelled native file
// input, a labelled drop-zone region and an open-picker button per
// REQ-001. Fetches /upload and asserts the input, drop zone, and
// picker button are present with their labels. Records the request
// id and body excerpt as evidence.
//
// anchorReqId: application-file-upload-REQ-001.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-file-upload-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/upload`);
    const body = await res.text();
    const label = /<label[^>]+for="filePicker"/.test(body);
    const input = /<input[^>]+id="filePicker"[^>]+type="file"[^>]+multiple/.test(body);
    const dropZone = /data-drop-zone[^>]+aria-label=/.test(body);
    const picker = /<button[^>]+data-open-picker[^>]+aria-label=/.test(body);
    const pass = res.status === 200 && label && input && dropZone && picker;
    results.push({
      anchorReqId: 'application-file-upload-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? 'upload surface renders labelled input, drop-zone, open-picker button'
        : `upload surface fault: label=${label} input=${input} dropZone=${dropZone} picker=${picker} status=${res.status}`,
      evidence: evidenceFromResponse({ route: '/upload', response: res, bodyText: body }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
