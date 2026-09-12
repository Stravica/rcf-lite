// application-onboarding-tour probe: first-run tour open (AC-26101-1).
//
// AC-26101-1 requires observing the tour dialog opening on the SPA
// for a first-run principal, Escape dismissing the tooltip, and a
// keyboard-only walk of the tour controls (WCAG 2.1.1, 2.1.2, 2.4.3).
// Every one of those assertions is browser-only: the tour tooltip is
// created by client script in the DOM, focus movement and Escape
// dismissal are browser events, and no server-side marker in this
// fixture represents the dialog-open state. Attempting to observe
// the tour open from a fixture HTTP response would only inspect the
// script's source text, not the dialog itself, so this probe emits
// notObservableHere rows naming AC-26101-1 and defers the observed
// assertion to the pack's browser check.
//
// The fixture is still spun up so the run record proves the fixture
// answers the route, matching the pack's environment expectations.
//
// AC-26101-1 first eight words: "Given a first-run principal on the SPA, the".

import { fixtureFetch, startFixture } from './probe-utils.mjs';

export const anchorAcId = 'application-onboarding-tour-AC-26101-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    // Prove the fixture is answering the SPA route before deferring the
    // observation to the browser check; the response itself carries no
    // AC-observable content.
    for (const route of ['/tour', '/onboarding', '/welcome']) {
      const res = await fixtureFetch(fixture.url, route);
      const reachable = res.status === 200 && !!res.requestId;
      results.push({
        anchorAcId,
        notObservableAcId: anchorAcId,
        verdict: 'warn',
        notObservableHere: true,
        reason: 'AC-26101-1 requires observing the tour dialog opening on the SPA, focus movement to the tooltip, and Escape dismissing the dialog on a keyboard-only walk; those are DOM/browser events created by client script and cannot be observed from a fixture HTTP response body. The tour open is deferred to the browser check in application-onboarding-tour.pack.mjs.',
        detail: `Given a first-run principal on the SPA, the tour-open assertion is browser-only for route ${route}; fixture reachability confirmed (status=${res.status}, requestId=${res.requestId || 'absent'}, reachable=${reachable}).`,
      });
    }
    // Returning-principal suppression (a stored completion record must
    // suppress the auto-open on the SPA) is AC-26104-1's clause, not
    // AC-26101-1's. The server-side half of that AC (the completion
    // store and the /tour data-tour-first-run="false" flag it drives on
    // the next principal load) is observed positively by the
    // completion-persistence probe. The client-side auto-open
    // suppression itself (the JS-driven decision on the SPA) is
    // browser-only; recorded here as notObservableHere against
    // AC-26104-1 (the AC the suppression belongs to) so the operator
    // sees the browser-only gap.
    const suppressionAcId = 'application-onboarding-tour-AC-26104-1';
    results.push({
      anchorAcId: suppressionAcId,
      notObservableAcId: suppressionAcId,
      verdict: 'warn',
      notObservableHere: true,
      reason: 'AC-26104-1 requires that activating the restart-tour control clears the completion state and re-opens the tour on the next principal load; the server-observable half (server-side completion store + data-tour-first-run flag on /tour + the /actions/restart-tour form action) is covered positively by completion-persistence. The client-JS-driven auto-open suppression on the SPA (readCompletion -> !alreadyDone -> openStep(0)) is browser-only and cannot be observed from a fixture HTTP response. Deferred to the browser check.',
      detail: 'Given a completed tour, the completion state persists per principal in the applied store; the client-side auto-open suppression branch (a stored completion record stops the client script re-opening the tour on the SPA) is browser-only. The server-side half of AC-26104-1 is positively observed by completion-persistence; this row records the client-only gap explicitly.',
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
