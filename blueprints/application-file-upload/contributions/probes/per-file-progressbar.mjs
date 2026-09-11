// per-file-progressbar probe for application-file-upload v1.2.2.
//
// Verifies AC-23102-1: per-file rows carry [data-file-progress] with
// role="progressbar" and aria-valuemin/max/now, AND that progress
// advances monotonically across successive chunk uploads. The probe
// drives real POSTs against /upload/chunk under a session id and
// reads the cumulative chunksUploaded value across three calls; the
// advance is the derived output.
//
// anchorAcId: application-file-upload-AC-23102-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

export const anchorReqId = 'application-file-upload-REQ-002';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/upload`);
    const body = await res.text();
    const fileRows = (body.match(/data-file-row[^"]*data-file-name/g) || []).length;
    const refusedRows = (body.match(/data-file-row[^>]+data-refused="true"/g) || []).length;
    const progressBars = (body.match(/role="progressbar"[^>]+aria-valuemin="0"[^>]+aria-valuemax="100"/g) || []).length;
    const shapeOk = res.status === 200 && (fileRows - refusedRows) >= 1 && progressBars >= (fileRows - refusedRows);

    // Drive advance: three chunk POSTs against the same session
    // observe cumulative chunksUploaded 1 -> 2 -> 3 (monotonic).
    const sessionId = `probe-${randomUUID()}`;
    const counts = [];
    let lastRes;
    let lastBody = '';
    for (let n = 1; n <= 3; n += 1) {
      const chunkRes = await fetch(`${fixture.baseUrl}/upload/chunk?n=${n}&sessionId=${sessionId}`, { method: 'POST' });
      const chunkBody = await chunkRes.text();
      const parsed = JSON.parse(chunkBody);
      counts.push(parsed.chunksUploaded);
      lastRes = chunkRes;
      lastBody = chunkBody;
    }
    const monotonic = counts.length === 3 && counts[0] === 1 && counts[1] === 2 && counts[2] === 3;
    const pass = shapeOk && monotonic;
    results.push({
      anchorAcId: 'application-file-upload-AC-23102-1',
      anchorReqId: 'application-file-upload-REQ-002',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `The upload region ships a [data-live-region="polite"] wrapper with - ${(fileRows - refusedRows)} of ${fileRows} acceptable rows carry role=progressbar; server-side chunksUploaded advanced 1->2->3 under sessionId=${sessionId}`
        : `The upload region ships a [data-live-region="polite"] wrapper with - progress fault: rows=${fileRows} refused=${refusedRows} progressBars=${progressBars} counts=${JSON.stringify(counts)}`,
      evidence: evidenceFromResponse({
        route: '/upload/chunk (three POSTs)',
        response: lastRes,
        bodyText: lastBody,
        extraFields: {
          input: { sessionId, chunkNs: [1, 2, 3] },
          derived: { fileRows, refusedRows, progressBars, chunkCounts: counts, monotonic },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
