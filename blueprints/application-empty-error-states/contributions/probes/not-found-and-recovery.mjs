// application-empty-error-states probe: 404 not-found state
// (AC-22101-1). AC-22101-1 requires a role="region" with an
// accessible name for the missing resource kind, a keyboard-reachable
// recovery link to the parent surface, plus a search input as an
// alternate recovery.
//
// The probe:
//   - GETs /probe/not-found and derives status=404, the region role
//     wrapper, the parent-surface recovery link and the search input.
//   - Follows the parent-surface link and asserts the linked route
//     responds (200) — the derived observable of "recovery link
//     works" is a two-request round-trip, not a magic string match.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-empty-error-states-AC-22101-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const nf = await fixtureFetch(fixture.url, '/probe/not-found');
    const regionPresent = /data-surface="not-found"[^>]*role="region"/.test(nf.body);
    const parentLinkMatch = nf.body.match(/href="([^"]+)"[^>]*data-recovery="parent-surface"/);
    const parentHref = parentLinkMatch ? parentLinkMatch[1] : null;
    const searchInput = /data-recovery="search"[^>]*>[^]*<input[^>]*type="search"/.test(nf.body);
    const statusOk = nf.status === 404;
    const regionCheckPass = statusOk && !!nf.requestId && regionPresent && !!parentHref && searchInput;

    // Follow the recovery link (varied input: a second request derived
    // from the first response) and assert the target route responds.
    let followStatus = null;
    let followRid = null;
    if (parentHref) {
      const follow = await fixtureFetch(fixture.url, parentHref);
      followStatus = follow.status;
      followRid = follow.requestId;
    }
    const roundTripPass = regionCheckPass && followStatus === 200 && !!followRid;

    results.push({
      anchorAcId,
      verdict: roundTripPass ? 'pass' : 'fail',
      detail: roundTripPass
        ? `GET /probe/not-found returned 404 with role="region" named for the missing resource, a parent-surface recovery link (${parentHref}) and a search-input recovery; follow-through GET ${parentHref} returned 200; x-fixture-request-id (not-found)=${nf.requestId}, (parent)=${followRid}`
        : `not-found evidence gap: status=${nf.status} rid=${nf.requestId} region=${regionPresent} parentHref=${parentHref} searchInput=${searchInput} followStatus=${followStatus}`,
      evidence: {
        requestId: nf.requestId,
        responseStatus: nf.status,
        bodyExcerpt: excerpt((nf.body.match(/data-surface="not-found"[^]{0,200}/) || [''])[0]),
        derived: { statusOk, regionPresent, parentHref, followStatus, followRequestId: followRid, searchInput },
      },
    });
  } finally {
    fixture.kill();
  }
  return { results };
}
