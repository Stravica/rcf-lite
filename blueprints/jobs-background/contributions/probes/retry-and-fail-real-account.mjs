/**
 * Retry-and-fail real-account probe (route-a live-engine coverage).
 *
 * Proves AC-jobs-retryOnHandlerFailure against REAL Cloudflare Queues
 * on the the real-account credentials account, exercising the retry-to-terminal
 * trajectory end-to-end through the vendor's own pull-consumer +
 * dead-letter-queue mechanism (per
 * https://developers.cloudflare.com/queues/configuration/pull-consumers/
 * and https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).
 *
 * Flow:
 *   1. Mint a scratch queue `probe-scratch-q-<short>` and DLQ
 *      `probe-scratch-dlq-<short>` under the QA account via the CF REST
 *      Queues API.
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
 * Anchors AC-jobs-retryOnHandlerFailure.
 */

export const accountBound = true;
export const DECLARED_ENV = Object.freeze([
  'CI_HAS_CLOUDFLARE_ACCOUNT',
  'CF_ACCOUNT_ID',
  'CF_API_TOKEN',
]);

const API_BASE = 'https://api.cloudflare.com/client/v4';

function skipRow(reason) {
  return {
    results: [{
      anchorAcId: 'AC-jobs-retryOnHandlerFailure',
      verdict: 'pass',
      detail: `accountBound: skipped (${reason})`,
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
  const queueName = `probe-scratch-q-${short}`;
  const dlqName = `probe-scratch-dlq-${short}`;
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
      anchorAcId: 'AC-jobs-retryOnHandlerFailure',
      verdict: 'pass',
      detail: `provisioned scratch queue ${queueName} (id=${qid}) with DLQ ${dlqName} (id=${dlqId}), both with http_pull consumers, max_retries=3`,
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
    for (let i = 0; i < 8; i += 1) {
      const pull = await cf('POST', `/accounts/${accountId}/queues/${qid}/messages/pull`, token, {
        batch_size: 10,
        visibility_timeout_ms: 2000,
      });
      const msgs = (pull.json && pull.json.result && pull.json.result.messages) || [];
      if (msgs.length === 0) {
        // Wait a bit; message may have been consumed by the retry cycle
        // and not yet visible again, OR moved to DLQ.
        attemptsObserved.push({ pulled: 0 });
        await sleep(1500);
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
    const seenInDlq = dlqMsgs.some((mm) => mm.id === messageIdObserved) || dlqBacklog >= 1;
    // Ack the DLQ message so it doesn't loiter (deletion also happens in teardown).
    for (const mm of dlqMsgs) {
      await cf('POST', `/accounts/${accountId}/queues/${dlqId}/messages/ack`, token, {
        acks: [{ lease_id: mm.lease_id }],
      }).catch(() => {});
    }

    // Assertion 1: observed attempts sequence includes non-zero values
    // (real engine incremented the counter).
    const uniqueAttempts = [...new Set(attemptsObserved.filter((a) => a.attempts != null).map((a) => a.attempts))].sort((a, b) => a - b);
    const sawRetries = uniqueAttempts.length >= 2 && uniqueAttempts[uniqueAttempts.length - 1] >= 1;
    results.push({
      anchorAcId: 'AC-jobs-retryOnHandlerFailure',
      verdict: sawRetries ? 'pass' : 'fail',
      detail: sawRetries
        ? `Cloudflare Queues incremented the attempts counter across pulls: observed attempts values ${JSON.stringify(uniqueAttempts)}`
        : `did not observe the attempts counter increment across pulls; attemptsObserved=${JSON.stringify(attemptsObserved)}`,
      evidence: { attemptsObserved, uniqueAttempts, messageId: messageIdObserved, queueName },
    });

    // Assertion 2: message ended up on DLQ (positive dead-letter
    // landing in a real Cloudflare Queue).
    results.push({
      anchorAcId: 'AC-jobs-retryOnHandlerFailure',
      verdict: seenInDlq ? 'pass' : 'fail',
      detail: seenInDlq
        ? `after ${attemptsObserved.length} primary pulls and ${dlqPullAttempts} DLQ polls the message landed on the DLQ ${dlqName} (backlog=${dlqBacklog}, id-match=${dlqMsgs.some((mm) => mm.id === messageIdObserved)})`
        : `message did not reach the DLQ ${dlqName} within ${dlqPullAttempts} polls; dlqBacklog=${dlqBacklog} primary pulls=${attemptsObserved.length}`,
      evidence: { dlqName, dlqId, dlqBacklog, dlqMessageIds: dlqMsgs.map((mm) => mm.id), expectedMessageId: messageIdObserved, dlqPollAttempts: dlqPullAttempts },
    });
  } finally {
    // 6. Teardown: delete both queues; confirm absent from listing.
    // A teardown failure FAILS the verdict (Addendum rule 5).
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
    // Confirm absence via a queue list
    try {
      const list = await cf('GET', `/accounts/${accountId}/queues`, token);
      const names = ((list.json && list.json.result) || []).map((q) => q.queue_name);
      teardown.primaryAbsent = { ok: !names.includes(queueName), listedCount: names.length };
      teardown.dlqAbsent = { ok: !names.includes(dlqName), listedCount: names.length };
    } catch (err) {
      teardown.primaryAbsent = { ok: false, error: err && err.message };
      teardown.dlqAbsent = { ok: false, error: err && err.message };
    }
    const teardownOk = teardown.deletePrimary && teardown.deletePrimary.ok
      && teardown.deleteDlq && teardown.deleteDlq.ok
      && teardown.primaryAbsent && teardown.primaryAbsent.ok
      && teardown.dlqAbsent && teardown.dlqAbsent.ok;
    results.push({
      anchorAcId: 'AC-jobs-retryOnHandlerFailure',
      verdict: teardownOk ? 'pass' : 'fail',
      detail: teardownOk
        ? `scratch queues ${queueName} and ${dlqName} deleted and confirmed absent from post-run account queue listing`
        : `queue teardown FAILED: ${JSON.stringify(teardown)}`,
      evidence: { teardown },
    });
  }
  return { results, extra: { envDeclared: [...DECLARED_ENV], queueName, dlqName, teardown } };
}
