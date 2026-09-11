// record-shape-adr-1701 probe for application-error-handling v1.0.8.
//
// Verifies REQ-002: the constructed record carries exactly the six
// ADR-1701 fields (code, category, message, correlationId, cause,
// context). When ?withCause=1 the fixture nests a full ADR-1701
// record inside cause[] rather than a flat {message, category};
// the probe walks the nested record for the six fields too.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-error-handling-REQ-002';
export const accountBound = false;

const REQUIRED_EXACT = ['code', 'category', 'message', 'correlationId', 'cause', 'context'];

function exactShape(rec) {
  if (!rec || typeof rec !== 'object') return { ok: false, missing: REQUIRED_EXACT, extras: [] };
  const actual = Object.keys(rec).sort();
  const missing = REQUIRED_EXACT.filter((k) => !(k in rec));
  const extras = actual.filter((k) => !REQUIRED_EXACT.includes(k));
  return { ok: missing.length === 0 && extras.length === 0, missing, extras };
}

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Row 1: top-level shape on the transient record.
    const res = await fetch(`${fixture.baseUrl}/construct/transient`);
    const body = await res.text();
    const rec = JSON.parse(body);
    const top = exactShape(rec);
    const topOk = res.status === 200 && top.ok
      && rec.category === 'transient'
      && typeof rec.correlationId === 'string' && rec.correlationId.length > 0;
    results.push({
      anchorReqId: 'application-error-handling-REQ-002',
      verdict: topOk ? 'pass' : 'fail',
      detail: `The internal error record has a stable shape: - top-level record has exactly six ADR-1701 fields; missing=[${top.missing.join(',')}] extras=[${top.extras.join(',')}]`,
      evidence: evidenceFromResponse({
        route: '/construct/transient',
        response: res,
        bodyText: body,
        extraFields: {
          input: { category: 'transient', withCause: false },
          derived: { topOk: top.ok, missing: top.missing, extras: top.extras, correlationIdLen: rec.correlationId?.length ?? 0 },
        },
      }),
    });

    // Row 2: nested cause has the same six-field shape.
    const res2 = await fetch(`${fixture.baseUrl}/construct/permanent?withCause=1`);
    const body2 = await res2.text();
    const rec2 = JSON.parse(body2);
    const nested = exactShape(rec2.cause);
    const nestedOk = res2.status === 200 && exactShape(rec2).ok && nested.ok;
    results.push({
      anchorReqId: 'application-error-handling-REQ-002',
      verdict: nestedOk ? 'pass' : 'fail',
      detail: `The internal error record has a stable shape: - nested cause record has exactly six ADR-1701 fields; missing=[${nested.missing.join(',')}] extras=[${nested.extras.join(',')}]`,
      evidence: evidenceFromResponse({
        route: '/construct/permanent?withCause=1',
        response: res2,
        bodyText: body2,
        extraFields: {
          input: { category: 'permanent', withCause: true },
          derived: { causeShape: nested.ok, causeMissing: nested.missing, causeExtras: nested.extras, causeCorrelationId: rec2.cause?.correlationId ?? null },
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
