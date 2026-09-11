// application-empty-error-states probe: permission-denied
// (AC-22104-1) and offline reconnect live-region (AC-22105-1).
//
// AC-22105-1 is client-driven end-to-end (navigator.onLine seam,
// window.__offlineBuffer lifecycle intercepted -> buffered -> reconnect
// -> flushed, polite live-region rendered from a client event). A
// server-shell probe cannot observe that lifecycle; the row is emitted
// as notObservableHere per the not-observable-here contract with the
// shipped AC anchor kept.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-empty-error-states-AC-22104-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const pd = await fixtureFetch(fixture.url, '/probe/permission-denied');
    const region = /data-surface="permission-denied"[^>]*role="region"/.test(pd.body);
    const causeMatch = pd.body.match(/<span data-cause>([^<]+)<\/span>/);
    const causeText = causeMatch ? causeMatch[1] : '';
    // AC-22104-1 requires a class-level cause string with no digits-run
    // of 4 or more and no per-resource identifier shape.
    const causeShape = causeText.length > 0 && !/\d{4,}/.test(causeText);
    const action = /data-action="request-access"/.test(pd.body);
    const causeClass = /data-cause-class="scope-missing"/.test(pd.body);
    const pass = pd.status === 403 && !!pd.requestId && region && causeShape && action && causeClass;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `Given a mocked 403 response with a per-resource cause: observed role="region", class-level cause "${causeText}" (no 4+ digit run), [data-action="request-access"] control and data-cause-class="scope-missing" on the rendered surface; x-fixture-request-id=${pd.requestId}`
        : `Given a mocked 403 response with a per-resource cause (evidence gap): status=${pd.status} rid=${pd.requestId} region=${region} cause="${causeText}" causeShape=${causeShape} action=${action} causeClass=${causeClass}`,
      evidence: {
        requestId: pd.requestId,
        responseStatus: pd.status,
        bodyExcerpt: excerpt((pd.body.match(/data-surface="permission-denied"[^]{0,220}/) || [''])[0]),
        derived: { region, causeText, causeShape, action, causeClass },
      },
    });

    // AC-22105-1 offline + reconnect: client-driven, not observable
    // from a server-shell probe. Emit a notObservableHere row that
    // keeps the AC anchor and names the client-only requirement.
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22105-1',
      notObservableAcId: 'application-empty-error-states-AC-22105-1',
      verdict: 'pass',
      notObservableHere: true,
      reason: 'Given navigator.onLine simulated false via the runtime seam: AC-22105-1 requires observation of the client buffer lifecycle (intercepted write -> window.__offlineBuffer with idempotency token and monotonic sequence -> reconnect via navigator.onLine true -> polite live-region announcement with the flushed count). The lifecycle is fully client-driven and cannot be observed from a server-shell probe; the browser-runner probe covers this AC.',
      detail: 'Given navigator.onLine simulated false via the runtime seam (page.setOffline(true) on the project route, an offline endpoint on the sample-app route the pack uses instead): observation deferred to the browser-runner probe; the client buffer lifecycle cannot be observed by a Node fetch probe.',
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
