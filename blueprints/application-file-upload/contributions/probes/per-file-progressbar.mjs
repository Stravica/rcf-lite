// per-file-progressbar probe for application-file-upload v1.2.4.
//
// Row 1 (AC-23102-1, browser-only): rendered live-region text and
// per-file DOM values.
// Row 2 (AC-23102-2, server-observable derivation): three files of
// 1 MiB, 2 MiB and 5 MiB produce an aggregate byte-weighted count
// that matches the AC's exact sizes. The fixture stores per-session
// byte totals; the probe drives real chunk POSTs.
//
// anchorAcId: per-row.

import { startFixture, evidenceFromResponse, notObservableHereResult } from './probe-utils.mjs';
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
      detail: 'The upload region ships a [data-live-region="polite"] wrapper with - rendered live-region text and per-file DOM values are browser-only per Addendum 3 rule 11',
      reason: 'AC-23102-1 requires observing the rendered aria-live text and the per-file DOM progressbar value change; server-side probe pack cannot observe DOM mutation',
      evidence: { requires: 'browser DOM observation' },
    }));

    // Row 2 (AC-23102-2 byte-weighted aggregate): use the AC's exact
    // sizes (1 MiB, 2 MiB, 5 MiB) so the observed byte total matches
    // the AC's specified numbers (Addendum rule 7 - claims match the
    // AC's numbers).
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
    const progresses = [];
    let lastRes, lastBody = '';
    for (const [i, f] of files.entries()) {
      const payload = Buffer.alloc(f.bytes, 65 + i);
      const chunkRes = await fetch(`${fixture.baseUrl}/upload/chunk?n=${i + 1}&sessionId=${sessionId}`, {
        method: 'POST', body: payload,
      });
      const chunkBody = await chunkRes.text();
      const parsed = JSON.parse(chunkBody);
      progresses.push({ chunk: i + 1, bytesReceived: parsed.bytesReceived, uploadedBytes: parsed.uploadedBytes, complete: parsed.complete });
      lastRes = chunkRes; lastBody = chunkBody;
    }
    const expectedRunning = [1 * MIB, 3 * MIB, 8 * MIB];
    const runOk = progresses.length === 3
      && progresses[0].uploadedBytes === expectedRunning[0]
      && progresses[1].uploadedBytes === expectedRunning[1]
      && progresses[2].uploadedBytes === expectedRunning[2]
      && progresses[2].complete === true;
    // Byte-weighted percent = uploaded / total * 100, matches AC formula.
    const byteWeightedPercent = Math.round((progresses[2].uploadedBytes / totalExpectedBytes) * 100);
    const plainAveragePercent = Math.round(((progresses[0].bytesReceived / files[0].bytes) + (progresses[1].bytesReceived / files[1].bytes) + (progresses[2].bytesReceived / files[2].bytes)) / 3 * 100);
    results.push({
      anchorAcId: 'application-file-upload-AC-23102-2',
      verdict: runOk ? 'pass' : 'fail',
      detail: `Aggregate progress is the byte-weighted sum of - three files at 1 MiB, 2 MiB and 5 MiB aggregated to ${progresses[2].uploadedBytes} of ${totalExpectedBytes} bytes (${byteWeightedPercent}% weighted); a plain average would have read ${plainAveragePercent}%`,
      evidence: evidenceFromResponse({
        route: `/upload/chunk (sessionId=${sessionId})`,
        response: lastRes,
        bodyText: lastBody,
        extraFields: {
          input: { sessionId, filesDeclared: files, totalExpectedBytes },
          derived: { progresses, byteWeightedPercent, plainAveragePercent, byteWeightedAggregateAdvanced: runOk },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
