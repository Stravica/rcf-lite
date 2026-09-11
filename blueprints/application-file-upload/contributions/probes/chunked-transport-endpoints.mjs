// chunked-transport-endpoints probe for application-file-upload
// v1.2.0.
//
// Verifies that the chunked-and-resumable transport endpoints are
// wired (REQ-004): POST /upload/chunk accepts a chunk number and
// PATCH /upload/tus honours the Upload-Offset header. Records both
// request ids and body excerpts as evidence.
//
// anchorReqId: application-file-upload-REQ-004.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-file-upload-REQ-004';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];

    const chunkRes = await fetch(`${fixture.baseUrl}/upload/chunk?n=3`, { method: 'POST' });
    const chunkBody = await chunkRes.text();
    const chunkParsed = JSON.parse(chunkBody);
    const chunkOk = chunkRes.status === 200 && chunkParsed.ok === true && chunkParsed.chunk === '3';
    results.push({
      anchorReqId: 'application-file-upload-REQ-004',
      verdict: chunkOk ? 'pass' : 'fail',
      detail: chunkOk
        ? 'POST /upload/chunk?n=3 returned {ok:true, chunk:"3"}'
        : `chunk endpoint fault: status=${chunkRes.status} body=${chunkBody.slice(0, 120)}`,
      evidence: evidenceFromResponse({ route: '/upload/chunk?n=3', response: chunkRes, bodyText: chunkBody }),
    });

    const tusRes = await fetch(`${fixture.baseUrl}/upload/tus`, {
      method: 'PATCH',
      headers: { 'upload-offset': '2048' },
    });
    const tusOk = tusRes.status === 204 && tusRes.headers.get('upload-offset') === '2048';
    results.push({
      anchorReqId: 'application-file-upload-REQ-004',
      verdict: tusOk ? 'pass' : 'fail',
      detail: tusOk
        ? 'PATCH /upload/tus with upload-offset=2048 returned 204 and echoed the offset'
        : `tus endpoint fault: status=${tusRes.status} echoed-offset=${tusRes.headers.get('upload-offset')}`,
      evidence: evidenceFromResponse({ route: '/upload/tus', response: tusRes, bodyText: '', extraFields: { echoedOffset: tusRes.headers.get('upload-offset') } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
