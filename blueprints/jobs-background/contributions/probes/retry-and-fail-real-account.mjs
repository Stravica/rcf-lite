/**
 * Retry-and-fail real-account probe (live-engine coverage).
 *
 * Exercises REAL Cloudflare Queues end-to-end through the vendor's
 * pull-consumer + dead-letter-queue mechanism (per
 * https://developers.cloudflare.com/queues/configuration/pull-consumers/
 * and https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).
 *
 * Flow:
 *   1. Mint a scratch queue (name minted at run time from a probe
 *      constant plus a short random suffix; see the code below and
 *      the run-notes.md in the evidence tree for the resolved name)
 *      and a paired DLQ via the CF REST Queues API.
 *   2. Attach an `http_pull` consumer to the main queue with
 *      max_retries=3, dead_letter_queue=<dlq name>, visibility timeout
 *      short (2 s) so the observation window stays tight. Attach an
 *      `http_pull` consumer to the DLQ so a subsequent pull can
 *      positively record DLQ landing.
 *   3. Publish one message.
 *   4. Pull, retry, repeat until the message no longer appears on the
 *      primary queue (Cloudflare moved it to the DLQ after
 *      max_retries+1 deliveries). Record the observed attempts on each
 *      pull.
 *   5. Pull the DLQ and assert the message id landed there.
 *   6. Teardown: delete both queues; confirm each is absent from the
 *      account queue listing.
 *
 * Skip on missing account creds: exactly one variable per skip row.
 *
 * Row anchoring:
 *  - The account-bound skip row anchors AC-jobs-retryOnHandlerFailure
 *    (the shipped retry AC) with `accountBoundSkipped: true` and a
 *    `reason` naming the one unset gate variable.
 *  - Every non-skip row is CONFORMANCE-ONLY with `anchorAcId: null`
 *    and a `limitation` naming the nearest shipped AC id and the
 *    property it states that this probe does NOT positively observe:
 *      - Provisioning row -> AC-jobs-requiresQueue (states init-time
 *        queue requirement; this row records vendor queue creation).
 *      - Attempts-counter row -> AC-jobs-retryOnHandlerFailure (states
 *        the applied in-memory queue redelivery and three jobStarted
 *        events on the sink; this row records Cloudflare Queues'
 *        vendor attempts counter, not the sink events).
 *      - DLQ landing row -> AC-30109-1 (states DLQ-producer invocation
 *        on the in-memory driver; this row records real Cloudflare
 *        Queues DLQ landing).
 *      - Teardown row -> AC-jobs-requiresQueue (no AC states scratch
 *        teardown; this row records DELETE + post-run absence).
 */

export const accountBound = true;
export const DECLARED_ENV = Object.freeze([
  'CI_HAS_CLOUDFLARE_ACCOUNT',
  'CF_ACCOUNT_ID',
  'CF_API_TOKEN',
  'CF_API_BASE',
]);

const API_BASE = process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4';

const AC_RETRY_FIRST8 = 'With SIMULATE_HANDLER_THROW=true set on the shared sample-app fixture,';
const AC_REQUIRES_FIRST8 = 'On a fresh init scratch project with NO';
const AC_PROVISION_LIMITATION = 'AC-jobs-requiresQueue: On a fresh init scratch project with NO messaging-queue provider applied, rcf-lite refuses to apply jobs-background with the stable message id jobs-background-no-queue. Not observed on this row: this row records vendor queue and DLQ provisioning on a real Cloudflare account, which the AC does not state (its property is CLI refusal at init time, not vendor-side queue creation).';
const AC_ATTEMPTS_LIMITATION = 'AC-jobs-retryOnHandlerFailure: With SIMULATE_HANDLER_THROW=true set on the shared sample-app fixture, the retry-and-fail probe schedules a job whose handler throws a retryable error; the applied in-memory queue redelivers the message per retryPolicy.maxAttempts. Three jobStarted events fire on the sink with the same jobId and attempts counter 1, 2, 3; after the third failure jobFailed fires with a terminal error code and no further re-delivery follows. Not observed on this row: the AC states applied in-memory queue redelivery and jobStarted-on-sink events; this row records the vendor Cloudflare Queues attempts counter across pulls [0,1,2,3], not the jobStarted sink events the AC states.';
const AC_DLQ_LIMITATION = 'AC-30109-1: The retry-and-fail probe report, after the three failing attempts, records the DLQ-producer invocation on the in-memory driver via a jobDeadLettered event carrying the terminal job id and the original job body. Not observed on this row: the AC pins the in-memory driver DLQ-producer invocation; this row records real Cloudflare Queues DLQ landing (backlog + payload-id match on a real DLQ), which the AC does not state.';
const AC_TEARDOWN_LIMITATION = 'AC-jobs-requiresQueue: On a fresh init scratch project with NO messaging-queue provider applied, rcf-lite refuses to apply jobs-background with the stable message id jobs-background-no-queue. Not observed on this row: this row records scratch Cloudflare Queues DELETE + post-run absence via the account queue listing, which no jobs-background AC or REQ states; the AC used as a signpost is the nearest shipped AC on queue existence.';

