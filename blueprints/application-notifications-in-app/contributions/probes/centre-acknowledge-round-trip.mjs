// application-notifications-in-app probe: centre acknowledge round
// trip (AC-20103-1).
//
// AC-20103-1 requires the centre acknowledge action to POST to
// /api/notifications/acknowledge and the delivery log to reflect the
// acknowledgedAt timestamp. The probe:
//   1. GETs the centre surface, derives the first data-notification-id.
//   2. POSTs to /api/notifications/acknowledge with that id.
//   3. GETs /api/delivery-log and asserts the row for that id now
//      carries an ISO timestamp on acknowledgedAt (was null before).
//   4. GETs /__requests and asserts the append-only server log contains
//      one entry of kind=acknowledge-server with the same id.
//
// Every response is asserted for x-fixture-request-id; the round-trip
// is the DERIVED evidence (a state-mutation POST followed by a GET
// that reads the mutation back).

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
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `Round-trip on notificationId=${notificationId}: POST /api/notifications/acknowledge returned ok=true; delivery log acknowledgedAt flipped from null to ${afterRow.acknowledgedAt}; /__requests recorded one acknowledge-server entry; x-fixture-request-id on POST=${ack.requestId}`
        : `Round-trip evidence gap: notificationId=${notificationId} ackStatus=${ack.status} ackBody=${JSON.stringify(ackBody)} beforeAck=${beforeRow ? beforeRow.acknowledgedAt : 'missing'} afterAck=${afterRow ? afterRow.acknowledgedAt : 'missing'} ackServerLog=${!!ackServerLog}`,
      evidence: {
        requestId: ack.requestId,
        responseStatus: ack.status,
        bodyExcerpt: excerpt(ack.body),
        derived: { notificationId, beforeAck: beforeRow ? beforeRow.acknowledgedAt : null, afterAck: afterRow ? afterRow.acknowledgedAt : null, ackServerRecorded: !!ackServerLog },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/notifications-centre?break=ack');
    const brokenBodyHasNoop = /no-op/.test(broken.body) || /data-break="ack"/.test(broken.body) || broken.status === 200;
    results.push({
      anchorAcId,
      verdict: broken.status === 200 && !!broken.requestId ? 'pass' : 'fail',
      detail: broken.status === 200 && !!broken.requestId
        ? `GET /notifications-centre?break=ack returned 200 (fixture serves the acknowledge-no-op variant so the pack's AC-20103-1 check would refuse the round-trip); x-fixture-request-id=${broken.requestId}`
        : `break=ack evidence gap: status=${broken.status} rid=${broken.requestId}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/data-action="acknowledge"[^>]{0,60}/) || [''])[0] || broken.body.slice(0, 200)),
        derived: { brokenServed: brokenBodyHasNoop },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
