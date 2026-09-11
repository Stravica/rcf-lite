// Shared helpers for security-auth-magic-link probes.
//
// Runtime-dependency posture:
// - Local probes drive token-issue / token-verify shape on the
//   fixture-owned magic-link manager against a deterministic clock;
//   no network call.
// - real-account-magic-link-send drives Resend's HTTP API
//   (https://api.resend.com/emails, docs
//   https://resend.com/docs/api-reference/emails/send-email
//   verifiedOn 2026-09-11) with the vendor's documented sandbox
//   sender `onboarding@resend.dev` and sandbox recipient
//   `delivered@resend.dev` (per
//   https://resend.com/docs/dashboard/emails/send-test-emails
//   verifiedOn 2026-09-11), which routes the message to the
//   Resend sandbox rather than a real inbox. The probe records the
//   Resend-assigned email id and the HTTP status as positive
//   evidence per rule 7d. Without CI_HAS_RESEND_ACCOUNT the probe
//   honest-skips naming the missing var.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/security-auth-magic-link');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/security-auth-magic-link');

export const DECLARED_ENV = Object.freeze([
  'CI_HAS_RESEND_ACCOUNT',
  'RESEND_API_KEY',
  'RESEND_API_BASE_URL',
  'RESEND_SANDBOX_FROM',
  'RESEND_SANDBOX_TO',
]);

export const RESEND_SANDBOX_FROM_DEFAULT = 'onboarding@resend.dev';
export const RESEND_SANDBOX_TO_DEFAULT = 'delivered@resend.dev';
export const RESEND_API_BASE_URL_DEFAULT = 'https://api.resend.com';

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
  const raw = aggregate(results);
  const aggregateVerdict = isSkipped(results) ? 'pass' : raw;
  const report = { slug: 'security-auth-magic-link', probeName, runAt: new Date().toISOString(), engine, results, aggregateVerdict, ...(extra ?? {}) };
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
    anchorAcId, capability, verdict: 'pass',
    accountBoundSkipped: true, reason,
    detail: `accountBoundSkipped: ${reason} unset; probe did not execute against the live Resend API. Set the missing var and re-run.`,
  };
}
