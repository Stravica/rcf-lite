// assertive-completion-slot probe for application-file-upload v1.2.2.
//
// Verifies AC-23105-1: after the upload set completes the surface
// carries an assertive-slot with aria-live="assertive" whose text
// matches /^\d+ files uploaded successfully$/. The probe drives
// /upload?complete=3 so the completion string appears in the
// initial DOM (no JS runner needed) and asserts the text.
//
// anchorAcId: application-file-upload-AC-23105-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-file-upload-REQ-005';
export const accountBound = false;

const COMPLETION_RE = /^\d+ files uploaded successfully$/;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    // Idle: assertive slot is present but empty (AC-23105-1 says
    // the completion announcement fires AFTER completion; empty on
    // idle is correct).
    const idleRes = await fetch(`${fixture.baseUrl}/upload`);
    const idleBody = await idleRes.text();
    const idleSlotMatch = idleBody.match(/<div[^>]+data-assertive-slot[^>]+aria-live="assertive"[^>]*>([^<]*)<\/div>/);
    const idleShapeOk = !!idleSlotMatch;

    // Complete: text advances to the completion announcement.
    const completeRes = await fetch(`${fixture.baseUrl}/upload?complete=3`);
    const completeBody = await completeRes.text();
    const completeSlotMatch = completeBody.match(/<div[^>]+data-assertive-slot[^>]+aria-live="assertive"[^>]*>([^<]+)<\/div>/);
    const completeText = completeSlotMatch ? completeSlotMatch[1] : null;
    const completionOk = !!completeText && COMPLETION_RE.test(completeText);

    const pass = idleRes.status === 200 && idleShapeOk && completeRes.status === 200 && completionOk;
    results.push({
      anchorAcId: 'application-file-upload-AC-23105-1',
      anchorReqId: 'application-file-upload-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `assertive-slot present; after ?complete=3 textContent="${completeText}" matches /^\\d+ files uploaded successfully$/`
        : `assertive-slot fault: idleShape=${idleShapeOk} completeText=${completeText}`,
      evidence: evidenceFromResponse({
        route: '/upload?complete=3',
        response: completeRes,
        bodyText: completeBody,
        extraFields: {
          input: { complete: 3 },
          derived: { idleText: idleSlotMatch ? idleSlotMatch[1] : null, completeText, regex: '^\\d+ files uploaded successfully$' },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
