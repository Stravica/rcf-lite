// application-notifications-in-app probe: centre acknowledge round
// trip (AC-20103-1).
//
// AC-20103-1 first eight words:
//   "Given the notification centre route with a seeded".
//
// AC-20103-1 has three clauses:
//   1. Surface enumeration: /notifications-centre lists notifications
//      with per-item [data-notification-id], [data-action="acknowledge"]
//      and [data-action="mark-read"] controls, plus exactly one
//      [data-action="mark-all-read"] control.
//   2. Server round-trip: activating the per-item acknowledge control
//      POSTs to /api/notifications/acknowledge; the server responds
//      200 { ok: true } and the delivery log's acknowledgedAt for the
//      row flips from null to an ISO timestamp; the round-trip is
//      recorded on the server request log.
//   3. DOM update: the item's data-acknowledged reads "true" after the
//      response.
//
// Clauses 1 and 2 are server-observable (the fixture is the engine
// per the application-code engine ruling; varying notificationId and
// asserting the derived acknowledgedAt flip is not a constant-echo).
// Clause 3 is browser-only (the DOM mutation runs inside the client
// script after the fetch resolves).
//
// This probe emits TWO rows:
//   - Row A: POSITIVE anchor to AC-20103-1 covering clauses 1 and 2
//     (surface enumeration + server round-trip). It picks a
//     notificationId derived from the centre HTML, POSTs the
//     acknowledge, and asserts derived outputs the fixture had no
//     choice about (the delivery-log acknowledgedAt flipping from
//     null to an ISO timestamp for THAT id, and the server request
//     log carrying exactly one acknowledge-server entry for that id).
//   - Row B: CONFORMANCE-ONLY (null anchor) naming AC-20103-1 in the
//     limitation for the browser-only DOM data-acknowledged flip
//     (deferred to the browser check).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-notifications-in-app-AC-20103-1';
export const accountBound = false;

