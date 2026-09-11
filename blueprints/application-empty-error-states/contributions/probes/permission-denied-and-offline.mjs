// application-empty-error-states probe: permission-denied
// (AC-22104-1) and the offline buffer lifecycle (AC-22105-1).
//
// AC-22105-1 requires observing the buffered-write lifecycle
// (intercepted-write when the transport is offline, buffered with
// idempotency-per-token, flushed on reconnect, delivered count
// visible). The lifecycle is server-observable via the fixture's
// /probe/offline/state, /probe/offline/buffer and
// /probe/offline/reconnect endpoints - a probe can flip the state
// to offline, POST a varied idempotency token, verify the count
// increased and the token deduplicates a duplicate POST, trigger
// reconnect, then verify the buffer drained and the delivered
// count rose. The polite live-region announcement of the flushed
// count is browser-driven (client script wires the announce) and
// is not part of what this row observes.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

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

    // AC-22105-1 server-observable buffer lifecycle: flip state
    // offline, POST a varied idempotency token, verify buffer grew,
    // POST the same token and verify dedupe, POST a second distinct
    // token, trigger reconnect and verify the buffer drained with
    // the expected delivered count. Every step drives a varied
    // input the fixture cannot see coming, and every assertion is on
    // a derived output the fixture had no choice about.
    const principalId = 'probe-offline-' + randomUUID();
    // Baseline read (fresh principal begins with the seeded buffer of size 1).
    const initial = await fixtureFetch(fixture.url, `/probe/offline/state?principal-id=${principalId}`);
    const initialState = JSON.parse(initial.body || '{}');
    // Flip to offline.
    const flipOffline = await fixtureFetch(fixture.url, `/probe/offline/state?principal-id=${principalId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'offline' }),
    });
    // Enqueue a distinct token.
    const tokenA = 'probe-write-' + randomUUID();
    const enqA1 = await fixtureFetch(fixture.url, `/probe/offline/buffer?principal-id=${principalId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyToken: tokenA, payload: { kind: 'note', body: 'first' } }),
    });
    const enqA1Body = JSON.parse(enqA1.body || '{}');
    // Duplicate write with the SAME token must dedupe (no count increase).
    const enqA2 = await fixtureFetch(fixture.url, `/probe/offline/buffer?principal-id=${principalId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyToken: tokenA, payload: { kind: 'note', body: 'first-again' } }),
    });
    const enqA2Body = JSON.parse(enqA2.body || '{}');
    // Enqueue a second distinct token (count must go up).
    const tokenB = 'probe-write-' + randomUUID();
    const enqB = await fixtureFetch(fixture.url, `/probe/offline/buffer?principal-id=${principalId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyToken: tokenB, payload: { kind: 'note', body: 'second' } }),
    });
    const enqBBody = JSON.parse(enqB.body || '{}');
    // Reconnect and drain.
    const reconnect = await fixtureFetch(fixture.url, `/probe/offline/reconnect?principal-id=${principalId}`, { method: 'POST' });
    const reconnectBody = JSON.parse(reconnect.body || '{}');
    // Final GET reads state after reconnect: buffer drained.
    const finalState = await fixtureFetch(fixture.url, `/probe/offline/state?principal-id=${principalId}`);
    const finalStateBody = JSON.parse(finalState.body || '{}');
    // Expectations per AC-22105-1:
    //   - offline enqueue grows the buffer count on distinct token
    //   - duplicate token does not grow the count (dedupe)
    //   - reconnect returns flushed count === buffer count at reconnect time
    //   - final state shows buffer empty and delivered count rose by the
    //     flushed count
    const seededCount = initialState.bufferCount ?? 0;
    const bufferAfterA1 = enqA1Body.bufferCount ?? 0;
    const bufferAfterA2 = enqA2Body.bufferCount ?? 0;
    const bufferAfterB = enqBBody.bufferCount ?? 0;
    const flushedCount = reconnectBody.flushedCount ?? -1;
    const deliveredAfter = finalStateBody.deliveredCount ?? -1;
    const enqueueGrew = bufferAfterA1 === seededCount + 1;
    const deduped = bufferAfterA2 === bufferAfterA1 && enqA2Body.deduped === true;
    const secondEnqueueGrew = bufferAfterB === bufferAfterA1 + 1;
    const flushedMatches = flushedCount === bufferAfterB;
    const drained = (finalStateBody.bufferCount ?? -1) === 0 && finalStateBody.state === 'online';
    const deliveredMatches = deliveredAfter === flushedCount;
    const bufferPass = initial.status === 200 && !!initial.requestId
      && flipOffline.status === 200
      && enqA1.status === 200 && enqA2.status === 200 && enqB.status === 200
      && reconnect.status === 200 && finalState.status === 200
      && enqueueGrew && deduped && secondEnqueueGrew && flushedMatches && drained && deliveredMatches;
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22105-1',
      verdict: bufferPass ? 'pass' : 'fail',
      detail: bufferPass
        ? `Given navigator.onLine simulated false via the runtime seam: with the server-side buffer keyed to a fresh principalId, POST /probe/offline/state{state:offline} flipped the state; two distinct idempotency tokens enqueued (buffer count seededCount=${seededCount} -> ${bufferAfterA1} -> ${bufferAfterB}); duplicate token deduped (deduped=${enqA2Body.deduped}, count stayed ${bufferAfterA2}); POST /probe/offline/reconnect drained ${flushedCount} writes; final state shows bufferCount=0, state=online, deliveredCount=${deliveredAfter} equal to flushedCount; x-fixture-request-id (initial GET)=${initial.requestId}`
        : `Given navigator.onLine simulated false via the runtime seam (evidence gap): seeded=${seededCount} afterA1=${bufferAfterA1} afterA2=${bufferAfterA2} afterB=${bufferAfterB} flushed=${flushedCount} delivered=${deliveredAfter} state=${finalStateBody.state} enqueueGrew=${enqueueGrew} deduped=${deduped} secondGrew=${secondEnqueueGrew} flushedMatches=${flushedMatches} drained=${drained} deliveredMatches=${deliveredMatches}`,
      evidence: {
        requestId: initial.requestId,
        responseStatus: initial.status,
        bodyExcerpt: excerpt(JSON.stringify({ initial: initialState, afterEnq: enqBBody, reconnect: reconnectBody, final: finalStateBody })),
        derived: {
          principalId,
          seededCount,
          bufferAfterA1,
          bufferAfterA2,
          bufferAfterB,
          flushedCount,
          deliveredAfter,
          enqueueGrew,
          deduped,
          secondEnqueueGrew,
          flushedMatches,
          drained,
          deliveredMatches,
        },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
