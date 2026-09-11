// record-shape-adr-1701 probe for application-error-handling v1.0.3.
//
// Verifies that a constructed error record carries every field
// governed by ADR-1701 (REQ-002): code, category, message,
// occurredAt, traceId, cause, context, remediation. Records the
// response identifier and body excerpt as evidence.
//
// anchorReqId: application-error-handling-REQ-002.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-error-handling-REQ-002';
export const accountBound = false;

const REQUIRED = ['code', 'category', 'message', 'occurredAt', 'traceId', 'cause', 'context', 'remediation'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/construct/validation`);
    const body = await res.text();
    const rec = JSON.parse(body);
    const missing = REQUIRED.filter((k) => !(k in rec));
    const pass = res.status === 200 && missing.length === 0 && typeof rec.occurredAt === 'string' && rec.category === 'validation';
    results.push({
      anchorReqId: 'application-error-handling-REQ-002',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `constructed record for category="validation" carries all ADR-1701 fields`
        : `record-shape fault: status=${res.status} missing=${JSON.stringify(missing)} category=${rec.category}`,
      evidence: evidenceFromResponse({ route: '/construct/validation', response: res, bodyText: body, extraFields: { missingFields: missing } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
