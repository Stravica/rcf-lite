/**
 * Shared helpers for messaging-queue-cloudflare probes.
 *
 * Runtime-dependency posture: probes import the fixture's in-memory
 * queue-driver, producer facade, consumer registration, and DLQ
 * inspector from the sample-app fixture's src/ tree so rcf-lite itself
 * gains no new runtime dependency (round-5 spec section 5, brief
 * section 4). The wrangler.toml alongside declares the real Queues
 * binding shape a project would receive when composing against live
 * Cloudflare Queues; the in-memory driver realises the same binding
 * shape (send / sendBatch on the producer side, batch envelope with
 * ack / retry per message on the consumer side) so the facade module
 * is indistinguishable from a live-Queues run at the facade boundary.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Project root four levels above blueprints/messaging-queue-cloudflare/contributions/probes/
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/infra-s3-and-queue');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/messaging-queue-cloudflare');

/**
 * Compute the aggregate verdict per spec section 3.4:
 * - fail if any result carries verdict fail
 * - warn if any result carries verdict warn and no fail
 * - pass otherwise
 */
export function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

/**
 * Write the per-blueprint probe report at
 * .rcf/reports/blueprints/messaging-queue-cloudflare/<probeName>.json
 * per spec section 3.4.
 */
export async function writeReport({ probeName, engine, results }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'messaging-queue-cloudflare',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
    aggregateVerdict: aggregate(results),
  };
  const path = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
  return { report, path };
}

/**
 * Drive an async main() and exit 0 on aggregate pass, 1 otherwise.
 * Prints the report JSON to stdout for the gate-reviewer to read.
 */
export async function runShim(probeName, engine, mainFn) {
  try {
    const results = await mainFn();
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`report written to ${path}\n`);
    process.exit(report.aggregateVerdict === 'pass' ? 0 : 1);
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
    process.exit(1);
  }
}