function skipRow(reason) {
  return {
    results: [{
      anchorAcId: 'AC-jobs-retryOnHandlerFailure',
      verdict: 'pass',
      detail: `${AC_RETRY_FIRST8} - accountBound: skipped (${reason})`,
      accountBoundSkipped: true,
      reason,
      evidence: { skip: true, reason, envDeclared: [...DECLARED_ENV] },
    }],
    extra: { accountBoundSkipped: true, reason, envDeclared: [...DECLARED_ENV] },
  };
}

async function cf(method, path, token, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  return { httpStatus: res.status, json, raw: text };
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function runProbe() {
  const gate = process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  if (gate == null || gate === '') return skipRow('CI_HAS_CLOUDFLARE_ACCOUNT unset');
  if (gate !== 'true') return skipRow(`CI_HAS_CLOUDFLARE_ACCOUNT set to ${JSON.stringify(gate)} (not "true")`);
  if (!process.env.CF_ACCOUNT_ID) return skipRow('CF_ACCOUNT_ID unset');
  if (!process.env.CF_API_TOKEN) return skipRow('CF_API_TOKEN unset');

  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  const short = shortId();
  const queueName = `qa-e-jobs-q-${short}`;
  const dlqName = `qa-e-jobs-dlq-${short}`;
  const results = [];
  const teardown = { deletePrimary: null, deleteDlq: null, primaryAbsent: null, dlqAbsent: null };
  let qid = null;
  let dlqId = null;
  try {
    // 1. mint DLQ first, then the main queue (main queue's consumer
    // config references the DLQ by name).
    const dlqCreate = await cf('POST', `/accounts/${accountId}/queues`, token, { queue_name: dlqName });
    dlqId = dlqCreate.json && dlqCreate.json.result && dlqCreate.json.result.queue_id;
    if (!dlqId) throw new Error(`DLQ create failed: httpStatus=${dlqCreate.httpStatus} body=${dlqCreate.raw}`);
    const dlqConsumer = await cf('POST', `/accounts/${accountId}/queues/${dlqId}/consumers`, token, {
      type: 'http_pull',
      settings: { batch_size: 10, visibility_timeout_ms: 10000, max_retries: 3, retry_delay: 0 },
    });
    if (!(dlqConsumer.json && dlqConsumer.json.success)) throw new Error(`DLQ consumer attach failed: ${dlqConsumer.raw}`);

    const primaryCreate = await cf('POST', `/accounts/${accountId}/queues`, token, { queue_name: queueName });
    qid = primaryCreate.json && primaryCreate.json.result && primaryCreate.json.result.queue_id;
    if (!qid) throw new Error(`primary create failed: httpStatus=${primaryCreate.httpStatus} body=${primaryCreate.raw}`);
    const primaryConsumer = await cf('POST', `/accounts/${accountId}/queues/${qid}/consumers`, token, {
      type: 'http_pull',
      dead_letter_queue: dlqName,
      settings: { batch_size: 10, visibility_timeout_ms: 2000, max_retries: 3, retry_delay: 0 },
    });
    if (!(primaryConsumer.json && primaryConsumer.json.success)) throw new Error(`primary consumer attach failed: ${primaryConsumer.raw}`);

    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC_PROVISION_LIMITATION,
      verdict: 'pass',
      detail: `conformanceOnly (${AC_PROVISION_LIMITATION}) - provisioned scratch queue ${queueName} (id=${qid}) with DLQ ${dlqName} (id=${dlqId}), both with http_pull consumers, max_retries=3`,
      evidence: {
        queueName, dlqName,
        primaryConsumerResponseMetadata: primaryConsumer.json && primaryConsumer.json.result,
        dlqConsumerResponseMetadata: dlqConsumer.json && dlqConsumer.json.result,
      },
    });

    // 3. publish one message
    const publishJobId = `job-${short}`;
    const pubBody = { jobId: publishJobId, jobName: 'send-welcome-email', jobInput: { userId: 7, email: 'ok@example.com' } };
    const pub = await cf('POST', `/accounts/${accountId}/queues/${qid}/messages`, token, { body: pubBody, content_type: 'json' });
    if (!(pub.json && pub.json.success)) throw new Error(`publish failed: ${pub.raw}`);

    // 4. pull + retry loop; observe attempts increasing to 3, then absent
    const attemptsObserved = [];
    let messageIdObserved = null;
    for (let i = 0; i < 20; i += 1) {
      const pull = await cf('POST', `/accounts/${accountId}/queues/${qid}/messages/pull`, token, {
        batch_size: 10,
        visibility_timeout_ms: 2000,
      });
      const msgs = (pull.json && pull.json.result && pull.json.result.messages) || [];
      if (msgs.length === 0) {
        // Wait a bit; message may have been consumed by the retry cycle
        // and not yet visible again, OR moved to DLQ.
        attemptsObserved.push({ pulled: 0 });
        await sleep(2500);
        continue;
      }
      const m = msgs[0];
      messageIdObserved = m.id;
      attemptsObserved.push({ pulled: msgs.length, attempts: m.attempts, id: m.id });
      // Retry: tell CF to reschedule with retry_delay=0
      const ack = await cf('POST', `/accounts/${accountId}/queues/${qid}/messages/ack`, token, {
        retries: [{ lease_id: m.lease_id, delay_seconds: 0 }],
      });
      if (!(ack.json && ack.json.success)) throw new Error(`ack retry failed: ${ack.raw}`);
      await sleep(500);
    }
    // After the loop, message should be either absent (moved to DLQ) or
    // in the DLQ. Poll the DLQ a few times to allow for the vendor's
    // internal retry-to-DLQ transfer window.
    let dlqMsgs = [];
    let dlqBacklog = 0;
    let dlqPullAttempts = 0;
    for (let dp = 0; dp < 10; dp += 1) {
      await sleep(2000);
      dlqPullAttempts += 1;
      const dlqPull = await cf('POST', `/accounts/${accountId}/queues/${dlqId}/messages/pull`, token, {
        batch_size: 10,
        visibility_timeout_ms: 30000,
      });
      dlqMsgs = (dlqPull.json && dlqPull.json.result && dlqPull.json.result.messages) || [];
      dlqBacklog = (dlqPull.json && dlqPull.json.result && dlqPull.json.result.message_backlog_count) || dlqMsgs.length;
      if (dlqMsgs.length > 0 || dlqBacklog >= 1) break;
    }
    // Cloudflare Queues assigns fresh transport message ids when a
    // message lands in the DLQ, so a strict transport id-match is not
    // achievable at the vendor surface. The probe carries its own
    // application-level correlation id in the message body payload
    // (`publishJobId`) and matches on that: the row is only a pass
    // when the same payload jobId that was published to the primary
    // is observed on the DLQ landing.
    const dlqPayloadIds = dlqMsgs.map((mm) => (mm.body && (typeof mm.body === 'string'
      ? (() => { try { return JSON.parse(mm.body).jobId; } catch { return null; } })()
      : mm.body.jobId))).filter(Boolean);
    const idMatch = dlqPayloadIds.includes(publishJobId);
    const seenInDlq = idMatch; // strict: payload correlation-id match required
    // Ack the DLQ message so it doesn't loiter (deletion also happens
    // in teardown). Ack failures are NOT swallowed - they land on
    // teardown.dlqAcks so a failure surfaces on the teardown row.
    teardown.dlqAcks = [];
    for (const mm of dlqMsgs) {
      try {
        const ack = await cf('POST', `/accounts/${accountId}/queues/${dlqId}/messages/ack`, token, {
          acks: [{ lease_id: mm.lease_id }],
        });
        teardown.dlqAcks.push({
          lease_id: mm.lease_id,
          httpStatus: ack.httpStatus,
          success: !!(ack.json && ack.json.success === true),
        });
      } catch (err) {
        teardown.dlqAcks.push({ lease_id: mm.lease_id, ok: false, error: err && err.message });
      }
    }

    // Assertion 1: observed attempts sequence includes non-zero values
    // (real engine incremented the counter).
    const uniqueAttempts = [...new Set(attemptsObserved.filter((a) => a.attempts != null).map((a) => a.attempts))].sort((a, b) => a - b);
    // REQ-004 states the applied queue redelivers per its own retry
    // contract (Cloudflare Queues ceiling 100 per ADR-3003) and the
    // jobs runtime records the attempt counter on each jobStarted
    // event. With max_retries=3 the vendor's attempts counter must
    // reach exactly the [0..3] consecutive sequence (initial delivery
    // 0 plus three retries 1, 2, 3). A gapped sequence such as [0,2,3]
    // fails the row.
    const expectedAttempts = [0, 1, 2, 3];
    const sawRetries = uniqueAttempts.length === expectedAttempts.length
      && uniqueAttempts.every((v, i) => v === expectedAttempts[i]);
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC_ATTEMPTS_LIMITATION,
      verdict: sawRetries ? 'pass' : 'fail',
      detail: sawRetries
        ? `conformanceOnly (AC-jobs-retryOnHandlerFailure: With SIMULATE_HANDLER_THROW=true set on the shared sample-app fixture) - Cloudflare Queues incremented the vendor attempts counter across pulls: observed attempts values ${JSON.stringify(uniqueAttempts)}`
        : `conformanceOnly (AC-jobs-retryOnHandlerFailure: With SIMULATE_HANDLER_THROW=true set on the shared sample-app fixture) - did not observe the vendor attempts counter increment across pulls; attemptsObserved=${JSON.stringify(attemptsObserved)}`,
      evidence: { attemptsObserved, uniqueAttempts, messageId: messageIdObserved, queueName },
    });

    // Assertion 2: message ended up on DLQ (positive dead-letter
    // landing in a real Cloudflare Queue).
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC_DLQ_LIMITATION,
      verdict: seenInDlq ? 'pass' : 'fail',
      detail: seenInDlq
        ? `conformanceOnly (${AC_DLQ_LIMITATION}) - after ${attemptsObserved.length} primary pulls and ${dlqPullAttempts} DLQ polls the message landed on the DLQ ${dlqName} (backlog=${dlqBacklog}, payload-id-match=true for ${publishJobId})`
        : `conformanceOnly (${AC_DLQ_LIMITATION}) - published payload jobId ${publishJobId} did not appear on the DLQ ${dlqName} within ${dlqPullAttempts} polls; dlqBacklog=${dlqBacklog} observedDlqPayloadIds=${JSON.stringify(dlqPayloadIds)} primary pulls=${attemptsObserved.length}`,
      evidence: { dlqName, dlqId, dlqBacklog, dlqTransportMessageIds: dlqMsgs.map((mm) => mm.id), dlqPayloadJobIds: dlqPayloadIds, expectedPayloadJobId: publishJobId, primaryTransportMessageId: messageIdObserved, payloadIdMatch: idMatch, dlqPollAttempts: dlqPullAttempts },
    });
  } finally {
    // 6. Teardown: delete both queues; confirm absent from listing.
    // A teardown failure FAILS the verdict (authoring-standard rule 5).
    if (qid) {
      try {
        const d = await cf('DELETE', `/accounts/${accountId}/queues/${qid}`, token);
        teardown.deletePrimary = { queueId: qid, ok: d.json && d.json.success === true, httpStatus: d.httpStatus };
      } catch (err) {
        teardown.deletePrimary = { queueId: qid, ok: false, error: err && err.message };
      }
    }
    if (dlqId) {
      try {
        const d = await cf('DELETE', `/accounts/${accountId}/queues/${dlqId}`, token);
        teardown.deleteDlq = { queueId: dlqId, ok: d.json && d.json.success === true, httpStatus: d.httpStatus };
      } catch (err) {
        teardown.deleteDlq = { queueId: dlqId, ok: false, error: err && err.message };
      }
    }
    // Confirm absence via a queue list. Assert HTTP status 200 AND
    // json.success === true before treating the listing as authoritative;
    // record both on the teardown so an unsuccessful response never
    // normalises to an empty list (absence must be positive evidence).
    // Cloudflare Queues DELETE is asynchronous - the listing can still
    // carry the queue for a few seconds after DELETE 200. Poll the
    // listing up to ~30 s (six 5-second sleeps) before accepting the
    // result as authoritative. The final observed listing (with the
    // number of polls it took) lands on teardown.listing.
    let listingPolls = 0;
    let list = null;
    try {
      for (let i = 0; i < 6; i += 1) {
        listingPolls += 1;
        list = await cf('GET', `/accounts/${accountId}/queues`, token);
        const httpOk = list.httpStatus === 200;
        const successFlag = !!(list.json && list.json.success === true);
        if (!httpOk || !successFlag) break;
        const nms = (list.json.result || []).map((q) => q.queue_name);
        if (!nms.includes(queueName) && !nms.includes(dlqName)) break;
        await sleep(5000);
      }
      const httpOk = list && list.httpStatus === 200;
      const successFlag = !!(list && list.json && list.json.success === true);
      const listingOk = httpOk && successFlag;
      const names = listingOk
        ? ((list.json && list.json.result) || []).map((q) => q.queue_name)
        : [];
      teardown.listing = {
        httpStatus: list ? list.httpStatus : null,
        success: successFlag,
        listingOk,
        listedCount: names.length,
        pollsTaken: listingPolls,
        errors: list && list.json && list.json.errors ? list.json.errors : null,
      };
      teardown.primaryAbsent = listingOk
        ? { ok: !names.includes(queueName), listedCount: names.length, httpStatus: list.httpStatus, success: successFlag }
        : { ok: false, listedCount: names.length, httpStatus: list.httpStatus, success: successFlag, note: 'listing unsuccessful; absence cannot be asserted' };
      teardown.dlqAbsent = listingOk
        ? { ok: !names.includes(dlqName), listedCount: names.length, httpStatus: list.httpStatus, success: successFlag }
        : { ok: false, listedCount: names.length, httpStatus: list.httpStatus, success: successFlag, note: 'listing unsuccessful; absence cannot be asserted' };
    } catch (err) {
      teardown.listing = { httpStatus: null, success: false, listingOk: false, error: err && err.message };
      teardown.primaryAbsent = { ok: false, error: err && err.message };
      teardown.dlqAbsent = { ok: false, error: err && err.message };
    }
    const dlqAcksOk = Array.isArray(teardown.dlqAcks)
      && teardown.dlqAcks.every((a) => a.success === true);
    const teardownOk = teardown.deletePrimary && teardown.deletePrimary.ok
      && teardown.deleteDlq && teardown.deleteDlq.ok
      && teardown.primaryAbsent && teardown.primaryAbsent.ok
      && teardown.dlqAbsent && teardown.dlqAbsent.ok
      && dlqAcksOk;
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC_TEARDOWN_LIMITATION,
      verdict: teardownOk ? 'pass' : 'fail',
      detail: teardownOk
        ? `conformanceOnly (${AC_TEARDOWN_LIMITATION}) - scratch queues ${queueName} and ${dlqName} deleted and confirmed absent from post-run account queue listing`
        : `conformanceOnly (${AC_TEARDOWN_LIMITATION}) - queue teardown FAILED: ${JSON.stringify(teardown)}`,
      evidence: { teardown },
    });
  }
  return { results, extra: { envDeclared: [...DECLARED_ENV], queueName, dlqName, teardown } };
}
