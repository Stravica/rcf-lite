// Shared helpers for platform-cloudflare-kv probes.
//
// Runtime-dependency posture: probes import the fixture's in-memory
// KV driver, KV facade, and cache-aside helper from the cf-platform
// fixture's src/ tree so rcf-lite itself gains no new runtime
// dependency. The wrangler.toml alongside declares the real KV
// [[kv_namespaces]] binding shape a project would receive when
// composing against live Workers KV; the in-memory driver realises
// the same binding shape (get, getWithMetadata, put, delete, list)
// so the facade module is indistinguishable from a live-KV run at
// the facade boundary.
//
// The real-account eventual-consistency smoke opens the facade
// against a real KV namespace via the Workers KV REST API when the
// CI_HAS_CLOUDFLARE_ACCOUNT env var is set; without the env var it
// records accountBoundSkipped and aggregates to pass per spec
// section 3.5.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/cf-platform');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/platform-cloudflare-kv');

export function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'platform-cloudflare-kv',
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
    if (report.aggregateVerdict !== 'pass') process.exitCode = 1;
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
