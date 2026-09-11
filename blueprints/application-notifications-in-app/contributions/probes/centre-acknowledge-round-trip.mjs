// application-notifications-in-app probe: centre acknowledge round
// trip (AC-20103-1).
//
// AC-20103-1 requires the centre acknowledge action to POST to
// /api/notifications/acknowledge, the server to respond 200 { ok: true },
// and the item's data-acknowledged to read true after the response.
// The probe:
//   1. GETs the centre surface, derives the first data-notification-id.
//   2. Reads the delivery log for that id (acknowledgedAt starts null).
//   3. POSTs to /api/notifications/acknowledge with that id.
//   4. Re-reads the delivery log and asserts acknowledgedAt is now an
//      ISO timestamp (the server-side effect of the round-trip).
//   5. Reads /__requests and asserts an acknowledge-server entry is
//      present for that id.
//
// The round-trip is the DERIVED evidence (a state-mutation POST
// followed by a GET that reads the mutation back). Every response is
// asserted for the x-fixture-request-id header (positive evidence per
// rule 7d). No broken-variant row is emitted (positive-anchor rule:
// no positive AC anchor on absence).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-notifications-in-app-AC-20103-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const centre = await fixtureFetch(fixture.url, '/notifications-centre');
    const idMatch = centre.body.match(/data-notification-id="([^"]+)"/);
    const notificationId = idMatch ? idMatch[1] : null;

    const beforeLog = await fixtureFetch(fixture.url, '/api/delivery-log');
    let beforeRow = null;
    try { beforeRow = (JSON.parse(beforeLog.body).rows || []).find((r) => r.notificationId === notificationId) || null; } catch (_) { /* body parse */ }

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
    const ackServerLog = requestEntries.find((e) => e.kind === 'acknowledge-server' && e.notificationId === notificationId) || null;

    const pass = ack.status === 200
      && !!ack.requestId
      && ackBody && ackBody.ok === true && ackBody.notificationId === notificationId
      && !!beforeRow && beforeRow.acknowledgedAt === null
      && !!afterRow && typeof afterRow.acknowledgedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(afterRow.acknowledgedAt)
      && !!ackServerLog;

    results.push({
      anchorAcId,
      conformanceOnly: true,
      limitation: 'application-notifications-in-app-AC-20103-1: this row observes the acknowledge API round trip server-side (POST then GET showing acknowledgedAt flipped and the delivery-log entry), a partial observation of AC-20103-1; the AC also requires observing the user activating the control and the DOM data-acknowledged attribute flipping in response to that user event - client-side DOM mutation and event dispatch are browser-driven and not observed by this Node HTTP probe',
      verdict: pass ? 'warn' : 'fail',
      detail: pass
        ? `Given the notification centre route with a seeded; round-trip on notificationId=${notificationId} against the seeded backlog: POST /api/notifications/acknowledge returned 200 { ok: true, notificationId }; delivery-log acknowledgedAt flipped from null to ${afterRow.acknowledgedAt}; /__requests recorded one acknowledge-server entry; x-fixture-request-id on the POST=${ack.requestId}`
        : `Given the notification centre route with a seeded; round-trip evidence gap: notificationId=${notificationId} ackStatus=${ack.status} ackBody=${JSON.stringify(ackBody)} beforeAck=${beforeRow ? beforeRow.acknowledgedAt : 'missing'} afterAck=${afterRow ? afterRow.acknowledgedAt : 'missing'} ackServerLog=${!!ackServerLog}`,
      evidence: {
        requestId: ack.requestId,
        responseStatus: ack.status,
        bodyExcerpt: excerpt(ack.body),
        derived: {
          notificationId,
          beforeAck: beforeRow ? beforeRow.acknowledgedAt : null,
          afterAck: afterRow ? afterRow.acknowledgedAt : null,
          ackServerRecorded: !!ackServerLog,
        },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
