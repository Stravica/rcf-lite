// Shared helpers for deploy-hetzner-server probes.
//
// Runtime-dependency posture:
// - cloud-init-render-lint, manifest-schema-validate and
//   hcloud-dry-run-mock run in-process against the shared throwaway-
//   server fixture at packages/rcf-lite/test/fixtures/hetzner-throwaway-
//   server/. No real API call fires; hcloud is mocked via
//   src/hcloud-mock.mjs so the shim never crosses the process boundary.
// - real-account-* probes call the fixture's provision.mjs / destroy.mjs
//   / snapshot verbs. Without CI_HAS_HETZNER_ACCOUNT they record
//   accountBoundSkipped: true and the aggregate flips to pass per
//   hetzner-round-7-spec-2026-09-07.md section 3.5.

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(
  PROJECT_ROOT,
  'packages/rcf-lite/test/fixtures/hetzner-throwaway-server',
);
// Config override, not a mutation switch: the fixture-side shim for
// manifest-schema-validate may write a mutated copy to a scratch dir
// and point MANIFEST_DIR at it via RCF_FIXTURE_MANIFEST_DIR so the
// probe stays SIMULATE-free (mutation-purity gate row, 2026-09-08).
export const MANIFEST_DIR = process.env.RCF_FIXTURE_MANIFEST_DIR
  ? resolve(process.env.RCF_FIXTURE_MANIFEST_DIR)
  : resolve(FIXTURE_DIR, 'hetzner/servers');
export const SCHEMA_PATH = resolve(HERE, '..', 'schemas', 'hetzner-server.schema.json');
export const REPORT_DIR = resolve(
  PROJECT_ROOT,
  '.rcf/reports/blueprints/deploy-hetzner-server',
);

export function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export function isSkipped(results) {
  return results.length > 0 && results.every((r) => r.accountBoundSkipped === true);
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const rawVerdict = aggregate(results);
  const aggregateVerdict = isSkipped(results) ? 'pass' : rawVerdict;
  const report = {
    slug: 'deploy-hetzner-server',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
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
    }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}

export async function readManifestFiles(dir = MANIFEST_DIR) {
  let entries;
  try {
    entries = (await readdir(dir))
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch (err) {
    return { present: false, entries: [], files: [], error: err.message };
  }
  const files = [];
  for (const name of entries) {
    const p = join(dir, name);
    const text = await readFile(p, 'utf8');
    files.push({ name, path: p, text });
  }
  return { present: entries.length > 0, entries, files };
}

export function accountBoundSkippedResult(anchorAcId, note) {
  return {
    anchorAcId,
    verdict: 'skipped',
    accountBoundSkipped: true,
    detail: `accountBound: CI_HAS_HETZNER_ACCOUNT unset; ${note}`,
  };
}
