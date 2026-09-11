// chunked-transport-endpoints probe for application-file-upload
// v1.2.2.
//
// Verifies AC-23104-1 (multipart chunk count > 1 is real, not an
// echoed constant) and AC-23104-3 (tus Upload-Offset is a durable
// server-side write - a subsequent request observes the stored
// offset). The multipart branch drives three real POSTs and
// asserts chunksUploaded advances; the tus branch PATCHes an
// offset then GETs to prove the offset survived the request.
//
// anchorAcId: application-file-upload-AC-23104-1 (row 1) and
// application-file-upload-AC-23104-3 (row 2).

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

export const anchorReqId = 'application-file-upload-REQ-004';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Row 1: multipart chunks - three real POSTs under one session,
    // stateful count on the server side, cumulative count advances.
    const sessionId = `session-${randomUUID()}`;
    const chunkCounts = [];
    let lastChunkRes;
    let lastChunkBody = '';
    for (let n = 1; n <= 3; n += 1) {
      const r = await fetch(`${fixture.baseUrl}/upload/chunk?n=${n}&sessionId=${sessionId}`, { method: 'POST' });
      const b = await r.text();
      chunkCounts.push(JSON.parse(b).chunksUploaded);
      lastChunkRes = r;
      lastChunkBody = b;
    }
    const chunkOk = chunkCounts.length === 3 && chunkCounts[0] === 1 && chunkCounts[1] === 2 && chunkCounts[2] === 3;
    results.push({
      anchorAcId: 'application-file-upload-AC-23104-1',
      anchorReqId: 'application-file-upload-REQ-004',
      verdict: chunkOk ? 'pass' : 'fail',
      detail: chunkOk
        ? `multipart chunk count derived from three POSTs advanced 1->2->3 under sessionId=${sessionId}`
        : `multipart chunk fault: counts=${JSON.stringify(chunkCounts)}`,
      evidence: evidenceFromResponse({
        route: `/upload/chunk (sessionId=${sessionId})`,
        response: lastChunkRes,
        bodyText: lastChunkBody,
        extraFields: {
          input: { sessionId, chunkNs: [1, 2, 3] },
          derived: { chunkCounts },
        },
      }),
    });

    // Row 2: tus offset is a durable server-side write. PATCH with
    // Upload-Offset: 4096 then GET the stored value; the value in
    // the GET body proves the write survived the request boundary
    // (AC-23104-3).
    const uploadId = `upload-${randomUUID()}`;
    const patch1 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`, {
      method: 'PATCH',
      headers: { 'upload-offset': '4096' },
    });
    const get1 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`);
    const get1Body = await get1.text();
    const get1Parsed = JSON.parse(get1Body);
    // Overwrite with a larger offset and GET again to observe the
    // stored value change.
    const patch2 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`, {
      method: 'PATCH',
      headers: { 'upload-offset': '8192' },
    });
    const get2 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`);
    const get2Body = await get2.text();
    const get2Parsed = JSON.parse(get2Body);
    const tusOk = patch1.status === 204 && patch1.headers.get('upload-offset') === '4096'
      && get1Parsed.storedOffset === 4096
      && patch2.status === 204 && get2Parsed.storedOffset === 8192;
    results.push({
      anchorAcId: 'application-file-upload-AC-23104-3',
      anchorReqId: 'application-file-upload-REQ-004',
      verdict: tusOk ? 'pass' : 'fail',
      detail: tusOk
        ? `tus offset written durably: PATCH 4096 -> GET storedOffset=4096; PATCH 8192 -> GET storedOffset=8192 (uploadId=${uploadId})`
        : `tus fault: patch1=${patch1.status}/offset=${patch1.headers.get('upload-offset')} stored1=${get1Parsed.storedOffset} patch2=${patch2.status} stored2=${get2Parsed.storedOffset}`,
      evidence: evidenceFromResponse({
        route: `/upload/tus (uploadId=${uploadId})`,
        response: get2,
        bodyText: get2Body,
        extraFields: {
          input: { uploadId, patches: [4096, 8192] },
          derived: { firstAck: patch1.headers.get('upload-offset'), storedAfterFirst: get1Parsed.storedOffset, storedAfterSecond: get2Parsed.storedOffset },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
