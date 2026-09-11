// chunked-transport-endpoints probe for application-file-upload v1.2.7.
//
// Row 1 (AC-23104-1): multipart transport - one declared file is
// sent as four sequential equal-sized 4 KiB chunk POSTs against
// one sessionId; the server's per-session byte accounting advances
// by the actual body bytes of each chunk and the completion GET
// reports chunksUploaded higher than one and complete=true.
// Row 2 (AC-23104-3): tus transport - Upload-Offset writes bytes
// durably; a mismatched offset returns 409 WITHOUT advancing the
// stored offset; the probe then re-reads the state and issues a
// RESUME PATCH from the last acknowledged offset, closing the
// gap (post-409 state check + resume PATCH from the AC).
//
// anchorAcId: per-row.

import { startFixture, evidenceFromResponse, conformanceOnlyResult, notObservableHereResult } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

export const anchorReqId = 'application-file-upload-REQ-004';
export const accountBound = false;

export default async function runProbe() {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
 const fixture = await startFixture({ startServer, port: 0 });
 try {
 const results = [];

 // Row 1 (AC-23104-1 server-observable half): ONE file forced into
 // multiple chunks on the ?transport=multipart branch. AC-23104-1
 // requires a file large enough to force chunking with a completed
 // chunk count higher than 1. The probe declares one file of
 // sixteen KiB and posts four sequential 4 KiB chunks against the
 // same sessionId; the fixture's per-session byte accounting
 // advances by the actual body bytes of each chunk and the final
 // response reports the file as complete. AC-23104-1 has three
 // halves: multipart chunk-count in the DOM (browser), tus PATCH
 // with Upload-Offset on the browser network log (browser), and
 // the underlying server-side byte accounting for one file forced
 // into multiple chunks (server-observable). The probe positively
 // observes the third half and records the row as conformanceOnly
 // with a limitation naming the two browser halves not observed
 // here.
 const sessionId = `session-${randomUUID()}`;
 const oneFileBytes = 16 * 1024;
 const chunkBytes = 4 * 1024;
 const chunkCount = oneFileBytes / chunkBytes;
 const files = [{ name: 'one-large-file.bin', bytes: oneFileBytes }];
 await fetch(`${fixture.baseUrl}/upload/session?sessionId=${sessionId}`, {
 method: 'POST', headers: { 'content-type': 'application/json' },
 body: JSON.stringify({ totalExpectedBytes: oneFileBytes, files }),
 });
 const chunkResults = [];
 let lastChunkRes, lastChunkBody = '';
 for (let i = 0; i < chunkCount; i += 1) {
 const payload = Buffer.alloc(chunkBytes, 65 + i);
 const r = await fetch(`${fixture.baseUrl}/upload/chunk?n=${i + 1}&sessionId=${sessionId}`, { method: 'POST', body: payload });
 const b = await r.text();
 const parsed = JSON.parse(b);
 chunkResults.push({ chunk: i + 1, bytesReceived: parsed.bytesReceived, uploadedBytes: parsed.uploadedBytes, chunksUploaded: parsed.chunksUploaded, complete: parsed.complete });
 lastChunkRes = r; lastChunkBody = b;
 }
 const finalRes = await fetch(`${fixture.baseUrl}/upload/chunk?sessionId=${sessionId}`);
 const finalBody = await finalRes.text();
 const finalParsed = JSON.parse(finalBody);
 const allChunksAcceptedFor4KiB = chunkResults.every((c) => c.bytesReceived === chunkBytes);
 const chunksHigherThanOne = finalParsed.chunksUploaded > 1;
 const bytesAdvanced = finalParsed.uploadedBytes === oneFileBytes;
 const completeAtEnd = finalParsed.complete === true;
 const chunkOk = allChunksAcceptedFor4KiB && chunksHigherThanOne && bytesAdvanced && completeAtEnd;
 results.push(conformanceOnlyResult({
 anchorAcId: 'application-file-upload-AC-23104-1',
 verdict: chunkOk ? 'pass' : 'fail',
 detail: `On the ?transport=multipart branch the fixture returns 200 - one file (${oneFileBytes} B) forced into ${chunkCount} chunks of ${chunkBytes} B; chunksUploaded=${finalParsed.chunksUploaded} (>1: ${chunksHigherThanOne}); uploadedBytes=${finalParsed.uploadedBytes}/${oneFileBytes} (complete=${completeAtEnd})`,
 evidence: evidenceFromResponse({
 route: `/upload/chunk (sessionId=${sessionId})`,
 response: lastChunkRes,
 bodyText: lastChunkBody,
 extraFields: {
 input: { sessionId, files, totalExpectedBytes: oneFileBytes, chunkBytes, chunkCount },
 derived: { chunkResults, finalParsed, allChunksAcceptedFor4KiB, chunksHigherThanOne, bytesAdvanced, completeAtEnd },
 },
 }),
 limitation: 'application-file-upload-AC-23104-1: [data-transport] and [data-chunks-uploaded] DOM values, and the browser-network PATCH log carrying Upload-Offset on the tus branch, are not observable on a server-driven probe pack; this row observes the server-side byte accounting of one file forced into multiple chunks only',
 }));
 results.push(notObservableHereResult({
 ac: 'application-file-upload-AC-23104-1',
 detail: 'On the ?transport=multipart branch the fixture returns 200 - the DOM half ([data-transport], [data-chunks-uploaded]) is browser-only',
 reason: 'AC-23104-1 requires observing [data-transport="multipart"] and [data-chunks-uploaded] on the rendered DOM; a server-side probe pack cannot observe DOM',
 evidence: { requires: 'browser DOM observation', ac: 'application-file-upload-AC-23104-1', half: 'dom' },
 }));
 results.push(notObservableHereResult({
 ac: 'application-file-upload-AC-23104-1',
 detail: 'On the ?transport=multipart branch the fixture returns 200 - the tus network half (PATCH with Upload-Offset on the browser network log) is browser-only',
 reason: 'AC-23104-1 requires observing at least one PATCH on the browser network log whose request headers include a numeric Upload-Offset; a server-side probe pack cannot observe the browser network log',
 evidence: { requires: 'browser network log observation', ac: 'application-file-upload-AC-23104-1', half: 'browser-network' },
 }));

 // Row 2 (AC-23104-3): tus offset write; a 409 mismatch does not
 // advance stored offset; the resume PATCH from the last
 // acknowledged offset succeeds.
 const uploadId = `upload-${randomUUID()}`;
 const patch1 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`, {
 method: 'PATCH', headers: { 'upload-offset': '0' }, body: Buffer.alloc(4096, 65),
 });
 const patch1Offset = patch1.headers.get('upload-offset');
 const get1 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`);
 const get1Body = await get1.text();
 const get1Parsed = JSON.parse(get1Body);
 const patch2 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`, {
 method: 'PATCH', headers: { 'upload-offset': '4096' }, body: Buffer.alloc(8192, 66),
 });
 const patch2Offset = patch2.headers.get('upload-offset');
 const get2 = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`);
 const get2Body = await get2.text();
 const get2Parsed = JSON.parse(get2Body);
 // Bad PATCH: declared offset 99999 while stored is 12288.
 const patchBad = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`, {
 method: 'PATCH', headers: { 'upload-offset': '99999' }, body: Buffer.alloc(10, 67),
 });
 const patchBadBody = await patchBad.text();
 // AC-23104-3 post-failure state check: stored offset must NOT
 // have moved, and the client re-reads Upload-Offset before
 // resuming (post-409 state check plus resume PATCH).
 const postFail = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`);
 const postFailBody = await postFail.text();
 const postFailParsed = JSON.parse(postFailBody);
 const storedUnchanged = postFailParsed.storedBytes === 12288;
 // Resume PATCH from the last acknowledged offset (12288) with a
 // real payload; on success the stored bytes advance again.
 const resumeBytes = 1024;
 const patchResume = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`, {
 method: 'PATCH', headers: { 'upload-offset': String(postFailParsed.storedBytes) }, body: Buffer.alloc(resumeBytes, 68),
 });
 const patchResumeOffset = patchResume.headers.get('upload-offset');
 const getResume = await fetch(`${fixture.baseUrl}/upload/tus?uploadId=${uploadId}`);
 const getResumeBody = await getResume.text();
 const getResumeParsed = JSON.parse(getResumeBody);
 const resumeOk = patchResume.status === 204
 && patchResumeOffset === String(12288 + resumeBytes)
 && getResumeParsed.storedBytes === 12288 + resumeBytes;
 const tusOk = patch1.status === 204 && patch1Offset === '4096' && get1Parsed.storedBytes === 4096
 && patch2.status === 204 && patch2Offset === '12288' && get2Parsed.storedBytes === 12288
 && patchBad.status === 409 && storedUnchanged
 && resumeOk;
 results.push({
 anchorAcId: 'application-file-upload-AC-23104-3',
 verdict: tusOk ? 'pass' : 'fail',
 detail: `Upload-Offset on the tus branch matches the byte - tus writes byte-derived: PATCH#1 stored=${get1Parsed.storedBytes}, PATCH#2 stored=${get2Parsed.storedBytes}, mismatch PATCH -> ${patchBad.status} (stored unchanged=${storedUnchanged}), resume PATCH -> ${patchResume.status} stored=${getResumeParsed.storedBytes}`,
 evidence: evidenceFromResponse({
 route: `/upload/tus (uploadId=${uploadId})`,
 response: getResume,
 bodyText: getResumeBody,
 extraFields: {
 input: { uploadId, patches: [
 { offset: 0, bytes: 4096 },
 { offset: 4096, bytes: 8192 },
 { offset: 99999, bytes: 10, expectMismatch: true },
 { offset: 12288, bytes: resumeBytes, resume: true },
 ] },
 derived: {
 patch1Offset, patch2Offset, stored1: get1Parsed.storedBytes, stored2: get2Parsed.storedBytes,
 mismatchStatus: patchBad.status, storedUnchanged, postFailBody: postFailBody.slice(0, 240),
 resumeStatus: patchResume.status, resumeStoredBytes: getResumeParsed.storedBytes, resumeOffsetHeader: patchResumeOffset,
 },
 },
 }),
 });

 return { results };
 } finally {
 await fixture.close();
 }
}
