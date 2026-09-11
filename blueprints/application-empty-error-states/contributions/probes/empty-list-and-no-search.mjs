// application-empty-error-states probe: empty-list state
// (AC-22106-1) and no-search-results state echoing the query
// (AC-22107-1). Broken-variant row on empty-list?break=no-recovery
// was removed under the positive-anchor cleanup (positive-anchor on
// absence is void).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-empty-error-states-AC-22106-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const empty = await fixtureFetch(fixture.url, '/probe/empty-list');
    const region = /data-surface="empty-list"[^>]*role="region"/.test(empty.body);
    const visualWrapper = /data-visual="empty-list"/.test(empty.body);
    const recoveryLink = /data-recovery="create"/.test(empty.body);
    const emptyPass = empty.status === 200 && !!empty.requestId && region && visualWrapper && recoveryLink;
    results.push({
      anchorAcId,
      verdict: emptyPass ? 'pass' : 'fail',
      detail: emptyPass
        ? `Given a listing endpoint returning an empty array, observed role="region", data-visual="empty-list" wrapper and keyboard-reachable [data-recovery="create"] link on the rendered surface; x-fixture-request-id=${empty.requestId}`
        : `Given a listing endpoint returning an empty array, evidence gap: status=${empty.status} rid=${empty.requestId} region=${region} visual=${visualWrapper} recovery=${recoveryLink}`,
      evidence: {
        requestId: empty.requestId,
        responseStatus: empty.status,
        bodyExcerpt: excerpt((empty.body.match(/data-surface="empty-list"[^]{0,220}/) || [''])[0]),
        derived: { region, visualWrapper, recoveryLink },
      },
    });

    // AC-22107-1: query echoed verbatim inside data-query span.
    const query = 'probe-search-' + Math.random().toString(36).slice(2, 8);
    const noSearch = await fixtureFetch(fixture.url, `/probe/search?q=${encodeURIComponent(query)}`);
    const nsRegion = /data-surface="no-search-results"[^>]*role="region"/.test(noSearch.body);
    const nsVisual = /data-visual="no-search-results"/.test(noSearch.body);
    const qMatch = noSearch.body.match(/<span data-query>([^<]*)<\/span>/);
    const derivedQ = qMatch ? qMatch[1] : '';
    const echoed = derivedQ === query;
    const clearControl = /data-recovery="clear-filters"/.test(noSearch.body);
    const nsPass = noSearch.status === 200 && !!noSearch.requestId && nsRegion && nsVisual && echoed && clearControl;
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22107-1',
      verdict: nsPass ? 'pass' : 'fail',
      detail: nsPass
        ? `Given a search or filter yielding zero rows, observed role="region", data-visual="no-search-results" wrapper, [data-recovery="clear-filters"] control and a data-query span echoing the varied query verbatim ("${derivedQ}"); x-fixture-request-id=${noSearch.requestId}`
        : `Given a search or filter yielding zero rows, evidence gap: status=${noSearch.status} rid=${noSearch.requestId} region=${nsRegion} visual=${nsVisual} echoed=${echoed} derived="${derivedQ}" expected="${query}" clear=${clearControl}`,
      evidence: {
        requestId: noSearch.requestId,
        responseStatus: noSearch.status,
        bodyExcerpt: excerpt((noSearch.body.match(/<span data-query>[^<]*<\/span>[^]{0,140}/) || [''])[0]),
        derived: { query, derivedQ, echoed, clearControl },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
