// Shared helpers for application-error-handling probes.
//
// The real engine under probe is the sample-app fixture at
// packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js. The
// probe starts that server on a port from the reserved 47300-47399
// range (default 47303, overridable via PROBE_PORT), makes
// a real HTTP round trip via node's fetch, and records the
// per-request identifier the fixture echoes on x-fixture-request-id
// alongside the response status, a distinctive body excerpt, and the
// route hit. See rule 7d of packages/rcf-lite/docs/blueprint-authoring.md
// for the positive-evidence rule.
//
// No account-bound branch applies to application-shelf probes: the
// engine is a local fixture, not a third-party account, so no
// CI_HAS_* gate is invented. Every env var the probe reads is
// declared on the fixture README's Declared env vars table.

import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/probe-pack-application-error-handling');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/application-error-handling');

export const DEFAULT_PORT = 47303;

export function aggregate(results) {
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

// Rule 7d addendum 2026-09-11 (item 3): empty results must never pass. When
// a probe returns no rows we synthesise a single fail row so the report
// carries an actionable detail rather than an implicit-pass empty list.
export function normaliseResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return [{
      anchorReqId: 'unknown',
      verdict: 'fail',
      detail: 'no checks ran',
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

// Wraps the fixture http.Server so every response carries an
// x-fixture-request-id header. Applied after startServer resolves so
// the fixture's existing writeHead/setHeader callers stay untouched.
export function attachRequestId(server) {
  const original = server.listeners('request')[0];
  if (!original) throw new Error('fixture server has no request listener to wrap');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    const reqId = req.headers['x-request-id'] || randomUUID();
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = function patched(statusCode, arg2, arg3) {
      let statusMessage = null;
      let headers = null;
      if (typeof arg2 === 'string') {
        statusMessage = arg2;
        headers = arg3 || {};
      } else {
        headers = arg2 || {};
      }
      if (Array.isArray(headers)) {
        headers = headers.slice();
        headers.push(['x-fixture-request-id', reqId]);
      } else {
        headers = { ...headers, 'x-fixture-request-id': reqId };
      }
      if (statusMessage !== null) return origWriteHead(statusCode, statusMessage, headers);
      return origWriteHead(statusCode, headers);
    };
    // Also set as an outgoing default so implicit-writeHead paths
    // (res.end without an explicit writeHead) carry the id.
    res.setHeader('x-fixture-request-id', reqId);
    original(req, res);
  });
}

// Starts the fixture and attaches the request-id patch. Returns
// { server, port, baseUrl, close }.
export async function startPatchedFixture({ startServer, port } = {}) {
  const resolvedPort = typeof port === 'number'
    ? port
    : Number(process.env.PROBE_PORT ?? DEFAULT_PORT);
  const started = await startServer({ port: resolvedPort });
  attachRequestId(started.server);
  return {
    server: started.server,
    port: started.port,
    baseUrl: `http://127.0.0.1:${started.port}`,
    close: () => new Promise((res) => started.server.close(() => res())),
  };
}

// Reads a distinctive slice of a response body: the first N chars
// (or bytes for non-text) so the report carries a body excerpt
// alongside the header id.
export function bodyExcerpt(text, max = 240) {
  if (text == null) return '';
  const s = typeof text === 'string' ? text : String(text);
  return s.length > max ? s.slice(0, max) + '...' : s;
}

// Records the positive-evidence shape on a probe result: the
// fixture-echoed request id, the response status, a body excerpt
// and the route. Attach as `evidence` on any pass result so 7d holds.
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
    }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}
