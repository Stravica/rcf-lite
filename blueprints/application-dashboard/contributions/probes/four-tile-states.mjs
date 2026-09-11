// four-tile-states probe for application-dashboard v1.0.4.
//
// Verifies that every tile renders one of four states (REQ-003):
// loading, empty, error, populated. Pins the primary tile into each
// state via ?tile=primary&state=<state> and asserts the DOM carries
// data-tile-state="<state>" and a state-cue with a non-colour label.
// Records the request id and body excerpt as evidence per state.
//
// anchorReqId: application-dashboard-REQ-003.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-003';
export const accountBound = false;

const STATES = ['loading', 'empty', 'error', 'populated'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    for (const state of STATES) {
      const res = await fetch(`${fixture.baseUrl}/?tile=primary&state=${state}`);
      const body = await res.text();
      const stateOnPrimary = new RegExp(`data-tile-id="primary"[^>]*data-tile-state="${state}"`).test(body);
      const cueLabel = new RegExp(`data-state-cue="${state}"`).test(body);
      const pass = res.status === 200 && stateOnPrimary && cueLabel;
      results.push({
        anchorReqId: 'application-dashboard-REQ-003',
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `primary tile renders state="${state}" with data-state-cue label`
          : `state-render fault at ${state}: primaryHasState=${stateOnPrimary} cueLabel=${cueLabel}`,
        evidence: evidenceFromResponse({ route: `/?tile=primary&state=${state}`, response: res, bodyText: body, extraFields: { state } }),
      });
    }
    return { results };
  } finally {
    await fixture.close();
  }
}
