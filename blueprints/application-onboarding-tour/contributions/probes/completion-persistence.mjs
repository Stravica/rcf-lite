// application-onboarding-tour probe: completion-state persistence and
// restart-tour activation (AC-26104-1) - server-side per-principal
// store (spa-local-storage and spa-session-storage variants are
// browser only; the server-side-per-principal store IS observable
// from a Node HTTP probe and this probe drives it via the applied
// completion API and the progressive-enhancement restart-tour form
// action, both of which are the fixture's own engine).
//
// AC-26104-1 first eight words: "Given a completed tour, the completion state persists".
//
// Server-observable steps this probe drives:
//   1. Fresh principalId: GET /api/tour/completion returns 404.
//   2. GET /tour renders data-tour-first-run="true" for the fresh
//      principal (the server-side first-run flag is derived from the
//      applied completion store on server render).
//   3. POST /api/tour/completion writes a record: 200 with the record
//      echoed.
//   4. GET /api/tour/completion returns 200 with the same record
//      (persistence across requests, i.e. the "restart read"): this
//      is the server-side persistence half of the AC.
//   5. GET /tour then renders data-tour-first-run="false" (the
//      completion feeds the server-derived first-run flag on the next
//      principal load).
//   6. GET /settings renders the restart-tour control inside a
//      <form method="post" action="/actions/restart-tour"> with the
//      principal-id in a hidden input (progressive enhancement:
//      activating the control POSTs the form even when JS is off).
//   7. POST /actions/restart-tour (the form submission the settings
//      restart control drives) returns 200 { ok:true, cleared:true }
//      and clears the server-side record.
//   8. GET /api/tour/completion returns 404 again (record cleared by
//      the restart-control activation).
//   9. GET /tour then renders data-tour-first-run="true" (the tour
//      re-opens on the next principal load, per AC-26104-1's
//      "activating the control ... re-opens the tour on the next
//      principal load" clause).
// Every step varies inputs (principalId is a fresh UUID, the record
// carries a distinct completedAt ISO) and asserts derived outputs
// the fixture had no choice about (the record echoed back, the
// data-tour-first-run flag flipping, the form-action response
// carrying cleared=true).
//
// The dialog-open behaviour and keyboard-only walk asked for by
// AC-26101-1 / AC-26102-1 are browser-only and covered by
// first-run-detection and stepper-role-dialog. This probe now
// observes AC-26104-1's persistence AND the server-observable half
// of the restart-tour activation (the form action the button fires
// server-side).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

export const anchorAcId = 'application-onboarding-tour-AC-26104-1';
export const accountBound = false;

const FIRST_EIGHT = 'Given a completed tour, the completion state persists';

