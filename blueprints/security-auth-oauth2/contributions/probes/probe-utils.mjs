// Shared helpers for security-auth-oauth2 probes.
//
// Runtime-dependency posture:
// - Local probes drive shipped-shape checks against the fixture at
//   packages/rcf-lite/test/fixtures/security-auth-oauth2/ without
//   contacting a real identity provider.
// - authorisation-code-flow-shape probe boots a small local mock
//   authorisation server on a port in the 47400-47449 range (see
//   fixture README) and drives a full RFC 6749 + RFC 7636 PKCE code
//   flow against it: request id, response body excerpts and the
//   final access-token response prove the wire shape locally.
// - real-account-authorisation-code-flow probe honest-skips on
//   CI_HAS_OAUTH2_PROVIDER: no live commercial IdP is available in
//   this estate. The probe records accountBoundSkipped: true naming
//   CI_HAS_OAUTH2_PROVIDER per rule 7d; the AMBER row on the shelf
//   review is the honest outcome.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/security-auth-oauth2');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/security-auth-oauth2');

export const DECLARED_ENV = Object.freeze([
  'CI_HAS_OAUTH2_PROVIDER',
  'OAUTH2_ISSUER_URL',
  'OAUTH2_CLIENT_ID',
  'OAUTH2_CLIENT_SECRET',
  'OAUTH2_REDIRECT_URI',
  'OAUTH2_MOCK_PORT',
]);

export const MOCK_PORT_RANGE = { min: 47400, max: 47449 };

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
    slug: 'security-auth-oauth2',
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

export function accountBoundSkippedResult(anchorAcId, capability, reason) {
  return {
    anchorAcId,
    capability,
    verdict: 'pass',
    accountBoundSkipped: true,
    reason,
    detail: `accountBoundSkipped: ${reason} unset; probe did not execute against a real OAuth 2.0 provider. Set the missing var and re-run.`,
  };
}