const FIRST_EIGHT = 'Given the notification centre route with a seeded';

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const centre = await fixtureFetch(fixture.url, '/notifications-centre');
    // Strip inline <script> blocks so the DOM-shape enumeration below
    // does not match literal attribute strings that live inside the
    // client script (for example a `data-notification-id="' +
    // notificationId + '"` template string or an
    // `[data-action="mark-all-read"]` selector inside JS).
    const centreDom = centre.body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    const ids = Array.from(centreDom.matchAll(/data-notification-id="([^"]+)"/g)).map((m) => m[1]);
    const uniqueIds = Array.from(new Set(ids));
    const notificationId = uniqueIds[0] ?? null;
    const perItemAckControls = Array.from(centreDom.matchAll(/<button[^>]*data-action="acknowledge"[^>]*data-notification-id="([^"]+)"/g)).map((m) => m[1]);
    const markReadControls = Array.from(centreDom.matchAll(/<button[^>]*data-action="mark-read"[^>]*data-notification-id="([^"]+)"/g)).map((m) => m[1]);
    const markAllReadCount = (centreDom.match(/<button[^>]*data-action="mark-all-read"/g) || []).length;
    const surfaceOk = centre.status === 200 && !!centre.requestId
      && uniqueIds.length >= 1
      && perItemAckControls.length === uniqueIds.length
      && markReadControls.length === uniqueIds.length
      && markAllReadCount === 1;

    const beforeLog = await fixtureFetch(fixture.url, '/api/delivery-log');
    let beforeRow = null;
    try { beforeRow = (JSON.parse(beforeLog.body).rows || []).find((r) => r.notificationId === notificationId) || null; } catch (_) { /* parse */ }

    const ack = await fixtureFetch(fixture.url, '/api/notifications/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notificationId }),
    });
    let ackBody = null;
    try { ackBody = JSON.parse(ack.body); } catch (_) { /* parse */ }

    const afterLog = await fixtureFetch(fixture.url, '/api/delivery-log');
    let afterRow = null;
    try { afterRow = (JSON.parse(afterLog.body).rows || []).find((r) => r.notificationId === notificationId) || null; } catch (_) { /* parse */ }

    const requestsAfter = await fixtureFetch(fixture.url, '/__requests');
    let requestEntries = [];
    try { requestEntries = JSON.parse(requestsAfter.body); } catch (_) { /* parse */ }
    const ackServerLogs = requestEntries.filter((e) => e.kind === 'acknowledge-server' && e.notificationId === notificationId);

    const roundTripPass = ack.status === 200
      && !!ack.requestId
      && ackBody && ackBody.ok === true && ackBody.notificationId === notificationId
      && !!beforeRow && beforeRow.acknowledgedAt === null
      && !!afterRow && typeof afterRow.acknowledgedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(afterRow.acknowledgedAt)
      && ackServerLogs.length === 1;

    const positivePass = surfaceOk && roundTripPass;

    results.push({
      anchorAcId,
      verdict: positivePass ? 'pass' : 'fail',
      detail: positivePass
        ? `${FIRST_EIGHT} backlog, /notifications-centre enumerated ${uniqueIds.length} [data-notification-id] wrappers with matching per-item acknowledge and mark-read controls and exactly one mark-all-read control; the server-side acknowledge round-trip on notificationId=${notificationId} completed with POST /api/notifications/acknowledge -> 200 { ok:true, notificationId }; the delivery-log acknowledgedAt for that id flipped from null to ${afterRow.acknowledgedAt}; the /__requests log recorded exactly one acknowledge-server entry for that id; x-fixture-request-id on the POST=${ack.requestId}`
        : `${FIRST_EIGHT} backlog, evidence gap: surfaceOk=${surfaceOk} (uniqueIds=${uniqueIds.length} perItemAck=${perItemAckControls.length} markRead=${markReadControls.length} markAllRead=${markAllReadCount}) notificationId=${notificationId} ackStatus=${ack.status} ackBody=${JSON.stringify(ackBody)} beforeAck=${beforeRow ? beforeRow.acknowledgedAt : 'missing'} afterAck=${afterRow ? afterRow.acknowledgedAt : 'missing'} ackServerLogs=${ackServerLogs.length}`,
      evidence: {
        requestId: ack.requestId,
        responseStatus: ack.status,
        bodyExcerpt: excerpt(ack.body),
        derived: {
          notificationId,
          uniqueIdCount: uniqueIds.length,
          perItemAckControlCount: perItemAckControls.length,
          markReadControlCount: markReadControls.length,
          markAllReadCount,
          beforeAck: beforeRow ? beforeRow.acknowledgedAt : null,
          afterAck: afterRow ? afterRow.acknowledgedAt : null,
          ackServerLogCount: ackServerLogs.length,
          surfaceOk,
          roundTripPass,
        },
      },
    });

    // Conformance-only companion row: the DOM data-acknowledged flip
    // that AC-20103-1 requires ("the item's data-acknowledged reads
    // true after the response") is browser-only in this fixture; the
    // Node HTTP probe does not run the client script and cannot
    // observe the DOM mutation. Recorded as a null-anchored
    // conformance de-claim per the rule-7d shape so the operator
    // sees the AC-20103-1 clause the positive row does NOT cover.
    // The evidence object carries the /notifications-centre fetch
    // request id and the article-element excerpt from THIS run so
    // the row still meets the tally's evidence-required contract.
    const centreArticleExcerpt = (centreDom.match(new RegExp(`<article[^>]*data-notification-id="${notificationId}"[^]{0,240}`)) || [''])[0];
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: 'application-notifications-in-app-AC-20103-1: the DOM data-acknowledged="true" flip on the /notifications-centre item after the server round-trip resolves is browser-only (the client script mutates the article element post-fetch). This Node HTTP probe observes the server-side round-trip positively (surface enumeration + POST + delivery-log acknowledgedAt flip + server request log). The browser-observable DOM mutation is deferred to the pack browser check.',
      verdict: 'warn',
      detail: `${FIRST_EIGHT} backlog, the DOM data-acknowledged="true" flip on the notification article after the fetch resolves is browser-only; recorded as a null-anchored conformance de-claim so the AC-20103-1 clause the positive row does not cover is on the record; fixture centre reachability confirmed via the same /notifications-centre fetch (x-fixture-request-id=${centre.requestId}).`,
      evidence: {
        requestId: centre.requestId,
        responseStatus: centre.status,
        bodyExcerpt: excerpt(centreArticleExcerpt),
        derived: {
          notificationId,
          articleServerRenderedAcknowledgedAttr: (centreArticleExcerpt.match(/data-acknowledged="([^"]+)"/) || [null, null])[1],
          domFlipObserved: false,
          reason: 'browser-only clause of AC-20103-1',
        },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
