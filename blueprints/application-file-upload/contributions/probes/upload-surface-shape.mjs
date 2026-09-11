// upload-surface-shape probe for application-file-upload v1.2.5.
//
// AC-23101-1: the upload region carries [data-surface="file-upload"]
// plus a labelled input, drop-zone and open-picker button. The
// browser-observable half (Enter-press and focus movement) is
// covered by the conformanceOnly limitation on the single row - no
// duplicate notObservableHere row (
// "same-AC positive rows alongside notObservable rows").
//
// anchorAcId: application-file-upload-AC-23101-1.

import { startFixture, evidenceFromResponse, conformanceOnlyResult } from './probe-utils.mjs';

export const anchorReqId = 'application-file-upload-REQ-001';
export const accountBound = false;

export default async function runProbe() {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
 const fixture = await startFixture({ startServer, port: 0 });
 try {
 const results = [];
 const res = await fetch(`${fixture.baseUrl}/upload`);
 const body = await res.text();
 const surface = /data-surface="file-upload"/.test(body);
 const label = /<label[^>]+for="filePicker"/.test(body);
 const input = /<input[^>]+id="filePicker"[^>]+type="file"[^>]+multiple/.test(body);
 const dropZoneMatch = body.match(/<div[^>]+data-drop-zone[^>]+aria-label="([^"]+)"[^>]*>/);
 const pickerMatch = body.match(/<button[^>]+data-open-picker[^>]+aria-label="([^"]+)"[^>]*>/);
 const pass = res.status === 200 && surface && label && input && !!dropZoneMatch && !!pickerMatch;
 results.push(conformanceOnlyResult({
 anchorAcId: 'application-file-upload-AC-23101-1',
 anchorReqId: 'application-file-upload-REQ-001',
 verdict: pass ? 'pass' : 'fail',
 detail: `The upload region carries [data-surface="file-upload"] and inside it: - server-observable half: labelled input, drop-zone (aria-label="${dropZoneMatch?.[1] ?? 'null'}") and open-picker button (aria-label="${pickerMatch?.[1] ?? 'null'}")`,
 evidence: evidenceFromResponse({
 route: '/upload',
 response: res,
 bodyText: body,
 extraFields: {
 input: { path: '/upload' },
 derived: {
 surface, label, input,
 dropZoneAriaLabel: dropZoneMatch?.[1] ?? null,
 pickerAriaLabel: pickerMatch?.[1] ?? null,
 },
 },
 }),
 limitation: 'application-file-upload-AC-23101-1: Enter-press on the button and focus return are browser-only',
 }));

 return { results };
 } finally {
 await fixture.close();
 }
}
