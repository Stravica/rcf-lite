// per-file-progressbar probe for application-file-upload v1.2.5.
//
// Row 1 (AC-23102-1, browser-only): rendered live-region text and
// per-file DOM values are notObservableHere.
// Row 2 (AC-23102-2, byte-weighted aggregate discrimination):
// three files of 1 MiB, 2 MiB and 5 MiB upload one at a time. The
// probe records the fixture's uploadedBytes / totalExpectedBytes
// after EACH file completes and compares the byte-weighted aggregate
// against the plain average of per-file percents at the same point.
// Discrimination is unambiguous after files 1 and 2 (byte-weighted
// 12.5% vs plain-average 33.3% after file 1; 37.5% vs 66.7% after
// file 2); after file 3 both collapse to 100% (the AC's aggregate
// meets its terminal condition). Row is conformanceOnly with a
// limitation naming that only the server-side aggregate byte
// accounting is asserted here; the AC's rendered aggregate value
// on the polite live region is a browser-observable half.
//
// anchorAcId: per-row.

import { startFixture, evidenceFromResponse, notObservableHereResult, conformanceOnlyResult } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

export const anchorReqId = 'application-file-upload-REQ-002';
export const accountBound = false;

const MIB = 1024 * 1024;

export default async function runProbe() {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
 const fixture = await startFixture({ startServer, port: 0 });
 try {
 const results = [];

 // Row 1: notObservableHere for the live-region + per-file DOM value.
 results.push(notObservableHereResult({
 ac: 'application-file-upload-AC-23102-1',
 detail: 'The upload region ships a [data-live-region="polite"] wrapper with - rendered live-region text and per-file DOM values are browser-only',
 reason: 'AC-23102-1 requires observing the rendered aria-live text and the per-file DOM progressbar value change; a server-side probe pack cannot observe DOM mutation',
 evidence: { requires: 'browser DOM observation', ac: 'application-file-upload-AC-23102-1' },
 }));

 const sessionId = `session-${randomUUID()}`;
 const files = [
 { name: 'a.bin', bytes: 1 * MIB },
 { name: 'b.bin', bytes: 2 * MIB },
 { name: 'c.bin', bytes: 5 * MIB },
 ];
 const totalExpectedBytes = files.reduce((s, f) => s + f.bytes, 0);
 await fetch(`${fixture.baseUrl}/upload/session?sessionId=${sessionId}`, {
 method: 'POST',
 headers: { 'content-type': 'application/json' },
 body: JSON.stringify({ totalExpectedBytes, files }),
 });

 const perStep = [];
 let lastRes, lastBody = '';
 const fileBytesPerFile = files.map((f) => 0);
 for (const [i, f] of files.entries()) {
 const payload = Buffer.alloc(f.bytes, 65 + i);
 const chunkRes = await fetch(`${fixture.baseUrl}/upload/chunk?n=${i + 1}&sessionId=${sessionId}`, {
 method: 'POST', body: payload,
 });
 const chunkBody = await chunkRes.text();
 const parsed = JSON.parse(chunkBody);
 fileBytesPerFile[i] = parsed.bytesReceived;
 // Byte-weighted percent = server's uploadedBytes / totalExpectedBytes.
 const byteWeightedPercent = (parsed.uploadedBytes / totalExpectedBytes) * 100;
 // Plain average of per-file percents at this same point.
 const perFilePercents = files.map((ff, idx) => (fileBytesPerFile[idx] / ff.bytes) * 100);
 const plainAveragePercent = perFilePercents.reduce((a, b) => a + b, 0) / perFilePercents.length;
 perStep.push({
 afterFileIndex: i,
 uploadedBytes: parsed.uploadedBytes,
 byteWeightedPercent: Number(byteWeightedPercent.toFixed(2)),
 perFilePercents: perFilePercents.map((p) => Number(p.toFixed(2))),
 plainAveragePercent: Number(plainAveragePercent.toFixed(2)),
 discriminates: Math.abs(byteWeightedPercent - plainAveragePercent) > 0.5,
 });
 lastRes = chunkRes; lastBody = chunkBody;
 }
 // Discrimination proven if the intermediate steps distinguish byte-weighted
 // from plain-average by more than 0.5 percentage points.
 const intermediateDiscriminates = perStep[0].discriminates && perStep[1].discriminates;
 const finalConverges = Math.abs(perStep[2].byteWeightedPercent - 100) < 0.5;
 const runOk = intermediateDiscriminates && finalConverges;
 results.push(conformanceOnlyResult({
 anchorAcId: 'application-file-upload-AC-23102-2',
 verdict: runOk ? 'pass' : 'fail',
 detail: `Aggregate progress is the byte-weighted sum of per-file - after file 1 byteWeighted=${perStep[0].byteWeightedPercent}% vs plainAverage=${perStep[0].plainAveragePercent}%; after file 2 ${perStep[1].byteWeightedPercent}% vs ${perStep[1].plainAveragePercent}%; after file 3 ${perStep[2].byteWeightedPercent}% vs ${perStep[2].plainAveragePercent}% (converge at completion)`,
 evidence: evidenceFromResponse({
 route: `/upload/chunk (sessionId=${sessionId})`,
 response: lastRes,
 bodyText: lastBody,
 extraFields: {
 input: { sessionId, filesDeclared: files, totalExpectedBytes },
 derived: { perStep, intermediateDiscriminates, finalConverges },
 },
 }),
 limitation: 'application-file-upload-AC-23102-2: the polite live region\'s rendered aggregate announcement text is not observable on a server-driven probe pack; the byte-weighted aggregate is asserted from the server\'s uploaded-bytes accounting only',
 }));

 return { results };
 } finally {
 await fixture.close();
 }
}
