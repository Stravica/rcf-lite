/**
 * Presigned URL probe.
 *
 * Per AC-28103-1 the property is: with a bounded TTL, a fetch WITHIN
 * TTL returns 200, and the SAME URL fetched after TTL+2 seconds
 * returns 403 (S3-shape AccessDenied). This probe proves the property
 * exactly: it presigns a URL at the ADR-2902 floor of 60s, fetches it
 * within TTL and records 200 + body-equal, then sleeps TTL+2s and
 * fetches the SAME URL again and records 403.
 *
 * The floor-refusal below the 60s floor is also asserted (a separate
 * result row) per ADR-2902.
 */

import { createObjectStore, endpointFromEnv, credentialsFromShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs';
import { secretsShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs';
import { probeKey } from './probe-utils.mjs';
import { createHash } from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AC28103_1 = 'Given a presignGetUrl call with ttl=60 seconds for';
const REQ003 = 'The facade exposes a presignGetUrl verb that issues';

export default async function runProbe() {
  const { endpoint, bucket, region, forcePathStyle } = endpointFromEnv();
  const credentials = await credentialsFromShim(secretsShim);
  const events = [];
  const store = createObjectStore({
    endpointUrl: endpoint,
    bucket,
    credentialsRef: credentials,
    region,
    forcePathStyle,
    onEvent: (e) => events.push(e),
  });
  const results = [];
  const key = probeKey('probe/presign');
  const body = Buffer.from('presigned url payload');
  try {
    await store.ready();
    await store.putObject(key, 'text/plain', body);

    // AC-28103-1 canonical timing test: TTL=60, fetch within TTL, then
    // fetch the SAME URL after TTL+2s.
    const ttl = 60;
    const url = await store.presignGetUrl(key, ttl);
    const urlSha256 = createHash('sha256').update(url).digest('hex');
    const issuedAt = Date.now();
    const first = await fetch(url);
    const firstBody = Buffer.from(await first.arrayBuffer());
    const firstStatus = first.status;
    const firstEqual = firstBody.equals(body);
    const issued = events.find((e) => e.event === 'presignedIssued' && e.key === key && e.ttl === ttl);
    results.push({
      anchorAcId: 'AC-28103-1',
      verdict: firstStatus === 200 && firstEqual && issued ? 'pass' : 'fail',
      detail: firstStatus === 200 && firstEqual && issued
        ? `${AC28103_1} - fetch within TTL returned 200 with matching body; presignedIssued fired with ttl=${ttl}; urlSha256=${urlSha256.slice(0, 12)}`
        : `${AC28103_1} - firstStatus=${firstStatus} bodyMatch=${firstEqual} issued=${Boolean(issued)}`,
      evidence: {
        key,
        ttl,
        firstStatus,
        firstBodyBytes: firstBody.length,
        firstBodyEqual: firstEqual,
        presignedIssuedEvent: issued || null,
        urlSha256,
        elapsedMsSincePresign: Date.now() - issuedAt,
      },
    });

    // Wait past TTL and fetch the SAME URL. AC-28103-1 explicitly says
    // "the same URL". This is a wall-clock wait; the probe budget
    // includes it.
    const waitMs = (ttl + 2) * 1000;
    await sleep(waitMs);
    const second = await fetch(url);
    const secondStatus = second.status;
    results.push({
      anchorAcId: 'AC-28103-1',
      verdict: secondStatus === 403 ? 'pass' : 'fail',
      detail: secondStatus === 403
        ? `${AC28103_1} - after TTL+2s the SAME presigned URL (urlSha256=${urlSha256.slice(0, 12)}) returned 403 (AccessDenied / expired-URL family)`
        : `${AC28103_1} - after TTL+2s the SAME presigned URL returned ${secondStatus}, expected 403`,
      evidence: {
        key,
        ttl,
        waitedMs: waitMs,
        secondStatus,
        urlSha256,
        totalElapsedMsSincePresign: Date.now() - issuedAt,
      },
    });

    // ADR-2902 floor refusal is not stated by any AC (AC-28103-1
    // states TTL 60 success/expiry). Anchor to REQ-003 which names
    // the floor of 1 minute.
    let refusedBelowFloor = false;
    let refusedError = null;
    try { await store.presignGetUrl(key, 30); } catch (err) { refusedBelowFloor = true; refusedError = err && err.message; }
    results.push({
      anchorReqId: 'object-storage-s3-REQ-003',
      verdict: refusedBelowFloor ? 'pass' : 'fail',
      detail: refusedBelowFloor
        ? `${REQ003} - presign below the 60s floor refused per ADR-2902 (${refusedError})`
        : `${REQ003} - presign below the 60s floor did not refuse`,
      evidence: { requestedTtlSeconds: 30, floorSeconds: 60, refused: refusedBelowFloor, error: refusedError },
    });

    await store.deleteObject(key);
  } finally {
    await store.close();
  }
  return { results, extra: { key } };
}
