// Shared helpers for security-auth-keycloak probes.
//
// Runtime-dependency posture:
// - Local probes drive shipped-shape checks against the fixture at
//   packages/rcf-lite/test/fixtures/security-auth-keycloak/ without
//   contacting a real Keycloak realm.
// - real-account-* probes call the Keycloak Admin REST API and
//   OIDC endpoints against a live Keycloak realm when one is
//   available. No live Keycloak client is available in this estate
//   (no live realm is exposed to shelf probes in this estate), so the
//   real-account probe honest-skips per rule 7d, recording
//   accountBoundSkipped: true naming CI_HAS_KEYCLOAK_ACCOUNT.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/security-auth-keycloak');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/security-auth-keycloak');

export const DECLARED_ENV = Object.freeze([
  'CI_HAS_KEYCLOAK_ACCOUNT',
  'KEYCLOAK_BASE_URL',
  'KEYCLOAK_REALM',
  'KEYCLOAK_ADMIN_CLIENT_ID',
  'KEYCLOAK_ADMIN_CLIENT_SECRET',
  'KEYCLOAK_INTROSPECTION_TOKEN',
]);

export function aggregate(results) {
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export function isSkipped(results) {
  return results.length > 0 && results.every((r) => r.accountBoundSkipped === true);
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const raw = aggregate(results);
  const aggregateVerdict = isSkipped(results) ? 'pass' : raw;
  const report = {
    slug: 'security-auth-keycloak',
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
    const outcome = await mainFn();
    if (!outcome || !Array.isArray(outcome.results) || outcome.results.length === 0) {
      const results = [{
        anchorAcId: 'unknown',
        verdict: 'fail',
        detail: 'no checks ran (probe returned null/empty results); positive-evidence rule 7d requires each probe to observe a property',
      }];
      const { report, path } = await writeReport({ probeName, engine, results });
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      process.stderr.write(`no-checks-ran fail written to ${path}\n`);
      process.exitCode = 1;
      return;
    }
    const { results, extra } = outcome;
    const { report, path } = await writeReport({ probeName, engine, results, extra });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`report written to ${path}\n`);
    if (report.aggregateVerdict === 'fail') process.exitCode = 1;
  } catch (err) {
    const results = [{ anchorAcId: 'unknown', verdict: 'fail', detail: `probe threw: ${err && err.message ? err.message : String(err)}` }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}

export function accountBoundSkippedResult(anchorAcId, capability, reason) {
  return {
    anchorAcId,
    capability,
    verdict: 'pass',
    accountBoundSkipped: true,
    reason,
    detail: `accountBoundSkipped: ${reason} unset; probe did not execute against a real Keycloak realm. Set the missing var and re-run.`,
  };
}
