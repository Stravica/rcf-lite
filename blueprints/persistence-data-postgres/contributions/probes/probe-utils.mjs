/**
 * Shared helpers for persistence-data-postgres probes.
 *
 * Runtime-dependency posture: probes import pg via the sample-app
 * fixture's store.mjs so pg resolves from the fixture's own
 * node_modules and rcf-lite itself gains no new runtime dependency
 * (round-5 spec section 5.5, brief section 4).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Project root two levels above blueprints/persistence-data-postgres/
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/infra-postgres');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/persistence-data-postgres');

/**
 * Compute the aggregate verdict per spec section 3.4:
 * - fail if any result carries verdict fail
 * - warn if any result carries verdict warn and no fail
 * - pass otherwise
 */
export function aggregate(results) {
  // Empty or null result sets are a FAIL: a probe that emitted no rows
  // proved nothing (Addendum rule 3, criterion e closure 2026-09-11).
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

/**
 * Write the per-blueprint probe report at
 * .rcf/reports/blueprints/persistence-data-postgres/<probeName>.json
 * per spec section 3.4. An optional extra bag is spread on the envelope
 * so probes can attach teardown records, per-check evidence bags, etc.
 */
export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'persistence-data-postgres',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
    aggregateVerdict: aggregate(results),
    ...(extra ?? {}),
  };
  const path = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
  return { report, path };
}

function normaliseMain(value) {
  if (value == null) {
    return { results: [{ anchorAcId: 'unknown', verdict: 'fail', detail: 'no checks ran (probe returned null / undefined)' }], extra: {} };
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
 * Prints the report JSON to stdout for the gate-reviewer to read.
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
