// Shared helpers for application-error-handling probes.
//
// The engine under probe is the sample-app fixture at
// packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js. The
// fixture stamps an x-fixture-request-id header on every response as
// part of its own request pipeline (no probe-side monkey-patch), so
// the identifier the probe records is the identifier the engine
// itself issued. Probes call the fixture over real HTTP via node's
// fetch, vary inputs and assert derived outputs (Addendum rule 2,
// 2026-09-11), and record request-id, status, body excerpt, the
// varied input and the derived output as evidence on every result
// row (Addendum rule 3).
//
// No account-bound branch: the engine is a local fixture, not a
// third-party account, so no CI_HAS_* gate is invented. Every env
// var this pack reads is declared on the fixture README.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/probe-pack-application-error-handling');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/application-error-handling');

export const DEFAULT_PORT = 0;

export function aggregate(results) {
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

// Rule 7d addendum 2026-09-11 (rule 3): empty results never pass.
// A synthesised row is emitted with an actionable detail and its
// own evidence object recording the empty condition so the row is
// not a naked verdict scalar.
export function normaliseResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return [{
      anchorReqId: 'unknown',
      verdict: 'fail',
      detail: 'no checks ran',
      evidence: {
        reason: 'empty-results',
        route: 'n/a',
        status: 0,
        xFixtureRequestId: null,
        bodyExcerpt: '',
      },
    }];
  }
  return results;
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'application-error-handling',
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

// Starts the fixture on an ephemeral port (or PROBE_PORT when set)
// and returns { server, port, baseUrl, close }. The close helper
// rejects when the underlying close callback carries an error;
// swallowing a teardown error would violate Addendum rule 5.
export async function startFixture({ startServer, port } = {}) {
  const resolvedPort = typeof port === 'number'
    ? port
    : Number(process.env.PROBE_PORT ?? DEFAULT_PORT);
  const started = await startServer({ port: resolvedPort });
  return {
    server: started.server,
    port: started.port,
    baseUrl: `http://127.0.0.1:${started.port}`,
    close: () => new Promise((res, rej) => started.server.close((err) => {
      if (err) rej(err);
      else res();
    })),
  };
}

// Reads a distinctive slice of a response body: the first N chars
// so the report carries a body excerpt alongside the header id.
export function bodyExcerpt(text, max = 240) {
  if (text == null) return '';
  const s = typeof text === 'string' ? text : String(text);
  return s.length > max ? s.slice(0, max) + '...' : s;
}

// Records the positive-evidence shape on a probe result. Every row
// carries route, status, the request id the fixture stamped, and a
// body excerpt; the caller may extend the object with the varied
// input and the derived output for that row.
export function evidenceFromResponse({ route, response, bodyText, extraFields }) {
  return {
    route,
    status: response.status,
    xFixtureRequestId: response.headers.get('x-fixture-request-id') || null,
    bodyExcerpt: bodyExcerpt(bodyText),
    ...(extraFields ?? {}),
  };
}

export async function runShim(probeName, engine, mainFn) {
  try {
    const outcome = (await mainFn()) ?? { results: [] };
    const { results, extra } = outcome;
    const { report, path } = await writeReport({ probeName, engine, results: normaliseResults(results), extra });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`report written to ${path}\n`);
    if (report.aggregateVerdict !== 'pass') process.exitCode = 1;
  } catch (err) {
    const results = [{
      anchorReqId: 'unknown',
      verdict: 'fail',
      detail: `probe threw: ${err && err.message ? err.message : String(err)}`,
      evidence: {
        reason: 'probe-threw',
        route: 'n/a',
        status: 0,
        xFixtureRequestId: null,
        bodyExcerpt: err && err.stack ? String(err.stack).slice(0, 240) : '',
      },
    }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}
