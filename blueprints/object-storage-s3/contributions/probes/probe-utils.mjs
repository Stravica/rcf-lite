/**
 * Shared helpers for object-storage-s3 probes.
 *
 * Runtime-dependency posture: probes import the S3 client through the
 * sample-app fixture's object-store.mjs so @aws-sdk/client-s3 resolves
 * from the fixture's own node_modules and rcf-lite itself gains no new
 * runtime dependency (round-5 spec section 5, brief section 4).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Project root four levels above blueprints/object-storage-s3/contributions/probes/
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/infra-s3-and-queue');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/object-storage-s3');

/**
 * Compute the aggregate verdict per spec section 3.4:
 * - fail if any result carries verdict fail
 * - warn if any result carries verdict warn and no fail
 * - pass otherwise
 */
export function aggregate(results) {
  // Empty or null result sets are a FAIL: a probe that emitted no rows
  // proved nothing (authoring-standard rule 3, criterion e conformance 2026-09-11).
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

/**
 * Return true when every result is an account-bound skip; the
 * aggregate then flips to pass per spec section 3.5 and authoring
 * standard section 7d.
 */
export function isAccountBoundSkipped(results) {
  return results.length > 0 && results.every((r) => r.accountBoundSkipped === true);
}

/**
 * Write the per-blueprint probe report at
 * .rcf/reports/blueprints/object-storage-s3/<probeName>.json
 * per spec section 3.4. Accepts an optional extra bag that is
 * spread onto the report envelope (e.g. envDeclared, evidence,
 * accountBoundSkipped) so real-account probes can surface positive
 * evidence per authoring standard section 7d.
 */
export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const raw = aggregate(results);
  const aggregateVerdict = isAccountBoundSkipped(results) ? 'pass' : raw;
  const report = {
    slug: 'object-storage-s3',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
    aggregateVerdict,
    ...(extra ?? {}),
  };
  const path = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
  return { report, path };
}

function normaliseMain(value) {
  if (value == null) {
    // A probe that returned null / undefined proved nothing (authoring-standard rule 3).
    return { results: [{ anchorReqId: 'object-storage-s3-REQ-001', verdict: 'fail', detail: 'no checks ran (probe returned null / undefined)', evidence: { probeReturnedNullOrUndefined: true } }], extra: {} };
  }
  if (Array.isArray(value)) return { results: value, extra: {} };
  if (value && Array.isArray(value.results)) {
    const { results, ...extra } = value;
    return { results, extra };
  }
  throw new Error('probe main must return an array or an object with a results[] field');
}

/**
 * Drive an async main() and exit 0 on aggregate pass, 1 otherwise.
 * Prints the report JSON to stdout for the gate-operator to read.
 * The probe main may return either an array of result records or an
 * envelope { results, ...extra } whose extra bag is written onto the
 * report envelope alongside the aggregateVerdict.
 */
export async function runShim(probeName, engine, mainFn) {
  try {
    const { results, extra } = normaliseMain(await mainFn());
    const { report, path } = await writeReport({ probeName, engine, results, extra });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`report written to ${path}\n`);
    process.exit(report.aggregateVerdict === 'pass' ? 0 : 1);
  } catch (err) {
    const results = [{
      anchorReqId: 'object-storage-s3-REQ-001',
      verdict: 'fail',
      detail: `probe threw: ${err && err.message ? err.message : String(err)}`,
      evidence: { probeThrew: true, errorMessage: err && err.message ? err.message : String(err), errorName: err && err.name },
    }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exit(1);
  }
}

/**
 * Generate a stable probe key namespace so parallel runs and re-runs
 * don't stomp each other.
 */
export function probeKey(prefix) {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${prefix}/${Date.now()}-${suffix}`;
}

/**
 * Fetch MinIO /minio/health/live for the current run's S3 endpoint and
 * return an observed engine descriptor:
 *   { kind: 's3', vendor: 'minio', endpointHost, healthLive: { httpStatus, responseTimeMs, ok } }
 * Never returns a fabricated healthy: true. A failed probe returns
 * `{ ok: false, error }` under `healthLive`.
 */
export async function observeMinioEngine() {
  const endpointUrl = process.env.S3_ENDPOINT_URL;
  if (!endpointUrl) {
    // S3_ENDPOINT_URL is a required declared variable per the
    // endpoint-hosts rule; caller records an exact one-variable skip when unset.
    return { kind: 's3', vendor: 'minio', endpointHost: null, healthLive: { ok: false, error: 'S3_ENDPOINT_URL unset' } };
  }
  const url = new URL('/minio/health/live', endpointUrl);
  const started = Date.now();
  try {
    const res = await fetch(url.toString(), { method: 'GET' });
    return {
      kind: 's3',
      vendor: 'minio',
      endpointHost: url.host,
      healthLive: {
        ok: res.status === 200,
        httpStatus: res.status,
        responseTimeMs: Date.now() - started,
        endpoint: url.toString(),
      },
    };
  } catch (err) {
    return {
      kind: 's3',
      vendor: 'minio',
      endpointHost: url.host,
      healthLive: {
        ok: false,
        error: err && err.message,
        responseTimeMs: Date.now() - started,
        endpoint: url.toString(),
      },
    };
  }
}

/**
 * Observe R2 by issuing a lightweight ListBuckets against the R2
 * endpoint from the fixture secrets shim. Returns an engine descriptor
 * with a real request id and http status. Returns a not-observed
 * descriptor when the account gate is unset , the probe itself will
 * account-bound-skip and no wire call should be made here.
 */
export async function observeR2Engine() {
  if (process.env.CI_HAS_CLOUDFLARE_ACCOUNT !== 'true') {
    return { kind: 's3', vendor: 'cloudflare-r2', observed: false, reason: 'CI_HAS_CLOUDFLARE_ACCOUNT unset' };
  }
  try {
    const { secretsShim } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs');
    const { credentialsFromShim } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs');
    const { createBucketOps } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/bucket-ops.mjs');
    const r2 = await secretsShim.getSecret('r2Endpoint');
    if (!r2 || !r2.endpoint) return { kind: 's3', vendor: 'cloudflare-r2', observed: false, reason: 'r2Endpoint unresolvable' };
    const credentials = await credentialsFromShim(secretsShim);
    const ops = createBucketOps({ endpointUrl: r2.endpoint, region: 'auto', credentials, forcePathStyle: false });
    const started = Date.now();
    try {
      const list = await ops.listBuckets();
      const host = new URL(r2.endpoint).host;
      return {
        kind: 's3',
        vendor: 'cloudflare-r2',
        endpointHostRedacted: host.replace(/^[0-9a-f]+/, '[account-id]'),
        listBuckets: {
          ok: true,
          httpStatus: list.raw && list.raw.$metadata && list.raw.$metadata.httpStatusCode,
          requestId: list.raw && list.raw.$metadata && list.raw.$metadata.requestId,
          bucketCount: list.buckets.length,
          responseTimeMs: Date.now() - started,
        },
      };
    } finally {
      ops.close();
    }
  } catch (err) {
    return { kind: 's3', vendor: 'cloudflare-r2', observed: false, error: err && err.message };
  }
}
