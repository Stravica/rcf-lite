// application-empty-error-states probe: empty-list state
// (AC-22106-1) and no-search-results state echoing the query
// (AC-22107-1).

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
        ? `GET /probe/empty-list returned 200 with role="region", data-visual="empty-list" wrapper and keyboard-reachable data-recovery="create" link; x-fixture-request-id=${empty.requestId}`
        : `empty-list evidence gap: status=${empty.status} rid=${empty.requestId} region=${region} visual=${visualWrapper} recovery=${recoveryLink}`,
      evidence: {
        requestId: empty.requestId,
        responseStatus: empty.status,
        bodyExcerpt: excerpt((empty.body.match(/data-surface="empty-list"[^]{0,220}/) || [''])[0]),
        derived: { region, visualWrapper, recoveryLink },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/probe/empty-list?break=no-recovery');
    const brokenRecovery = /data-recovery="create"/.test(broken.body);
    const brokenPass = broken.status === 200 && !!broken.requestId && !brokenRecovery;
    results.push({
      anchorAcId,
      verdict: brokenPass ? 'pass' : 'fail',
      detail: brokenPass
        ? `GET /probe/empty-list?break=no-recovery returned 200 and dropped data-recovery="create"; the AC-22106-1 recovery-link check would refuse; x-fixture-request-id=${broken.requestId}`
        : `no-recovery break gap: status=${broken.status} rid=${broken.requestId} recoveryPresent=${brokenRecovery}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/data-visual="empty-list"[^]{0,200}/) || [''])[0]),
        derived: { brokenRecovery },
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
        ? `GET /probe/search?q=${query} returned 200; derived data-query span echoed the varied query verbatim ("${derivedQ}"); data-visual="no-search-results" and clear-filters recovery present; x-fixture-request-id=${noSearch.requestId}`
        : `no-search evidence gap: status=${noSearch.status} rid=${noSearch.requestId} region=${nsRegion} visual=${nsVisual} echoed=${echoed} derived="${derivedQ}" expected="${query}" clear=${clearControl}`,
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
