// chunked-transport-endpoints probe for application-file-upload
// v1.2.3.
//
// Verifies AC-23104-1 (multipart transport: three real chunk POSTs
// with distinct byte payloads advance a byte-derived total on the
// server) and AC-23104-3 (tus transport: Upload-Offset writes bytes
// durably, an expected-offset mismatch returns 409).
//
// anchorAcId: per-row.

import { startFixture, evidenceFromResponse, notObservableHereResult } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

export const anchorReqId = 'application-file-upload-REQ-004';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Row 1 (AC-23104-1): multipart chunks - three real POSTs with
    // distinct byte payloads.
    const sessionId = `session-${randomUUID()}`;
    const files = [{ name: 'x.bin', bytes: 1024 }, { name: 'y.bin', bytes: 2048 }, { name: 'z.bin', bytes: 4096 }];
    const total = files.reduce((s, f) => s + f.bytes, 0);
    await fetch(`${fixture.baseUrl}/upload/session?sessionId=${sessionId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ totalExpectedBytes: total, files }),
    });
    const chunkResults = [];
    let lastChunkRes, lastChunkBody = '';
    for (const [i, f] of files.entries()) {
      const payload = Buffer.alloc(f.bytes, 65 + i);
      const r = await fetch(`${fixture.baseUrl}/upload/chunk?n=${i + 1}&sessionId=${sessionId}`, { method: 'POST', body: payload });
      const b = await r.text();
      const parsed = JSON.parse(b);
      chunkResults.push({ chunk: i + 1, bytesReceived: parsed.bytesReceived, uploadedBytes: parsed.uploadedBytes });
      lastChunkRes = r; lastChunkBody = b;
    }
    const chunkOk = chunkResults[0].bytesReceived === files[0].bytes
      && chunkResults[1].bytesReceived === files[1].bytes
      && chunkResults[2].bytesReceived === files[2].bytes
      && chunkResults[2].uploadedBytes === total;
    results.push({
      anchorAcId: 'application-file-upload-AC-23104-1',
      anchorReqId: 'application-file-upload-REQ-004',
      verdict: chunkOk ? 'pass' : 'fail',
      detail: `On the ?transport=multipart branch the fixture returns 200 - multipart chunks recorded bytes ${chunkResults.map((c) => c.bytesReceived).join(',')} advancing cumulative to ${chunkResults[2]?.uploadedBytes ?? 0} of ${total} (sessionId=${sessionId})`,
      evidence: evidenceFromResponse({
        route: `/upload/chunk (sessionId=${sessionId})`,
        response: lastChunkRes,
        bodyText: lastChunkBody,
        extraFields: {
          input: { sessionId, files, totalExpectedBytes: total },
          derived: { chunkResults, totalOk: chunkResults[2]?.uploadedBytes === total },
        },
      }),
    });

    // Row 2 (AC-23104-3): tus offset write plus 409 on mismatch.
    const uploadId = `upload-${randomUUID()}`;
    // Correct PATCH #1: declared offset 0, write 4096 bytes; server
    // stored offset becomes 4096.
    const patch1 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`, {
      method: 'PATCH', headers: { 'upload-offset': '0' }, body: Buffer.alloc(4096, 65),
    });
    const patch1Offset = patch1.headers.get('upload-offset');
    const get1 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`);
    const get1Body = await get1.text();
    const get1Parsed = JSON.parse(get1Body);
    // Correct PATCH #2: declared offset 4096, write 8192 more bytes.
    const patch2 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`, {
      method: 'PATCH', headers: { 'upload-offset': '4096' }, body: Buffer.alloc(8192, 66),
    });
    const patch2Offset = patch2.headers.get('upload-offset');
    const get2 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`);
    const get2Body = await get2.text();
    const get2Parsed = JSON.parse(get2Body);
    // Mismatch PATCH: declared offset 99999 while stored is 12288.
    const patchBad = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`, {
      method: 'PATCH', headers: { 'upload-offset': '99999' }, body: Buffer.alloc(10, 67),
    });
    const patchBadBody = await patchBad.text();
    const badExpected = patchBad.status === 409;
    const tusOk = patch1.status === 204 && patch1Offset === '4096' && get1Parsed.storedBytes === 4096
      && patch2.status === 204 && patch2Offset === '12288' && get2Parsed.storedBytes === 12288
      && badExpected;
    results.push({
      anchorAcId: 'application-file-upload-AC-23104-3',
      anchorReqId: 'application-file-upload-REQ-004',
      verdict: tusOk ? 'pass' : 'fail',
      detail: `Upload-Offset on the tus branch matches the byte - tus writes byte-derived: PATCH#1 stored=${get1Parsed.storedBytes}, PATCH#2 stored=${get2Parsed.storedBytes}, mismatch PATCH -> ${patchBad.status}`,
      evidence: evidenceFromResponse({
        route: `/upload/tus (uploadId=${uploadId})`,
        response: get2,
        bodyText: get2Body,
        extraFields: {
          input: { uploadId, patches: [{ offset: 0, bytes: 4096 }, { offset: 4096, bytes: 8192 }, { offset: 99999, bytes: 10 }] },
          derived: { patch1Offset, patch2Offset, stored1: get1Parsed.storedBytes, stored2: get2Parsed.storedBytes, mismatchStatus: patchBad.status, mismatchBody: patchBadBody.slice(0, 240) },
        },
      }),
    });

    // Row 3: DOM transport marker + browser network observation is
    // browser-only per Addendum 3 rule 11.
    results.push(notObservableHereResult({
      anchorAcId: 'application-file-upload-AC-23104-1',
      anchorReqId: 'application-file-upload-REQ-004',
      ac: 'application-file-upload-AC-23104-1',
      detail: 'On the ?transport=multipart branch the fixture returns 200 - DOM transport marker and browser network observation are browser-only per Addendum 3 rule 11',
      reason: 'AC-23104-1 also requires observing DOM transport markers and browser network activity; server-side probe pack cannot observe DOM or the browser network stack',
      evidence: { requires: 'browser Network panel + DOM inspection' },
    }));

    return { results };
  } finally {
    await fixture.close();
  }
}
