// application-notifications-in-app probe: toast role/priority mapping
// and the WCAG 2.2.1 timeout floor (AC-20102-1) plus the focus-pause
// clause (AC-20102-4).
//
// AC-20102-1 concerns the client-JS-rendered toast DOM (priority to
// role/wrapper mapping, one wrapper per body, data-shown-at and
// data-dismissed-at ISO timestamps, elapsed timeout at or above the
// six-second floor). All of that is browser-only in this fixture:
// the toast DOM is created by the client script and the elapsed
// timing runs off a browser timer. The AC-20102-1 clause is emitted
// as a notObservableHere row anchored to AC-20102-1 (no focus-pause
// language - focus-pause is a separate AC, AC-20102-4).
//
// AC-20102-4 is the focus-pause clause: a focused toast pauses the
// timer and dismissal removes the toast. The fixture's current toast
// factory renders the toast in client JS, sets data-dismissed-at on
// dismiss but does not remove the toast from the DOM and does not
// pause the timer on focus. That is a fixture-level gap against the
// AC. Rather than attributing a positive observation, this probe
// emits a conformanceOnly row (null anchor, per the null-anchor +
// limitation contract) naming AC-20102-4 in the limitation so the
// AC-property gap is honestly recorded.
//
// The pack aggregate stays warn (AMBER) via the shared aggregate()
// rule (both rows carry verdict:'warn'). The fixture is still spun
// up so the probe exercises the fixture lifecycle
// (teardown-fails-verdict rule).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-notifications-in-app-AC-20102-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    // Reachability fetch: the fixture reports the shell root on /
    // with data-toast-timeout-floor-seconds and the two live-region
    // wrappers preseeded. Recorded so both conformance rows below
    // carry a live x-fixture-request-id and a body excerpt from this
    // run (rule-7d shape + tally: conformance rows require an
    // evidence object; the shell body proves the fixture answered
    // and lets a reader see the observable surface even though the
    // client-JS toast rendering itself is not observable here).
    const shell = await fixtureFetch(fixture.url, '/');
    const shellRootMatch = (shell.body.match(/<div[^>]*data-region="shell-root"[^]{0,240}/) || [''])[0];
    const timeoutFloorMatch = shell.body.match(/data-toast-timeout-floor-seconds="(\d+)"/);
    const timeoutFloorSeconds = timeoutFloorMatch ? Number(timeoutFloorMatch[1]) : null;

    results.push({
      anchorAcId,
      notObservableAcId: anchorAcId,
      verdict: 'warn',
      notObservableHere: true,
      reason: 'AC-20102-1 requires observing client-driven toast emission into [data-live-region="polite"] with role="status" for info and [data-live-region="assertive"] with role="alert" for error, one wrapper per body, data-shown-at and data-dismissed-at ISO timestamps on the toast element, and the elapsed time between them at or above the ADR-2102 six-second floor. Toast DOM is emitted by client JS after load and elapsed timing runs off a browser timer, so a fixture-HTTP-only probe cannot observe them; a Playwright-driven check is required.',
      detail: `Given a toast triggered by a background event, priority-to-role/wrapper mapping, one-shot announcement per wrapper, and the WCAG 2.2.1 six-second elapsed-timeout floor on data-shown-at/data-dismissed-at are all browser-only in this fixture; the shell root observed at GET / carries data-toast-timeout-floor-seconds=${timeoutFloorSeconds} (server-rendered constant, not the client-JS-driven toast) so the fixture reachability is recorded; needs a Playwright-driven observation for the toast contract itself; x-fixture-request-id=${shell.requestId}.`,
      evidence: {
        requestId: shell.requestId,
        responseStatus: shell.status,
        bodyExcerpt: excerpt(shellRootMatch),
        derived: {
          route: '/',
          timeoutFloorSecondsServerRendered: timeoutFloorSeconds,
          shellRootPresent: shellRootMatch.length > 0,
        },
      },
    });

    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: 'application-notifications-in-app-AC-20102-4: the focus-pause clause (a focused toast pauses the timer and resumes on focus loss) and the toast-dismissal DOM-removal contract require observing a running browser (focus events, timer state and DOM mutation), and additionally the shipped fixture toast factory does not pause the timer on focus and marks dismissal by setting data-dismissed-at rather than removing the toast from the DOM. Deferred to a Playwright-driven check and named here as a fixture gap so the operator sees the property claim without a positive observation.',
      verdict: 'warn',
      detail: `Given a toast triggered by a background event and a focused-toast clause per AC-20102-4, the focus-pause + dismissal-removal properties are not observed by this Node HTTP probe and the shipped fixture does not implement them; this row is a null-anchored conformance de-claim so the AC-20102-4 gap is on the record; fixture reachability confirmed via the same shell fetch (x-fixture-request-id=${shell.requestId}).`,
      evidence: {
        requestId: shell.requestId,
        responseStatus: shell.status,
        bodyExcerpt: excerpt(shellRootMatch),
        derived: {
          route: '/',
          focusPauseObserved: false,
          dismissalRemovesToast: false,
          reason: 'browser-only clauses of AC-20102-4; fixture does not implement them either',
        },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
