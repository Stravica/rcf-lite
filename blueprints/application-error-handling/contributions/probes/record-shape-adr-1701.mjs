// record-shape-adr-1701 probe for application-error-handling v1.0.5.
//
// Verifies REQ-002: the constructed error record carries exactly
// the six ADR-1701 fields (code, category, message, correlationId,
// cause, context) and no others. REQ-002 is the layer that owns
// the exact record shape; the check is exact-equality on the field
// set (no missing, no extras).
//
// anchorAcId: none owns the exact shape at the AC layer; the check
// anchors REQ-002 per Addendum rule 1 (fall through to REQ when no
// AC states the property).

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-error-handling-REQ-002';
export const accountBound = false;

const REQUIRED_EXACT = ['code', 'category', 'message', 'correlationId', 'cause', 'context'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/construct/transient`);
    const body = await res.text();
    const rec = JSON.parse(body);
    const actualKeys = Object.keys(rec).sort();
    const expectedKeys = [...REQUIRED_EXACT].sort();
    const missing = REQUIRED_EXACT.filter((k) => !(k in rec));
    const extras = actualKeys.filter((k) => !REQUIRED_EXACT.includes(k));
    const exact = missing.length === 0 && extras.length === 0
      && rec.category === 'transient'
      && typeof rec.correlationId === 'string' && rec.correlationId.length > 0;
    results.push({
      anchorReqId: 'application-error-handling-REQ-002',
      verdict: res.status === 200 && exact ? 'pass' : 'fail',
      detail: res.status === 200 && exact
        ? 'record has exactly six ADR-1701 fields with a non-empty correlationId'
        : `record-shape fault: status=${res.status} missing=${JSON.stringify(missing)} extras=${JSON.stringify(extras)} category=${rec.category} correlationId=${rec.correlationId}`,
      evidence: evidenceFromResponse({
        route: '/construct/transient',
        response: res,
        bodyText: body,
        extraFields: {
          input: { category: 'transient' },
          derived: { actualKeys, expectedKeys, missing, extras, correlationIdLen: rec.correlationId ? rec.correlationId.length : 0 },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
