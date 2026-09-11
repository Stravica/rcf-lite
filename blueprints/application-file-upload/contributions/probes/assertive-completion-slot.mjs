// assertive-completion-slot probe for application-file-upload v1.2.3.
//
// Verifies AC-23105-1: after the upload SET completes the assertive
// slot carries "N files uploaded successfully". Under Addendum 3
// rule 13 the probe MUST drive real chunk uploads to reach the
// completion state, not seed ?complete=<N>. The probe declares a
// session, POSTs three real chunk payloads whose byte total meets
// the declared total, then re-fetches the /upload shell with
// ?sessionId=<the session id> and observes the fixture-computed
// completion string. Remove/retry control observation is browser-only.
//
// anchorAcId: application-file-upload-AC-23105-1.

import { startFixture, evidenceFromResponse, notObservableHereResult } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

export const anchorReqId = 'application-file-upload-REQ-005';
export const accountBound = false;

const COMPLETION_RE = /^\d+ files uploaded successfully$/;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    const sessionId = `probe-${randomUUID()}`;
    const files = [{ name: 'p.bin', bytes: 100 }, { name: 'q.bin', bytes: 200 }, { name: 'r.bin', bytes: 300 }];
    const total = files.reduce((s, f) => s + f.bytes, 0);
    // Declare the session so completion is derived from bytes, not seeded.
    await fetch(`${fixture.baseUrl}/upload/session?sessionId=${sessionId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ totalExpectedBytes: total, files }),
    });
    // Drive three real chunk uploads.
    for (const [i, f] of files.entries()) {
      await fetch(`${fixture.baseUrl}/upload/chunk?n=${i + 1}&sessionId=${sessionId}`, {
        method: 'POST', body: Buffer.alloc(f.bytes, 65 + i),
      });
    }
    // Ask the fixture for its derived completion state.
    const completionRes = await fetch(`${fixture.baseUrl}/upload/completion?sessionId=${sessionId}`);
    const completionBody = await completionRes.text();
    const completionParsed = JSON.parse(completionBody);
    const completeDerived = completionParsed.complete === true && completionParsed.uploadedBytes === total
      && COMPLETION_RE.test(completionParsed.completionText);

    // Re-fetch the shell with ?sessionId=... and confirm the
    // assertive slot carries the fixture-computed text.
    const shellRes = await fetch(`${fixture.baseUrl}/upload?sessionId=${sessionId}`);
    const shellBody = await shellRes.text();
    const slotMatch = shellBody.match(/<div[^>]+data-assertive-slot[^>]+aria-live="assertive"[^>]*>([^<]*)<\/div>/);
    const slotText = slotMatch ? slotMatch[1].trim() : '';
    const shellOk = shellRes.status === 200 && !!slotMatch && COMPLETION_RE.test(slotText)
      && slotText === completionParsed.completionText;
    const pass = completeDerived && shellOk;
    results.push({
      anchorAcId: 'application-file-upload-AC-23105-1',
      anchorReqId: 'application-file-upload-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: `Given an upload set that reaches completion, - drove three real chunk uploads (${total} bytes) under sessionId=${sessionId}; fixture derived completionText="${completionParsed.completionText}"; shell assertive-slot text="${slotText}"`,
      evidence: evidenceFromResponse({
        route: `/upload?sessionId=${sessionId}`,
        response: shellRes,
        bodyText: shellBody,
        extraFields: {
          input: { sessionId, files, totalExpectedBytes: total },
          derived: {
            uploadedBytes: completionParsed.uploadedBytes,
            complete: completionParsed.complete,
            completionText: completionParsed.completionText,
            assertiveSlotText: slotText,
          },
          altBodyExcerpt: completionBody.slice(0, 240),
        },
      }),
    });

    // Row 2: completed-row remove/retry controls are DOM-observed;
    // browser-only per Addendum 3 rule 11.
    results.push(notObservableHereResult({
      anchorAcId: 'application-file-upload-AC-23105-1',
      anchorReqId: 'application-file-upload-REQ-005',
      ac: 'application-file-upload-AC-23105-1',
      detail: 'Given an upload set that reaches completion, - completed-row remove/retry controls need DOM inspection; browser-only per Addendum 3 rule 11',
      reason: 'AC-23105-1 also requires observing per-row remove and retry controls after completion; server-side probe pack cannot inspect the rendered DOM',
      evidence: { requires: 'browser DOM observation of per-row controls' },
    }));

    return { results };
  } finally {
    await fixture.close();
  }
}
