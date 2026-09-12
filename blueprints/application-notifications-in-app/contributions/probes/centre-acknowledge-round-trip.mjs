// application-notifications-in-app probe: centre-acknowledge-round-trip
// (AC-20103-1).
//
// AC-20103-1 first eight words:
//   "Given the notification centre route with a seeded".
//
// AC-20103-1 has three clauses:
//   1. Surface enumeration: /notifications-centre lists notifications
//      with per-item [data-notification-id], [data-action="acknowledge"]
//      and [data-action="mark-read"] controls, plus exactly one
//      [data-action="mark-all-read"] control.
//   2. Activation causes a POST: activating the per-item acknowledge
//      control POSTs to the acknowledge endpoint; the server responds
//      200 { ok:true } and the delivery log's acknowledgedAt for the
//      row flips from null to an ISO timestamp; the round-trip is
//      recorded on the server request log.
//   3. Post-response DOM update on the CURRENT page: the item's
//      data-acknowledged reads "true" after the response (client-side
//      DOM mutation without a page reload).
//
// Clauses 1 and 2 are server-observable via the shipped
// progressive-enhancement form action: the centre wraps each
// acknowledge button in a <form method="post"
// action="/actions/acknowledge-notification"> with the notification-id
// in a hidden input, so a Node HTTP probe can fetch the served page,
// find the form action, SUBMIT that form action, and observe both the
// server-side flip (delivery-log acknowledgedAt) and the next served
// centre page rendering data-acknowledged="true" on the same article
// (proof that the served control's activation causes the acknowledged
// state, not just that a bare API POST does). Clause 3 (the
// same-page DOM mutation triggered by the JS-on client script) is
// browser-only and covered as a null-anchored conformance de-claim.
//
// This probe emits TWO rows:
//   - Row A: POSITIVE anchor to AC-20103-1 covering clauses 1 and 2
//     (surface enumeration + activation-of-the-served-control causing
//     the server-side round-trip and the served acknowledged state on
//     the next centre fetch). It picks a notificationId derived from
//     the centre HTML, verifies the article carries a form whose
//     action points at /actions/acknowledge-notification with the
//     principal-id in a hidden input, SUBMITS that form action, and
//     asserts derived outputs the fixture had no choice about (the
//     delivery-log acknowledgedAt flipping from null to an ISO
//     timestamp for THAT id, the server request log carrying exactly
//     one acknowledge-server entry and one acknowledge-form entry for
//     that id, and the next-load centre HTML rendering
//     data-acknowledged="true" on that same article).
//   - Row B: CONFORMANCE-ONLY (null anchor) naming AC-20103-1 in the
//     limitation for the browser-only same-page DOM flip (the client
//     script's fetch-then-setAttribute mutation happens post-response
//     without a reload; deferred to the browser check).

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
    // Find the acknowledge form wrapping the picked notificationId's
    // button. The form action is the observable activation surface
    // (JS-off progressive enhancement); the hidden input carries the
    // notification-id so the POST body identifies the row without
    // relying on the query string.
    const ackFormMatch = notificationId
      ? centreDom.match(new RegExp('<form[^>]*method="post"[^>]*action="([^"]*\\/actions\\/acknowledge-notification[^"]*)"[^>]*data-notification-id="' + notificationId + '"[^>]*>[\\s\\S]*?<input[^>]*type="hidden"[^>]*name="notification-id"[^>]*value="' + notificationId + '"[\\s\\S]*?<button[^>]*data-action="acknowledge"[^>]*data-notification-id="' + notificationId + '"[\\s\\S]*?<\\/form>', 'i'))
      : null;
    const ackFormAction = ackFormMatch ? ackFormMatch[1] : null;
    const ackFormPresent = !!ackFormMatch && !!ackFormAction;
    const surfaceOk = centre.status === 200 && !!centre.requestId
      && uniqueIds.length >= 1
      && perItemAckControls.length === uniqueIds.length
      && markReadControls.length === uniqueIds.length
      && markAllReadCount === 1
      && ackFormPresent;

    const beforeLog = await fixtureFetch(fixture.url, '/api/delivery-log');
    let beforeRow = null;
    try { beforeRow = (JSON.parse(beforeLog.body).rows || []).find((r) => r.notificationId === notificationId) || null; } catch (_) { /* parse */ }

    // Submit the served form action as a native form submission would:
    // a POST with content-type application/x-www-form-urlencoded and
    // the hidden input's name=value pair in the body. This proves
    // activation causality: the served form action is what caused the
    // server-side acknowledge, not a hand-crafted API call.
    const formBody = 'notification-id=' + encodeURIComponent(notificationId ?? '');
    const ack = await fixtureFetch(fixture.url, ackFormAction ?? '/actions/acknowledge-notification', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });
    let ackBody = null;
    try { ackBody = JSON.parse(ack.body); } catch (_) { /* parse */ }

    const afterLog = await fixtureFetch(fixture.url, '/api/delivery-log');
    let afterRow = null;
    try { afterRow = (JSON.parse(afterLog.body).rows || []).find((r) => r.notificationId === notificationId) || null; } catch (_) { /* parse */ }

    // Refetch the served centre page: the SAME article should now render
    // data-acknowledged="true" (proof that activation of the served
    // control produces the acknowledged state on the next principal
    // load - the AC's "the item's data-acknowledged reads true after
    // the response" clause, observed via the server-rendered next-load
    // rather than the browser-only same-page DOM mutation).
    const centreAfter = await fixtureFetch(fixture.url, '/notifications-centre');
    const centreAfterDom = centreAfter.body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    const acknowledgedArticleMatch = notificationId
      ? centreAfterDom.match(new RegExp('<article[^>]*data-notification-id="' + notificationId + '"[^>]*data-acknowledged="([^"]+)"'))
      : null;
    const nextLoadAcknowledgedAttr = acknowledgedArticleMatch ? acknowledgedArticleMatch[1] : null;

    const requestsAfter = await fixtureFetch(fixture.url, '/__requests');
    let requestEntries = [];
    try { requestEntries = JSON.parse(requestsAfter.body); } catch (_) { /* parse */ }
    const ackServerLogs = requestEntries.filter((e) => e.kind === 'acknowledge-server' && e.notificationId === notificationId);
    const ackFormLogs = requestEntries.filter((e) => e.kind === 'acknowledge-form' && e.notificationId === notificationId);

    const roundTripPass = ack.status === 200
      && !!ack.requestId
      && ackBody && ackBody.ok === true && ackBody.notificationId === notificationId
      && typeof ackBody.acknowledgedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(ackBody.acknowledgedAt)
      && !!beforeRow && beforeRow.acknowledgedAt === null
      && !!afterRow && typeof afterRow.acknowledgedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(afterRow.acknowledgedAt)
      && ackServerLogs.length === 1
      && ackFormLogs.length === 1
      && nextLoadAcknowledgedAttr === 'true';

    const positivePass = surfaceOk && roundTripPass;

    results.push({
      anchorAcId,
      verdict: positivePass ? 'pass' : 'fail',
      detail: positivePass
        ? `${FIRST_EIGHT} backlog, /notifications-centre enumerated ${uniqueIds.length} [data-notification-id] wrappers with matching per-item acknowledge and mark-read controls and exactly one mark-all-read control; the acknowledge control for notificationId=${notificationId} was wrapped in a <form method="post" action="${ackFormAction}"> with the notification-id in a hidden input; submitting that served form action (content-type application/x-www-form-urlencoded, body notification-id=${notificationId}) returned 200 { ok:true, notificationId, acknowledgedAt:${ackBody?.acknowledgedAt} }; the delivery-log acknowledgedAt for that id flipped from null to ${afterRow?.acknowledgedAt}; the /__requests log recorded exactly one acknowledge-server entry AND one acknowledge-form entry for that id; refetching /notifications-centre rendered data-acknowledged="true" on the same article (proof that activation of the served control causes the acknowledged state on the next principal load); x-fixture-request-id on the form POST=${ack.requestId}`
        : `${FIRST_EIGHT} backlog, evidence gap: surfaceOk=${surfaceOk} (uniqueIds=${uniqueIds.length} perItemAck=${perItemAckControls.length} markRead=${markReadControls.length} markAllRead=${markAllReadCount} ackFormPresent=${ackFormPresent}) notificationId=${notificationId} ackFormAction=${ackFormAction} ackStatus=${ack.status} ackBody=${JSON.stringify(ackBody)} beforeAck=${beforeRow ? beforeRow.acknowledgedAt : 'missing'} afterAck=${afterRow ? afterRow.acknowledgedAt : 'missing'} ackServerLogs=${ackServerLogs.length} ackFormLogs=${ackFormLogs.length} nextLoadAcknowledgedAttr=${nextLoadAcknowledgedAttr}`,
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
          ackFormPresent,
          ackFormAction,
          beforeAck: beforeRow ? beforeRow.acknowledgedAt : null,
          afterAck: afterRow ? afterRow.acknowledgedAt : null,
          ackServerLogCount: ackServerLogs.length,
          ackFormLogCount: ackFormLogs.length,
          nextLoadAcknowledgedAttr,
          surfaceOk,
          roundTripPass,
        },
      },
    });

    // Conformance-only companion row: the same-page DOM
    // data-acknowledged flip that AC-20103-1 requires ("the item's
    // data-acknowledged reads true after the response") when the JS
    // client script mutates the article element in place after the
    // fetch resolves (no page reload) is browser-only; the Node HTTP
    // probe cannot observe the client script's in-place DOM mutation.
    // The positive row above already covers the served next-load
    // acknowledged state (the server-observable equivalent); this
    // de-claim narrows to the client-side in-place mutation the
    // browser check owns. Recorded as a null-anchored conformance
    // de-claim per the rule-7d shape.
    const centreArticleExcerpt = (centreDom.match(new RegExp(`<article[^>]*data-notification-id="${notificationId}"[^]{0,240}`)) || [''])[0];
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: 'application-notifications-in-app-AC-20103-1: the client-side, same-page DOM data-acknowledged="true" flip on the /notifications-centre article (the fetch()-then-setAttribute mutation the JS-on client script performs without a page reload) is browser-only. The positive row above covers the served next-load equivalent (activation of the served form action produces data-acknowledged="true" on the same article on the next /notifications-centre fetch). The in-place same-page DOM mutation is deferred to the pack browser check.',
      verdict: 'warn',
      detail: `${FIRST_EIGHT} backlog, the client-side same-page DOM data-acknowledged="true" flip on the notification article after the fetch resolves (without a page reload) is browser-only; recorded as a null-anchored conformance de-claim so the AC-20103-1 in-place-mutation clause the positive row does not cover is on the record; fixture centre reachability confirmed via the same /notifications-centre fetch (x-fixture-request-id=${centre.requestId}).`,
      evidence: {
        requestId: centre.requestId,
        responseStatus: centre.status,
        bodyExcerpt: excerpt(centreArticleExcerpt),
        derived: {
          notificationId,
          articleServerRenderedAcknowledgedAttr: (centreArticleExcerpt.match(/data-acknowledged="([^"]+)"/) || [null, null])[1],
          inPlaceDomFlipObserved: false,
          reason: 'browser-only in-place DOM mutation clause of AC-20103-1',
        },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
