// assertive-completion-slot probe for application-file-upload v1.2.5.
//
// AC-23105-1 (server-observable half): after the fixture completes
// the upload set, the assertive-slot in the shell reads
// /^\d+ files uploaded successfully$/ derived from real bytes.
// The DOM-observable per-row remove/retry controls are browser-only,
// so this probe records ONE conformanceOnly row for AC-23105-1
// carrying real evidence for the observed half.
//
// anchorAcId: application-file-upload-AC-23105-1.

import { startFixture, evidenceFromResponse, conformanceOnlyResult } from './probe-utils.mjs';
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
    await fetch(`${fixture.baseUrl}/upload/session?sessionId=${sessionId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ totalExpectedBytes: total, files }),
    });
    for (const [i, f] of files.entries()) {
      await fetch(`${fixture.baseUrl}/upload/chunk?n=${i + 1}&sessionId=${sessionId}`, {
        method: 'POST', body: Buffer.alloc(f.bytes, 65 + i),
      });
    }
    const completionRes = await fetch(`${fixture.baseUrl}/upload/completion?sessionId=${sessionId}`);
    const completionBody = await completionRes.text();
    const completionParsed = JSON.parse(completionBody);
    const completeDerived = completionParsed.complete === true && completionParsed.uploadedBytes === total
      && COMPLETION_RE.test(completionParsed.completionText);

    const shellRes = await fetch(`${fixture.baseUrl}/upload?sessionId=${sessionId}`);
    const shellBody = await shellRes.text();
    const slotMatch = shellBody.match(/<div[^>]+data-assertive-slot[^>]+aria-live="assertive"[^>]*>([^<]*)<\/div>/);
    const slotText = slotMatch ? slotMatch[1].trim() : '';
    const shellOk = shellRes.status === 200 && !!slotMatch && COMPLETION_RE.test(slotText)
      && slotText === completionParsed.completionText;
    const pass = completeDerived && shellOk;
    results.push(conformanceOnlyResult({
      anchorAcId: 'application-file-upload-AC-23105-1',
      anchorReqId: 'application-file-upload-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: `After the fixture completes the upload set the - drove three real chunk uploads (${total} bytes) under sessionId=${sessionId}; fixture derived completionText="${completionParsed.completionText}"; shell assertive-slot text="${slotText}"`,
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
      limitation: 'application-file-upload-AC-23105-1: per-row remove and retry controls need browser DOM inspection',
    }));

    return { results };
  } finally {
    await fixture.close();
  }
}
