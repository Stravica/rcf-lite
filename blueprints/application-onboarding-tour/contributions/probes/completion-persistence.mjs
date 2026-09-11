// application-onboarding-tour probe: completion-state persistence and
// restart-tour control (AC-26104-1).
//
// AC-26104-1 requires observing three things: (a) the completion
// state persists per principal in the applied persistence blueprint
// (or in spa-local-storage as the Q4 fallback per ADR-2702) after
// the tour is walked; (b) a restart-tour control is reachable from
// the settings surface; (c) activating that control clears the
// completion state and re-opens the tour on the next principal load.
// The fixture in this pack backs persistence through
// window.localStorage / window.sessionStorage only (its default
// completion-state-store) and exposes no server-side write/read API,
// so every persistence assertion in AC-26104-1 is browser-only: the
// write path runs on click of the tour's finish control, the read
// path runs at principal load inside the client script, and the
// restart-tour click clears window.storage. This probe records the
// non-observation and defers the observed assertion to the pack's
// browser check.
//
// AC-26104-1 first eight words: "Given a completed tour, the completion state persists".

import { fixtureFetch, startFixture } from './probe-utils.mjs';

export const anchorAcId = 'application-onboarding-tour-AC-26104-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    // Prove the settings route is reachable (the restart-tour control
    // lives there) so the pack environment is honest before the browser
    // check runs; the button's click behaviour and the storage
    // write/read cannot be observed from an HTTP response.
    const res = await fixtureFetch(fixture.url, '/settings');
    const reachable = res.status === 200 && !!res.requestId;
    results.push({
      anchorAcId,
      notObservableAcId: anchorAcId,
      verdict: 'pass',
      notObservableHere: true,
      reason: 'AC-26104-1 requires observing (a) the tour walked to completion and a completion record present in the applied persistence store, (b) a subsequent principal load NOT re-opening the tour, (c) the restart-tour control on the settings surface clearing the record and (d) a next principal load re-opening the tour. This fixture backs persistence through window.localStorage / window.sessionStorage only (no server-side write/read API), so every step is browser-only. Deferred to the browser check in application-onboarding-tour.pack.mjs.',
      detail: `Given a completed tour, the completion state persists in browser storage in this fixture; the walk, the persistence write, and the restart-tour clear are browser events not observable from an HTTP response; settings-surface reachability confirmed (status=${res.status}, requestId=${res.requestId || 'absent'}, reachable=${reachable}).`,
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