export default async function runProbe() {
  const fixture = await startFixture({ env: { TOUR_STORE: 'server-side-per-principal' } });
  const results = [];
  try {
    const principalId = 'probe-tour-' + randomUUID();
    const completedAt = new Date().toISOString();
    const store = 'server-side-per-principal';
    // Step 1a: initial completion GET is 404 (no record for this principal).
    const initial = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=${store}`);
    const initialBody = JSON.parse(initial.body || '{}');
    // Step 1b: initial /tour render shows data-tour-first-run="true" for the
    // fresh principal (server-derived from the empty completion store).
    const initialTour = await fixtureFetch(fixture.url, `/tour?store=${store}&principal-id=${principalId}`);
    const initialFirstRunTrue = /data-tour-first-run="true"/.test(initialTour.body)
      && new RegExp(`data-tour-principal-id="${principalId}"`).test(initialTour.body);
    // Step 2: POST completion.
    const writeRes = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=${store}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ completedAt, blueprintSetVersion: '1.0.0', stepIds: ['step-1', 'step-2', 'step-3'] }),
    });
    const writeBody = JSON.parse(writeRes.body || '{}');
    // Step 3a: completion GET reflects the written record (server-scoped
    // persistence across requests).
    const readRes = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=${store}`);
    const readBody = JSON.parse(readRes.body || '{}');
    // Step 3b: /tour render for the same principal now shows
    // data-tour-first-run="false" (the completion feeds the server-derived
    // first-run flag on the next principal load).
    const afterWriteTour = await fixtureFetch(fixture.url, `/tour?store=${store}&principal-id=${principalId}`);
    const afterWriteFirstRunFalse = /data-tour-first-run="false"/.test(afterWriteTour.body);
    // Step 4: settings surface reachable and the restart-tour control
    // is inside a POST form pointing at /actions/restart-tour with the
    // principal-id in a hidden input (progressive-enhancement: this is
    // what activating the button does on the server, regardless of JS).
    const settings = await fixtureFetch(fixture.url, `/settings?store=${store}&principal-id=${principalId}`);
    const restartFormActionMatch = settings.body.match(/<form[^>]*method="post"[^>]*action="\/actions\/restart-tour[^"]*"[^>]*>[\s\S]*?<button[^>]*data-action="restart-tour"[\s\S]*?<\/form>/i);
    const settingsCarriesRestartForm = !!restartFormActionMatch
      && new RegExp(`name="principal-id"[^>]*value="${principalId}"`).test(restartFormActionMatch[0]);
    const settingsReachable = settings.status === 200 && !!settings.requestId && settingsCarriesRestartForm;
    // Step 5: POST /actions/restart-tour (the form submission the
    // restart control fires). This is the server-observable "restart
    // control activation" - the same POST fires whether the click was
    // JS-driven or a plain form submit.
    const restartRes = await fixtureFetch(fixture.url, `/actions/restart-tour?principal-id=${principalId}&store=${store}`, { method: 'POST' });
    let restartBody = {};
    try { restartBody = JSON.parse(restartRes.body || '{}'); } catch (_) { /* body parse */ }
    // Step 6a: completion GET after restart-control activation returns 404 again.
    const afterClear = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=${store}`);
    const afterClearBody = JSON.parse(afterClear.body || '{}');
    // Step 6b: /tour render for the same principal returns to
    // data-tour-first-run="true" (the restart activation re-opens the
    // tour on the next principal load, per AC-26104-1).
    const afterClearTour = await fixtureFetch(fixture.url, `/tour?store=${store}&principal-id=${principalId}`);
    const afterClearFirstRunTrue = /data-tour-first-run="true"/.test(afterClearTour.body);

    const writePass = writeRes.status === 200 && writeBody.ok === true
      && writeBody.record && writeBody.record.completedAt === completedAt;
    const readPass = readRes.status === 200 && readBody.completed === true
      && readBody.record && readBody.record.completedAt === completedAt
      && Array.isArray(readBody.record.stepIds) && readBody.record.stepIds.length === 3;
    const restartActivationPass = restartRes.status === 200 && restartBody.ok === true
      && restartBody.principalId === principalId && restartBody.cleared === true
      && restartBody.restartControl === 'restart-tour';
    const initialAbsent = initial.status === 404 && initialBody.completed === false;
    const afterClearAbsent = afterClear.status === 404 && afterClearBody.completed === false;
    const pass = !!initial.requestId && !!writeRes.requestId && !!readRes.requestId && !!restartRes.requestId && !!afterClear.requestId && !!afterClearTour.requestId
      && initialAbsent && writePass && readPass && settingsReachable && restartActivationPass && afterClearAbsent
      && initialFirstRunTrue && afterWriteFirstRunFalse && afterClearFirstRunTrue;

    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `${FIRST_EIGHT} for a fresh principalId ${principalId} under completion-state-store server-side-per-principal: initial completion GET returned 404 and the /tour render carried data-tour-first-run="true"; POST wrote a record with completedAt=${completedAt} and 3 stepIds; a subsequent completion GET returned the same record (persistence across requests) and the /tour render carried data-tour-first-run="false" (the completion feeds the server-derived first-run flag on the next principal load); the /settings render carried a <form method="post" action="/actions/restart-tour"> wrapping the data-action="restart-tour" button with the principal-id in a hidden input; POST /actions/restart-tour returned 200 { ok:true, cleared:true, principalId, restartControl:"restart-tour" } (the restart-control activation cleared the applied server-side store); a further completion GET returned 404 and the /tour render returned to data-tour-first-run="true" (the restart activation re-opens the tour on the next principal load); x-fixture-request-id (final)=${afterClearTour.requestId}`
        : `${FIRST_EIGHT} evidence gap: initial=${initial.status}/${initialAbsent} initialFirstRunTrue=${initialFirstRunTrue} write=${writeRes.status}/${writePass} read=${readRes.status}/${readPass} afterWriteFirstRunFalse=${afterWriteFirstRunFalse} settings=${settings.status}/${settingsReachable} restart=${restartRes.status}/${restartActivationPass} afterClear=${afterClear.status}/${afterClearAbsent} afterClearFirstRunTrue=${afterClearFirstRunTrue}`,
      evidence: {
        requestId: afterClearTour.requestId,
        responseStatus: afterClearTour.status,
        bodyExcerpt: excerpt(JSON.stringify({ initial: initialBody, write: writeBody, read: readBody, restart: restartBody, afterClear: afterClearBody, firstRun: { initialFirstRunTrue, afterWriteFirstRunFalse, afterClearFirstRunTrue } })),
        derived: {
          principalId,
          completedAt,
          initialAbsent,
          writePass,
          readPass,
          settingsReachable,
          restartActivationPass,
          afterClearAbsent,
          initialFirstRunTrue,
          afterWriteFirstRunFalse,
          afterClearFirstRunTrue,
          restartFormAction: '/actions/restart-tour',
          restartRequestId: restartRes.requestId,
        },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
