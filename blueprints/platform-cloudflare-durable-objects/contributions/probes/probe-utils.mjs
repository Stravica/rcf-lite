// Shared helpers for platform-cloudflare-durable-objects probes.
//
// Runtime-dependency posture: probes import the fixture's DO
// facade, single-cell class, hub class and in-memory storage
// driver from the cf-platform fixture src/ tree so rcf-lite itself
// gains no new runtime dependency. Six probes drive the shipped
// code path in-process against the in-memory driver; one probe
// (real-account-storage-smoke) drives an HTTP round trip against a
// deployed Worker when CI_HAS_CLOUDFLARE_ACCOUNT is set. Without
// the env var it records accountBoundSkipped and aggregates to
// pass per spec section 3.5.
//
// The wrangler dev seam is documented in the fixture README under
// the "T-3 wrangler dev optional boot" section; the shipped
// in-process probes do NOT require a wrangler dev process to
// drive their assertions.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/cf-platform');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/platform-cloudflare-durable-objects');

export function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'platform-cloudflare-durable-objects',
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

// A minimal in-process WebSocket pair used by the hub probes. Each
// paired socket exposes send(str) which buffers into inbound[] on
// the same socket so a probe can assert delivery; close(code,
// reason) is a no-op. This is a local test double for the WebSocket
// contract the hub actually depends on (send + close), scoped to
// the probe run only.
export function createInProcessSocketPair(name = 'ws') {
  const inbound = [];
  const closed = { flag: false };
  const socket = {
    name,
    inbound,
    closed,
    send(str) {
      // Route what the hub sends back into inbound so a probe can
      // assert delivery. The hub calls send() on every socket it
      // wants to reach.
      inbound.push(str);
    },
    close(code, reason) {
      closed.flag = true;
      closed.code = code;
      closed.reason = reason;
    },
  };
  return socket;
}

// Minimal in-process DurableObjectState double. Exposes the two
// members the hub calls on state (acceptWebSocket, getWebSockets);
// scoped to the probe run only.
export function createInProcessDoState() {
  const accepted = [];
  return {
    acceptWebSocket(ws) { accepted.push(ws); },
    getWebSockets() { return accepted.slice(); },
  };
}

// Backwards-compatible aliases. The rename to createInProcess* was
// driven by the honest-labelling sweep in H-2 (finding rows
// f-2026-09-08-stage2-218 and f-2026-09-08-stage2-219); the
// aliases below let any existing anatomy assertion or downstream
// probe still resolve the older names during the same train.
export const createFakeSocketPair = createInProcessSocketPair;
export const createFakeState = createInProcessDoState;
