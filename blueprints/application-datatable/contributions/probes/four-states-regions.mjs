// four-states-regions probe for application-datatable v1.0.6.
//
// Verifies AC-17105-1: each of the four AC-declared states
// (empty, loading, error, no-results) renders inside its own
// role="region" element carrying aria-live="polite". The `populated`
// state is not part of AC-17105-1 (the grid itself renders in that
// case, not a state region), so it is excluded from this probe.
//
// anchorAcId: application-datatable-AC-17105-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-005';
export const accountBound = false;

const STATE_TO_REGION = {
  empty: 'emptyRegion',
  loading: 'loadingRegion',
  error: 'errorRegion',
  'no-results': 'noResultsRegion',
};

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    for (const [state, regionId] of Object.entries(STATE_TO_REGION)) {
      const res = await fetch(`${fixture.baseUrl}/?state=${state}`);
      const body = await res.text();
      const pattern = new RegExp(`<section[^>]+role="region"[^>]+aria-live="polite"[^>]+id="${regionId}"`);
      const alternate = new RegExp(`<section[^>]+id="${regionId}"[^>]+role="region"[^>]+aria-live="polite"`);
      const regionOk = pattern.test(body) || alternate.test(body);
      // AC-17105-2: state text must name the state (WCAG 1.4.1)
      const textNamed = new RegExp(state === 'no-results' ? '(No results|no results)' : `(${state.charAt(0).toUpperCase()}${state.slice(1)}|${state})`, 'i').test(body);
      const pass = res.status === 200 && regionOk && textNamed;
      results.push({
        anchorAcId: 'application-datatable-AC-17105-1',
        anchorReqId: 'application-datatable-REQ-005',
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `Given a datatable route in each of the - state="${state}" renders <section role="region" aria-live="polite" id="${regionId}"> with text naming the state`
          : `Given a datatable route in each of the - state region fault at ${state}: expected id="${regionId}" with role/aria-live and text; regionOk=${regionOk} textNamed=${textNamed} status=${res.status}`,
        evidence: evidenceFromResponse({
          route: `/?state=${state}`,
          response: res,
          bodyText: body,
          extraFields: {
            input: { state },
            derived: { regionId, regionOk, textNamed },
          },
        }),
      });
    }
    return { results };
  } finally {
    await fixture.close();
  }
}
