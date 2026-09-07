// Shared helpers for platform-cloudflare-cron-triggers probes.
//
// Runtime-dependency posture: probes import the fixture's scheduled
// handler and dispatcher from the cf-platform fixture src/ tree so
// rcf-lite itself gains no new runtime dependency. The
// wrangler-test-scheduled probe drives the vendor's CLI seam via a
// child process; the dispatcher-routing, skew-tolerance and
// event-secrecy probes drive the dispatcher in-process against
// spy handlers.
//
// The real-account-scheduled-smoke probe opens the Cloudflare
// Workers API when CI_HAS_CLOUDFLARE_ACCOUNT is set; without the
// env var it records accountBoundSkipped and aggregates to pass
// per spec section 3.5.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/cf-platform');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/platform-cloudflare-cron-triggers');

export function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'platform-cloudflare-cron-triggers',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
    aggregateVerdict: aggregate(results),
    ...(extra ?? {}),
  };
  const path = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { report, path };
}

// Wraps a probe's async main body and reports. Never calls
// process.exit after the large report write: sets process.exitCode
// and lets Node drain stdout naturally.
export async function runShim(probeName, engine, mainFn) {
  try {
    const { results, extra } = await mainFn();
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
