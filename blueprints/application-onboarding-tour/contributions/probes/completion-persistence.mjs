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
    // Step 1: initial GET is 404.
    const initial = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=server-side-per-principal`);
    const initialBody = JSON.parse(initial.body || '{}');
    // Step 2: POST completion.
    const writeRes = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=server-side-per-principal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ completedAt, blueprintSetVersion: '1.0.0', stepIds: ['step-1', 'step-2', 'step-3'] }),
    });
    const writeBody = JSON.parse(writeRes.body || '{}');
    // Step 3: GET reflects the written record.
    const readRes = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=server-side-per-principal`);
    const readBody = JSON.parse(readRes.body || '{}');
    // Step 4: settings surface reachable (restart-tour control lives there).
    const settings = await fixtureFetch(fixture.url, `/settings?store=server-side-per-principal`);
    const settingsReachable = settings.status === 200 && !!settings.requestId
      && /data-action="restart-tour"/.test(settings.body);
    // Step 5: DELETE (models the restart-tour control effect).
    const clearRes = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=server-side-per-principal`, { method: 'DELETE' });
    const clearBody = JSON.parse(clearRes.body || '{}');
    // Step 6: GET after clear returns 404 again.
    const afterClear = await fixtureFetch(fixture.url, `/api/tour/completion?principal-id=${principalId}&store=server-side-per-principal`);
    const afterClearBody = JSON.parse(afterClear.body || '{}');

    const writePass = writeRes.status === 200 && writeBody.ok === true
      && writeBody.record && writeBody.record.completedAt === completedAt;
    const readPass = readRes.status === 200 && readBody.completed === true
      && readBody.record && readBody.record.completedAt === completedAt
      && Array.isArray(readBody.record.stepIds) && readBody.record.stepIds.length === 3;
    const clearPass = clearRes.status === 200 && clearBody.ok === true;
    const initialAbsent = initial.status === 404 && initialBody.completed === false;
    const afterClearAbsent = afterClear.status === 404 && afterClearBody.completed === false;
    const pass = !!initial.requestId && !!writeRes.requestId && !!readRes.requestId && !!clearRes.requestId && !!afterClear.requestId
      && initialAbsent && writePass && readPass && settingsReachable && clearPass && afterClearAbsent;

    results.push({
      anchorAcId,
      conformanceOnly: true,
      limitation: 'application-onboarding-tour-AC-26104-1: this row observes the server-side per-principal completion store (GET/POST/DELETE cycle) and settings-surface reachability of the restart-tour control, a partial observation of AC-26104-1; the AC also requires the operator activates the restart-tour control on the SPA and the tour re-opens on that user event - restart-control activation and tour re-opening are browser-driven and not observed by this Node HTTP probe',
      verdict: pass ? 'warn' : 'fail',
      detail: pass
        ? `${FIRST_EIGHT} for a fresh principalId ${principalId}: initial GET /api/tour/completion returned 404 (no record); POST wrote a record with completedAt=${completedAt} and 3 stepIds; a subsequent GET returned the same record (server-scoped persistence across requests); settings surface reachable with data-action="restart-tour" present; DELETE cleared the record; a final GET returned 404 (restart clear observed); x-fixture-request-id (final)=${afterClear.requestId}`
        : `${FIRST_EIGHT} evidence gap: initial=${initial.status}/${initialAbsent} write=${writeRes.status}/${writePass} read=${readRes.status}/${readPass} settings=${settings.status}/${settingsReachable} clear=${clearRes.status}/${clearPass} afterClear=${afterClear.status}/${afterClearAbsent}`,
      evidence: {
        requestId: afterClear.requestId,
        responseStatus: afterClear.status,
        bodyExcerpt: excerpt(JSON.stringify({ initial: initialBody, write: writeBody, read: readBody, clear: clearBody, afterClear: afterClearBody })),
        derived: {
          principalId,
          completedAt,
          initialAbsent,
          writePass,
          readPass,
          settingsReachable,
          clearPass,
          afterClearAbsent,
        },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
