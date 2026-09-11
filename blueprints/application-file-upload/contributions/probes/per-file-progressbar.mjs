// per-file-progressbar probe for application-file-upload v1.2.3.
//
// Rendered per-file progress values are browser-only (they update in
// the client), so AC-23102-1 is recorded as notObservableHere per
// Addendum 3 rule 11. The server-observable half - aggregate byte
// progress derived from real chunk uploads (AC-23102-2 byte-weighted
// aggregate) - is a real evidence row.
//
// anchorAcId: application-file-upload-AC-23102-1 and -23102-2.

import { startFixture, evidenceFromResponse, notObservableHereResult } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

export const anchorReqId = 'application-file-upload-REQ-002';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Row 1: notObservableHere for the live-region + per-file DOM value.
    results.push(notObservableHereResult({
      anchorAcId: 'application-file-upload-AC-23102-1',
      anchorReqId: 'application-file-upload-REQ-002',
      ac: 'application-file-upload-AC-23102-1',
      detail: 'The upload region ships a [data-live-region="polite"] wrapper with - rendered live-region text and per-file DOM values are browser-only per Addendum 3 rule 11',
      reason: 'AC-23102-1 requires observing the rendered aria-live text and the per-file DOM progressbar value change; server-side probe pack cannot observe DOM mutation',
      evidence: { requires: 'browser DOM observation' },
    }));

    // Row 2 (AC-23102-2 byte-weighted aggregate): drive real chunk
    // uploads with distinct byte payloads and observe the fixture's
    // aggregate byte total advance. The derivation is bytes uploaded
    // vs totalExpectedBytes, computed server-side from real bodies.
    const sessionId = `probe-${randomUUID()}`;
    const files = [{ name: 'a.bin', bytes: 100 }, { name: 'b.bin', bytes: 200 }, { name: 'c.bin', bytes: 300 }];
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
    const expectedRunning = [100, 300, 600];
    const runOk = progresses.length === 3
      && progresses[0].uploadedBytes === expectedRunning[0]
      && progresses[1].uploadedBytes === expectedRunning[1]
      && progresses[2].uploadedBytes === expectedRunning[2]
      && progresses[2].complete === true;
    results.push({
      anchorAcId: 'application-file-upload-AC-23102-2',
      anchorReqId: 'application-file-upload-REQ-002',
      verdict: runOk ? 'pass' : 'fail',
      detail: `The upload region ships a [data-live-region="polite"] wrapper with - byte-weighted aggregate advanced ${progresses.map((p) => p.uploadedBytes).join('->')} bytes over ${files.length} real chunks totalling ${totalExpectedBytes}; completion derived server-side: ${progresses[2]?.complete}`,
      evidence: evidenceFromResponse({
        route: `/upload/chunk (sessionId=${sessionId})`,
        response: lastRes,
        bodyText: lastBody,
        extraFields: {
          input: { sessionId, filesDeclared: files, totalExpectedBytes },
          derived: { progresses, byteWeightedAggregateAdvanced: runOk },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
