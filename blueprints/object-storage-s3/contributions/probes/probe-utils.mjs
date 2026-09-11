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
  if (Array.isArray(value)) return { results: value, extra: {} };
  if (value && Array.isArray(value.results)) {
    const { results, ...extra } = value;
    return { results, extra };
  }
  throw new Error('probe main must return an array or an object with a results[] field');
}

/**
 * Drive an async main() and exit 0 on aggregate pass, 1 otherwise.
 * Prints the report JSON to stdout for the gate-reviewer to read.
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
      anchorAcId: 'unknown',
      verdict: 'fail',
      detail: `probe threw: ${err && err.message ? err.message : String(err)}`,
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
