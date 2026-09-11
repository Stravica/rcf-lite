// cursor-pagination-round-trip probe for application-api-rest v2.1.10.
//
// AC-2109-1 envelope, AC-2109-2 traversal, AC-2109-3 opacity and
// malformed cursor, AC-2109-5 declared max limit enforcement.
//
// anchorAcId: per-row.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-007';
export const accountBound = false;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Row 1 (AC-2109-1): first-page envelope carries items, next, prev.
    const firstRes = await fetch(`${fixture.baseUrl}/v1/widgets?limit=5`);
    const firstBody = await firstRes.text();
    const first = JSON.parse(firstBody);
    const envelopeOk = Array.isArray(first.items)
      && first.items.length === 5
      && typeof first.next === 'string'
      && first.prev === null;
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-1',
      verdict: firstRes.status === 200 && envelopeOk ? 'pass' : 'fail',
      detail: `Every collection endpoint accepts ?cursor= and ?limit= and - GET /v1/widgets?limit=5 returned items[${first.items?.length ?? 0}] next=${typeof first.next}(${(first.next || '').slice(0, 12)}...) prev=${first.prev}`,
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

    // Row 2 (AC-2109-2): traversal visits every item exactly once and next is null on the last page.
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
      verdict: traversalOk ? 'pass' : 'fail',
      detail: `next is null on the last page and - traversal via next visited ${visited.size} unique items over ${pages + 1} pages, dupes=${dupes}, final next=${last.next}`,
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

    // Row 3 (AC-2109-3 opacity): the emitted token is not a decodable
    // positional marker. It is an opaque UUID; base64url decode is not
    // parseable as JSON and any positional info the client tries to
    // recover fails.
    const cursorStr = first.next;
    const numericFallback = Number.parseInt(cursorStr, 10);
    const parseableAsInt = Number.isFinite(numericFallback) && String(numericFallback) === cursorStr;
    let base64JsonReadable = false;
    try {
      const decoded = Buffer.from(cursorStr, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object') base64JsonReadable = true;
    } catch { base64JsonReadable = false; }
    const looksLikeUuid = UUID_RE.test(cursorStr);
    const opaque = !parseableAsInt && !base64JsonReadable;
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-3',
      verdict: opaque ? 'pass' : 'fail',
      detail: `Cursors are opaque: they carry no client-decodable positional - cursor "${cursorStr}" parseableAsInt=${parseableAsInt} base64UrlJsonReadable=${base64JsonReadable} looksLikeUuid=${looksLikeUuid}`,
      evidence: evidenceFromResponse({
        route: '/v1/widgets?limit=5',
        response: firstRes,
        bodyText: firstBody,
        extraFields: {
          input: { cursor: cursorStr },
          derived: { parseableAsInt, base64UrlJsonReadable: base64JsonReadable, looksLikeUuid, opaque },
        },
      }),
    });

    // Row 4 (AC-2109-3 malformed cursor -> problem+json).
    const malformedRes = await fetch(`${fixture.baseUrl}/v1/widgets?limit=5&cursor=not-a-cursor`);
    const malformedBody = await malformedRes.text();
    let malformedJson = null;
    try { malformedJson = JSON.parse(malformedBody); } catch {}
    const malformedOk = malformedRes.status === 400
      && (malformedRes.headers.get('content-type') || '').includes('application/problem+json')
      && malformedJson && malformedJson.type && malformedJson.type.includes('cursor-invalid');
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-3',
      verdict: malformedOk ? 'pass' : 'fail',
      detail: `Cursors are opaque: they carry no client-decodable positional - malformed cursor "not-a-cursor" returned ${malformedRes.status} problem+json type=${malformedJson?.type ?? 'null'}`,
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

    // Row 5 (AC-2109-5 max-limit -> problem+json).
    const overLimitRes = await fetch(`${fixture.baseUrl}/v1/widgets?limit=999`);
    const overLimitBody = await overLimitRes.text();
    let overLimitJson = null;
    try { overLimitJson = JSON.parse(overLimitBody); } catch {}
    const overLimitOk = overLimitRes.status === 400
      && (overLimitRes.headers.get('content-type') || '').includes('application/problem+json')
      && overLimitJson && overLimitJson.type && overLimitJson.type.includes('limit-exceeded');
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-5',
      verdict: overLimitOk ? 'pass' : 'fail',
      detail: `The declared maximum limit is enforced: a request - ?limit=999 returned ${overLimitRes.status} problem+json type=${overLimitJson?.type ?? 'null'}`,
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
