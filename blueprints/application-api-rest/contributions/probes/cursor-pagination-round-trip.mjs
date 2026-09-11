// cursor-pagination-round-trip probe for application-api-rest v2.1.7.
//
// Verifies AC-2109-1 (envelope with items, next, prev) on page one
// and AC-2109-2 (following next repeatedly visits every item
// exactly once with a null next on the last page) via a real
// traversal of every page.
//
// anchorAcId: application-api-rest-AC-2109-1 (row 1) and
// application-api-rest-AC-2109-2 (row 2).

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-007';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Row 1: page one carries items[], next (string), prev (null on
    // page one). Envelope shape check anchors AC-2109-1.
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
      detail: firstRes.status === 200 && envelopeOk
        ? `Every collection endpoint accepts ?cursor= and ?limit= and - GET /v1/widgets?limit=5 returned items[5] with next="${first.next}" prev=null (REQ-007 envelope)`
        : `Every collection endpoint accepts ?cursor= and ?limit= and - envelope fault: status=${firstRes.status} itemsLen=${first.items ? first.items.length : 'null'} next=${first.next} prev=${first.prev}`,
      evidence: evidenceFromResponse({
        route: '/v1/widgets?limit=5',
        response: firstRes,
        bodyText: firstBody,
        extraFields: {
          input: { limit: 5, cursor: null },
          derived: { itemsLen: first.items ? first.items.length : 0, next: first.next, prev: first.prev, firstIds: (first.items || []).map((i) => i.id) },
        },
      }),
    });

    // Row 2: walk to the last page via next. Assert every item
    // appears exactly once and the final next is null (AC-2109-2).
    // The derived output is the visited set, not a constant.
    const visited = new Set();
    let dupes = 0;
    let cursor = null;
    let pages = 0;
    let last = first;
    let lastRes = firstRes;
    let lastBody = firstBody;
    for (const it of first.items) {
      if (visited.has(it.id)) dupes += 1;
      visited.add(it.id);
    }
    cursor = first.next;
    while (cursor && pages < 20) {
      const url = `${fixture.baseUrl}/v1/widgets?limit=5&cursor=${cursor}`;
      const r = await fetch(url);
      const b = await r.text();
      const p = JSON.parse(b);
      for (const it of (p.items || [])) {
        if (visited.has(it.id)) dupes += 1;
        visited.add(it.id);
      }
      last = p;
      lastRes = r;
      lastBody = b;
      cursor = p.next;
      pages += 1;
    }
    const traversalOk = last.next === null && dupes === 0 && visited.size === 12;
    results.push({
      anchorAcId: 'application-api-rest-AC-2109-2',
      anchorReqId: 'application-api-rest-REQ-007',
      verdict: traversalOk ? 'pass' : 'fail',
      detail: traversalOk
        ? `next is null on the last page and - traversal via next visited ${visited.size} unique items, final next=null after ${pages + 1} pages`
        : `next is null on the last page and - traversal fault: unique=${visited.size} dupes=${dupes} finalNext=${last.next} pages=${pages + 1}`,
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
    return { results };
  } finally {
    await fixture.close();
  }
}
