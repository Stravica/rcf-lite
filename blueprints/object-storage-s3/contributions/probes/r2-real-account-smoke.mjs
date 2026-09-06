/**
 * R2 real-account smoke probe.
 *
 * Opens the facade against a real Cloudflare R2 bucket (endpoint URL,
 * bucket, and credential pair read via security-secrets-management),
 * puts a 1 KiB payload, gets it back, asserts byte equality, deletes
 * the temporary object.
 *
 * accountBound: true. Skipped in CI without CI_HAS_CLOUDFLARE_ACCOUNT
 * per infra round 5 spec section 3.5.
 *
 * Anchors AC-28108-1.
 */

import { createObjectStore, credentialsFromShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs';
import { secretsShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs';
import { probeKey } from './probe-utils.mjs';

export const accountBound = true;

export default async function runProbe() {
  if (!process.env.CI_HAS_CLOUDFLARE_ACCOUNT) {
    return [{
      anchorAcId: 'AC-28108-1',
      verdict: 'pass',
      detail: 'accountBound: skipped (no CI_HAS_CLOUDFLARE_ACCOUNT)',
      accountBoundSkipped: true,
    }];
  }
  const r2 = await secretsShim.getSecret('r2Endpoint');
  if (!r2) {
    return [{
      anchorAcId: 'AC-28108-1',
      verdict: 'fail',
      detail: 'CI_HAS_CLOUDFLARE_ACCOUNT set but r2Endpoint secret missing (R2_ACCOUNT_ID and R2_BUCKET required via security-secrets-management)',
    }];
  }
  const credentials = await credentialsFromShim(secretsShim);
  const events = [];
  const store = createObjectStore({
    endpointUrl: r2.endpoint,
    bucket: r2.bucket,
    credentialsRef: credentials,
    region: 'auto',
    forcePathStyle: false,
    onEvent: (e) => events.push(e),
  });
  const key = probeKey('probe/r2-smoke');
  const body = Buffer.alloc(1024, 0x52);
  try {
    await store.ready();
    await store.putObject(key, 'application/octet-stream', body);
    const got = await store.getObject(key);
    const pass = got.body.length === 1024 && got.body.equals(body);
    return [{
      anchorAcId: 'AC-28108-1',
      verdict: pass ? 'pass' : 'fail',
      detail: pass ? `R2 round-trip byte-equal against ${r2.endpoint}/${r2.bucket}` : 'R2 round-trip failed byte equality',
    }];
  } finally {
    try { await store.deleteObject(key); } catch { /* best effort */ }
    await store.close();
  }
}
