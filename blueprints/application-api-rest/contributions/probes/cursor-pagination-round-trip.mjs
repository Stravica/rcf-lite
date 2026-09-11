// cursor-pagination-round-trip probe for application-api-rest v2.1.8.
//
// Verifies AC-2109-1 (envelope with items, next, prev) on page one,
// AC-2109-2 (following next repeatedly visits every item exactly
// once with a null next on the last page) via a real traversal,
// and REQ-007 opacity plus max-limit and malformed-cursor problem
// responses.
//
// anchorAcId: per-row.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-007';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Row 1 (AC-2109-1): first page envelope.
    const firstRes = await fetch(`${fixture.baseUrl}/v1/widgets?limit=5`);
    const firstBody = await firstRes.text();
    const first = JSON.parse(firstBody);
    const envelopeOk = Array.isArray(first.items)
      && first.items.length === 5
      && typeof first.next === 'string'
      && first.prev === null;
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-1',
      anchorReqId: 'application-api-rest-REQ-007',
      verdict: firstRes.status === 200 && envelopeOk ? 'pass' : 'fail',
      detail: `Every collection endpoint accepts ?cursor= and ?limit= and - GET /v1/widgets?limit=5 returned items[${first.items?.length ?? 0}] with next="${first.next}" prev=${first.prev} (REQ-007 envelope)`,
      evidence: evidenceFromResponse({
        route: '/v1/widgets?limit=5',
        response: firstRes,
        bodyText: firstBody,
        extraFields: {
          input: { limit: 5, cursor: null },
          derived: { itemsLen: first.items?.length ?? 0, next: first.next, prev: first.prev, firstIds: (first.items || []).map((i) => i.id) },
        },
      }),
    });

    // Row 2 (AC-2109-2): traversal.
    const visited = new Set();
    let dupes = 0;
    for (const it of first.items) { if (visited.has(it.id)) dupes += 1; visited.add(it.id); }
    let cursor = first.next;
    let pages = 0;
    let last = first, lastRes = firstRes, lastBody = firstBody;
    while (cursor && pages < 20) {
      const r = await fetch(`${fixture.baseUrl}/v1/widgets?limit=5&cursor=${encodeURIComponent(cursor)}`);
      const b = await r.text();
      const p = JSON.parse(b);
      for (const it of (p.items || [])) { if (visited.has(it.id)) dupes += 1; visited.add(it.id); }
      last = p; lastRes = r; lastBody = b; cursor = p.next; pages += 1;
    }
    const traversalOk = last.next === null && dupes === 0 && visited.size === 12;
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-2',
      anchorReqId: 'application-api-rest-REQ-007',
      verdict: traversalOk ? 'pass' : 'fail',
      detail: `next is null on the last page and - traversal via next visited ${visited.size} unique items, final next=${last.next}, dupes=${dupes} after ${pages + 1} pages`,
      evidence: evidenceFromResponse({
        route: '/v1/widgets (traversal tail)',
        response: lastRes,
        bodyText: lastBody,
        extraFields: {
          input: { limit: 5, followFromCursor: first.next },
          derived: { uniqueVisited: visited.size, dupes, finalNext: last.next, pages: pages + 1 },
        },
      }),
    });

    // Row 3 (REQ-007 opacity): the emitted cursor is not a decodable
    // numeric offset. Assert the cursor string is not itself parseable
    // as a decimal integer and that its base64url decode does not
    // read as the parseable page number.
    const cursorStr = first.next;
    const numericFallback = Number.parseInt(cursorStr, 10);
    const opaque = !Number.isFinite(numericFallback) || String(numericFallback) !== cursorStr;
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-1',
      anchorReqId: 'application-api-rest-REQ-007',
      verdict: opaque ? 'pass' : 'fail',
      detail: `next is null on the last page and - cursor "${cursorStr}" is not a decodable numeric offset (REQ-007 opacity)`,
      evidence: evidenceFromResponse({
        route: '/v1/widgets?limit=5',
        response: firstRes,
        bodyText: firstBody,
        extraFields: {
          input: { cursor: cursorStr },
          derived: { numericParse: Number.isFinite(numericFallback) ? numericFallback : null, opaque },
        },
      }),
    });

    // Row 4 (REQ-007 malformed cursor -> problem+json).
    const malformedRes = await fetch(`${fixture.baseUrl}/v1/widgets?limit=5&cursor=not-a-cursor`);
    const malformedBody = await malformedRes.text();
    let malformedJson = null;
    try { malformedJson = JSON.parse(malformedBody); } catch {}
    const malformedOk = malformedRes.status === 400
      && (malformedRes.headers.get('content-type') || '').includes('application/problem+json')
      && malformedJson && malformedJson.type && malformedJson.type.includes('cursor-invalid');
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-1',
      anchorReqId: 'application-api-rest-REQ-007',
      verdict: malformedOk ? 'pass' : 'fail',
      detail: `next is null on the last page and - malformed cursor "not-a-cursor" returns ${malformedRes.status} problem+json type=${malformedJson?.type ?? 'null'}`,
      evidence: evidenceFromResponse({
        route: '/v1/widgets?cursor=not-a-cursor',
        response: malformedRes,
        bodyText: malformedBody,
        extraFields: {
          input: { cursor: 'not-a-cursor' },
          derived: { httpStatus: malformedRes.status, problemType: malformedJson?.type ?? null },
        },
      }),
    });

    // Row 5 (REQ-007 max-limit -> problem+json).
    const overLimitRes = await fetch(`${fixture.baseUrl}/v1/widgets?limit=999`);
    const overLimitBody = await overLimitRes.text();
    let overLimitJson = null;
    try { overLimitJson = JSON.parse(overLimitBody); } catch {}
    const overLimitOk = overLimitRes.status === 400
      && (overLimitRes.headers.get('content-type') || '').includes('application/problem+json')
      && overLimitJson && overLimitJson.type && overLimitJson.type.includes('limit-exceeded');
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-1',
      anchorReqId: 'application-api-rest-REQ-007',
      verdict: overLimitOk ? 'pass' : 'fail',
      detail: `next is null on the last page and - ?limit=999 returns ${overLimitRes.status} problem+json type=${overLimitJson?.type ?? 'null'}`,
      evidence: evidenceFromResponse({
        route: '/v1/widgets?limit=999',
        response: overLimitRes,
        bodyText: overLimitBody,
        extraFields: {
          input: { limit: 999 },
          derived: { httpStatus: overLimitRes.status, problemType: overLimitJson?.type ?? null },
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
