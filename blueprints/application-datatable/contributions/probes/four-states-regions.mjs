// four-states-regions probe for application-datatable v1.0.8.
//
// Verifies AC-17105-1: each of the four AC-declared states
// (empty, loading, error, no-results) renders inside its own
// role="region" element carrying aria-live="polite". The no-results
// state is asserted under an ACTIVE filter (q=zzz-no-hits) so the
// fixture's "active filter with zero matches" branch is exercised
// (AC-17105-1's condition).
//
// anchorAcId: application-datatable-AC-17105-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-005';
export const accountBound = false;

const STATE_MATRIX = [
  { state: 'empty', regionId: 'emptyRegion', query: '' },
  { state: 'loading', regionId: 'loadingRegion', query: '' },
  { state: 'error', regionId: 'errorRegion', query: '' },
  { state: 'no-results', regionId: 'noResultsRegion', query: '&q=zzz-no-hits' },
];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    for (const { state, regionId, query } of STATE_MATRIX) {
      const res = await fetch(`${fixture.baseUrl}/?state=${state}${query}`);
      const body = await res.text();
      const pattern = new RegExp(`<section[^>]+role="region"[^>]+aria-live="polite"[^>]+id="${regionId}"`);
      const alternate = new RegExp(`<section[^>]+id="${regionId}"[^>]+role="region"[^>]+aria-live="polite"`);
      const regionOk = pattern.test(body) || alternate.test(body);
      const textNamed = new RegExp(state === 'no-results' ? '(No results|no results)' : `(${state.charAt(0).toUpperCase()}${state.slice(1)}|${state})`, 'i').test(body);
      const pass = res.status === 200 && regionOk && textNamed;
      results.push({
        anchorAcId: 'application-datatable-AC-17105-1',
        anchorReqId: 'application-datatable-REQ-005',
        verdict: pass ? 'pass' : 'fail',
        detail: `Given a datatable route in each of the - state="${state}" (query=${query || 'none'}) renders <section role="region" aria-live="polite" id="${regionId}"> with text naming the state`,
        evidence: evidenceFromResponse({
          route: `/?state=${state}${query}`,
          response: res,
          bodyText: body,
          extraFields: {
            input: { state, activeFilter: query.replace('&q=', '') || null },
            derived: { regionId, regionOk, textNamed },
          },
        }),
      });
    }
    // Negative case: state=no-results WITHOUT q falls back to
    // populated grid (no noResultsRegion). Derived output is that
    // absence.
    const negRes = await fetch(`${fixture.baseUrl}/?state=no-results`);
    const negBody = await negRes.text();
    const negHasNoResults = /<section[^>]+id="noResultsRegion"/.test(negBody);
    const negHasGrid = /<section[^>]+id="gridRegion"/.test(negBody);
    const negOk = negRes.status === 200 && !negHasNoResults && negHasGrid;
    results.push({
      anchorAcId: 'application-datatable-AC-17105-1',
      anchorReqId: 'application-datatable-REQ-005',
      verdict: negOk ? 'pass' : 'fail',
      detail: `Given a datatable route in each of the - state=no-results without an active filter falls back to populated grid (AC-17105-1's active-filter condition): noResultsRegion=${negHasNoResults} gridRegion=${negHasGrid}`,
      evidence: evidenceFromResponse({
        route: '/?state=no-results',
        response: negRes,
        bodyText: negBody,
        extraFields: {
          input: { state: 'no-results', activeFilter: null },
          derived: { hasNoResultsRegion: negHasNoResults, hasGridRegion: negHasGrid },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
