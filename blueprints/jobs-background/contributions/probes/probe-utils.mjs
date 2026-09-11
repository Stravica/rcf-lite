/**
 * Shared helpers for jobs-background probes.
 *
 * Runtime-dependency posture: probes import the fixture's in-memory
 * queue-driver plus the jobs-runtime, scheduler and run-log from the
 * sample-app fixture's src/ tree so rcf-lite itself gains no new runtime
 * dependency (round-5 spec section 5, brief section 4). The
 * in-memory queue-driver realises the Cloudflare Queues binding shape;
 * the jobs-runtime consumes messages from the driver, dispatches to
 * job-definition modules, and fires the four lifecycle events on the
 * jobs-background-owned run-log sink (whitelist { event, jobId, jobName, attempts,
 * duration, timestamp } plus optional terminalErrorCode).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Project root four levels above blueprints/jobs-background/contributions/probes/
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/infra-s3-and-queue');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/jobs-background');

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
 * Write the per-blueprint probe report at
 * .rcf/reports/blueprints/jobs-background/<probeName>.json
 * per spec section 3.4.
 */
export async function writeReport({ probeName, engine, results, extra = {} }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'jobs-background',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
    aggregateVerdict: aggregate(results),
    ...extra,
  };
  const path = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
  return { report, path };
}

/**
 * Drive an async main() and exit 0 on aggregate pass, 1 otherwise.
 * Prints the report JSON to stdout for the gate-operator to read.
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
      anchorReqId: 'jobs-background-REQ-001',
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

function normaliseMain(value) {
  if (value == null) {
    // A probe that returned null / undefined proved nothing (authoring-standard rule 3).
    return { results: [{ anchorReqId: 'jobs-background-REQ-001', verdict: 'fail', detail: 'no checks ran (probe returned null / undefined)', evidence: { probeReturnedNullOrUndefined: true } }], extra: {} };
  }
  if (Array.isArray(value)) return { results: value, extra: {} };
  if (value && Array.isArray(value.results)) {
    const { results, ...extra } = value;
    return { results, extra };
  }
  throw new Error('probe main must return an array or an object with a results[] field');
}
