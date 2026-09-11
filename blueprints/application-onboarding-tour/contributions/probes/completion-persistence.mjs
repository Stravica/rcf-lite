// application-onboarding-tour probe: completion-state persistence and
// restart-tour clear (AC-26104-1) - server-side per-principal store
// (spa-local-storage and spa-session-storage variants are browser
// only; the server-side-per-principal store IS observable from a
// Node HTTP probe and this probe drives it).
//
// AC-26104-1 first eight words: "Given a completed tour, the completion state persists".
//
// Server-observable steps this probe drives against
// /api/tour/completion (POST write, GET read, DELETE clear):
//   1. Fresh principalId: GET returns 404 (no completion yet).
//   2. POST a completion record: 200 with the record echoed.
//   3. GET returns 200 with the same record (persistence across
//      requests, i.e. the "restart read").
//   4. DELETE (models the restart-tour control clearing the record):
//      200 ok.
//   5. GET returns 404 again (record cleared).
// Every step varies inputs (principalId is a fresh UUID, the record
// carries a distinct completedAt ISO) and asserts derived outputs
// the fixture had no choice about (the record echoed back).
//
// The dialog-open behaviour and keyboard-only walk asked for by
// AC-26101-1 / AC-26102-1 are browser-only and covered by
// first-run-detection and stepper-role-dialog. Settings-surface
// reachability (the restart-tour control is there) is included as
// a bounded conformance check.

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
    // Step 4: settings surface reachable (restart-tour control lives there).
    const settings = await fixtureFetch(fixture.url, `/settings?store=${store}&principal-id=${principalId}`);
    const settingsReachable = settings.status === 200 && !!settings.requestId
      && /data-action="restart-tour"/.test(settings.body);
    // Step 5: DELETE (models the restart-tour control effect).
    const clearRes = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=${store}`, { method: 'DELETE' });
    const clearBody = JSON.parse(clearRes.body || '{}');
    // Step 6a: completion GET after clear returns 404 again.
    const afterClear = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=${store}`);
    const afterClearBody = JSON.parse(afterClear.body || '{}');
    // Step 6b: /tour render for the same principal returns to
    // data-tour-first-run="true" (the restart clear re-opens the tour on
    // the next principal load, per AC-26104-1).
    const afterClearTour = await fixtureFetch(fixture.url, `/tour?store=${store}&principal-id=${principalId}`);
    const afterClearFirstRunTrue = /data-tour-first-run="true"/.test(afterClearTour.body);

    const writePass = writeRes.status === 200 && writeBody.ok === true
      && writeBody.record && writeBody.record.completedAt === completedAt;
    const readPass = readRes.status === 200 && readBody.completed === true
      && readBody.record && readBody.record.completedAt === completedAt
      && Array.isArray(readBody.record.stepIds) && readBody.record.stepIds.length === 3;
    const clearPass = clearRes.status === 200 && clearBody.ok === true;
    const initialAbsent = initial.status === 404 && initialBody.completed === false;
    const afterClearAbsent = afterClear.status === 404 && afterClearBody.completed === false;
    const pass = !!initial.requestId && !!writeRes.requestId && !!readRes.requestId && !!clearRes.requestId && !!afterClear.requestId
      && initialAbsent && writePass && readPass && settingsReachable && clearPass && afterClearAbsent
      && initialFirstRunTrue && afterWriteFirstRunFalse && afterClearFirstRunTrue;

    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `${FIRST_EIGHT} for a fresh principalId ${principalId} under theme-persistence server-side-per-principal: initial completion GET returned 404 and the /tour render carried data-tour-first-run="true"; POST wrote a record with completedAt=${completedAt} and 3 stepIds; a subsequent completion GET returned the same record (persistence across requests) and the /tour render carried data-tour-first-run="false" (the completion feeds the server-derived first-run flag on the next principal load); settings surface reachable with data-action="restart-tour" present; DELETE cleared the record and the /tour render returned to data-tour-first-run="true" (the restart clear re-opens the tour on the next principal load); x-fixture-request-id (final)=${afterClearTour.requestId}`
        : `${FIRST_EIGHT} evidence gap: initial=${initial.status}/${initialAbsent} initialFirstRunTrue=${initialFirstRunTrue} write=${writeRes.status}/${writePass} read=${readRes.status}/${readPass} afterWriteFirstRunFalse=${afterWriteFirstRunFalse} settings=${settings.status}/${settingsReachable} clear=${clearRes.status}/${clearPass} afterClear=${afterClear.status}/${afterClearAbsent} afterClearFirstRunTrue=${afterClearFirstRunTrue}`,
      evidence: {
        requestId: afterClearTour.requestId,
        responseStatus: afterClearTour.status,
        bodyExcerpt: excerpt(JSON.stringify({ initial: initialBody, write: writeBody, read: readBody, clear: clearBody, afterClear: afterClearBody, firstRun: { initialFirstRunTrue, afterWriteFirstRunFalse, afterClearFirstRunTrue } })),
        derived: {
          principalId,
          completedAt,
          initialAbsent,
          writePass,
          readPass,
          settingsReachable,
          clearPass,
          afterClearAbsent,
          initialFirstRunTrue,
          afterWriteFirstRunFalse,
          afterClearFirstRunTrue,
        },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
