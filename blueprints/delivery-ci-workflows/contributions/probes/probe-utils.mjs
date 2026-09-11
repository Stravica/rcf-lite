import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/delivery-ci-workflows');
export const DECLARED_ENV = new Set(['RCF_FIXTURE_CIW_ACTIONLINT_PATH', 'CI_HAS_GITHUB_ACTIONS', 'RCF_FIXTURE_CIW_REPO']);

// Standard aggregate: any fail -> fail; any warn -> warn; else pass.
// Rows that cannot be observed here are declared as `conformanceOnly`
// (naming the shipped AC id whose property the row does not observe)
// or `accountBoundSkipped` (naming exactly one declared unset env
// variable). Neither shape emits a warn.
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
    : [{ anchorAcId: null, harnessError: true, verdict: 'fail', detail: 'no checks ran', evidence: { reason: 'no checks ran', probeName, runAt: new Date().toISOString(), engine } }];
  // the strict-evidence contract tightening: an all-skipped row set aggregates as
  // whatever aggregate() returns (skip is neither fail nor warn, so
  // aggregate() returns 'pass' for the pure-skip case on its own).
  // The previous isSkipped ? 'pass' : raw override could promote an
  // all-skipped WARN row set to PASS; it is removed. WARN rows always
  // survive; all-skipped rows still pass via aggregate() directly.
  const aggregateVerdict = aggregate(normalised);
  const report = { slug: 'delivery-ci-workflows', probeName, runAt: new Date().toISOString(), engine, results: normalised, aggregateVerdict, ...(extra ?? {}) };
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
    const results = [{ anchorAcId: null, harnessError: true, verdict: 'fail', detail: `probe threw: ${err?.message ?? err}`, evidence: { thrown: true, message: err?.message ?? String(err), name: err?.name ?? 'Error', probeName, runAt: new Date().toISOString(), engine } }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err?.stack ?? err}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}
