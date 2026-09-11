// Shared helpers for persistence-data-sqlite probes.
//
// Runtime posture: probes import the fixture's store facade at
// packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs
// which opens node:sqlite (Node 24 built-in). No probe uses a mock;
// every probe runs against the real engine and records positive
// evidence (a real integer row id, a real migration list, the real
// WAL checkpoint counters).
//
// The blueprint has no account-bound branch, so the accountBoundSkipped
// path is not exercised by this pack; the helper is retained for
// symmetry with the shelf's probe-utils shape.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(
  PROJECT_ROOT,
  'packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite',
);
export const REPORT_DIR = resolve(
  PROJECT_ROOT,
  '.rcf/reports/blueprints/persistence-data-sqlite',
);

export const DECLARED_ENV = new Set([
  'RCF_FIXTURE_SQLITE_PATH',
]);

export function aggregate(results) {
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}
export function isSkipped(results) { return Array.isArray(results) && results.length > 0 && results.every((r) => r.accountBoundSkipped === true); }

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const normalised = (Array.isArray(results) && results.length > 0)
    ? results
    : [{ anchorAcId: 'unknown', verdict: 'fail', detail: 'no checks ran', evidence: { reason: 'no checks ran', probeName, runAt: new Date().toISOString(), engine } }];
  const raw = aggregate(normalised);
  const aggregateVerdict = isSkipped(normalised) ? 'pass' : raw;
  const report = {
    slug: 'persistence-data-sqlite',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results: normalised,
    aggregateVerdict,
    ...(extra ?? {}),
  };
  const path = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { report, path };
}

export async function runShim(probeName, engine, mainFn) {
  try {
    const outcome = (await mainFn()) ?? { results: [] };
    const { results, extra } = outcome;
    const { report, path } = await writeReport({ probeName, engine, results, extra });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`report written to ${path}\n`);
    if (report.aggregateVerdict === 'fail') process.exitCode = 1;
  } catch (err) {
    const results = [{
      anchorAcId: 'unknown',
      verdict: 'fail',
      detail: `probe threw: ${err && err.message ? err.message : String(err)}`,
      evidence: { thrown: true, message: err && err.message ? err.message : String(err), name: err && err.name ? err.name : 'Error', probeName, runAt: new Date().toISOString(), engine },
    }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}
