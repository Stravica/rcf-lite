import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/observability-probe-endpoints');
export const DECLARED_ENV = new Set(['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT']);

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
  const raw = aggregate(normalised);
  const aggregateVerdict = isSkipped(normalised) ? 'pass' : raw;
  const report = { slug: 'observability-probe-endpoints', probeName, runAt: new Date().toISOString(), engine, results: normalised, aggregateVerdict, ...(extra ?? {}) };
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
function portFrom(v) { if (v === undefined || v === '') return 0; const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 0; }
export const primaryPort = () => portFrom(process.env.RCF_FIXTURE_OBS_PROBE_PORT);
export const separatePort = () => portFrom(process.env.RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT);
