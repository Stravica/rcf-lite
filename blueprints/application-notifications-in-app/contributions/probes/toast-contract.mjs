// application-notifications-in-app probe: toast role/priority mapping
// and the WCAG 2.2.1 timeout floor (AC-20102-1).
//
// AC-20102-1 semantics are client-driven in the shipped fixture:
// toasts render only after client JS runs (a POST /__emit path is
// server-recorded but the DOM effect happens in the browser), and the
// elapsed timeout and focus-pause behaviour are browser-only. A
// server-side HTML probe cannot observe any of them here without a
// browser step, and this pack is fixture-HTTP-only.
//
// The row is therefore emitted as notObservableHere for AC-20102-1
// with a reason naming the browser piece the pack would need. No
// evidence object is carried (per the not-observable-here contract). The pack
// aggregate becomes warn (AMBER) via the shared aggregate() rule.

import { startFixture } from './probe-utils.mjs';

export const anchorAcId = 'application-notifications-in-app-AC-20102-1';
export const accountBound = false;

export default async function runProbe() {
  // Boot and immediately tear down the fixture so the probe still
  // exercises the fixture lifecycle (teardown-fails-verdict rule);
  // the AC observation itself needs a browser step, so no HTTP
  // observation is emitted here.
  const fixture = await startFixture();
  try {
    return {
      results: [{
        anchorAcId,
        notObservableAcId: anchorAcId,
        verdict: 'pass',
        notObservableHere: true,
        reason: 'AC-20102-1 requires observing client-driven toast emission into [data-live-region="polite"] with role="status" for info and [data-live-region="assertive"] with role="alert" for error, plus the six-second elapsed-timeout and focus-pause behaviour on data-shown-at/data-dismissed-at; toast rendering is client-JS-only in the fixture and elapsed timing and focus behaviour are browser-only, so a fixture-HTTP-only probe cannot observe them; a Playwright-driven check is required.',
        detail: 'Given a toast triggered by a background event; not observable at the fixture HTTP surface: toast DOM is emitted by client JS after load and the six-second elapsed timeout plus focus-pause behaviour are browser-only; needs a Playwright-driven observation to derive role, wrapper mapping and elapsed data-dismissed-at minus data-shown-at.',
      }],
    };
  } finally {
    await fixture.kill();
  }
}
