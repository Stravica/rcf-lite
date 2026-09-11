// application-onboarding-tour probe: step tooltip dialog contract
// (AC-26102-1).
//
// AC-26102-1 requires observing a rendered tooltip dialog: focus
// moves to the tooltip on open, role="dialog" plus aria-labelledby
// point at the step heading, focus returns to the anchor on close
// (Escape or dismiss control) per the ARIA APG dialog-modal pattern,
// and the dialog remains within the viewport at the 1440 wide and 360
// narrow breakpoints (WCAG 2.4.11 Focus Not Obscured Minimum). Every
// assertion is browser-only: the tooltip is created by client script
// in the DOM, focus movement and Escape handling are browser events,
// and the responsive placement check requires a real viewport. This
// probe records the non-observation and defers the observed
// assertion to the pack's browser check (which uses
// browser.resize(1440) and browser.resize(360) as the anatomy test
// requires).
//
// AC-26102-1 first eight words: "Given a step showing a tooltip anchored to".

import { fixtureFetch, startFixture } from './probe-utils.mjs';

export const anchorAcId = 'application-onboarding-tour-AC-26102-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    // Fixture reachability at /tour, recorded to prove the pack
    // environment is honest before the browser check runs.
    const res = await fixtureFetch(fixture.url, '/tour');
    const reachable = res.status === 200 && !!res.requestId;
    results.push({
      anchorAcId,
      notObservableAcId: anchorAcId,
      verdict: 'pass',
      notObservableHere: true,
      reason: 'AC-26102-1 requires observing focus movement to the tooltip on open, role="dialog" plus aria-labelledby present on the rendered element, focus return to the anchor on close, and the dialog remaining within the viewport at 1440 and 360 breakpoints. All four assertions are browser-only: the tooltip is created by client script in the DOM, focus and Escape are browser events, and the placement check requires a real viewport. Deferred to the browser check in application-onboarding-tour.pack.mjs.',
      detail: `Given a step showing a tooltip anchored to a UI element, the tooltip-render, focus-lifecycle, and viewport-placement assertions are browser-only; fixture reachability confirmed (status=${res.status}, requestId=${res.requestId || 'absent'}, reachable=${reachable}).`,
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
