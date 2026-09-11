// Shared helpers for application-onboarding-tour contributions/probes/.
//
// The real engine for every probe in this pack is the fixture HTTP
// server at packages/rcf-lite/test/fixtures/probe-pack-application-onboarding-tour/server.js
// booted on a scratch port from the family range 47610-47619.
// The fixture echoes a per-request x-fixture-request-id header on
// every response; probes record that id and a response body excerpt
// as positive evidence per rule 7d.
//
// No account credentials or network calls: every probe is
// local-fixture-driven, so no probe carries an account-bound branch
// or a CI_HAS_* gate. Declared env vars are the fixture's own
// PORT and (where the fixture reads them) the CAPS/state switches
// the probes drive via query string.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const SLUG = 'application-onboarding-tour';
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/probe-pack-application-onboarding-tour');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/application-onboarding-tour');
export const PORT_RANGE_START = 47610;
export const PORT_RANGE_END = 47619;
export const DECLARED_ENV = Object.freeze(['PORT', 'TOUR_APPS', 'TOUR_STORE', 'TOUR_ANCHOR']);
export const REQUEST_ID_HEADER = 'x-fixture-request-id';

// Pick a free port from the fixture family range. Falls back to
// asking the OS for an ephemeral port only if the whole range is
// held by other workers (never expected on a single-machine run).
export async function pickPort() {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port += 1) {
    if (await canBind(port)) return port;
  }
  return await bindEphemeral();
}

function canBind(port) {
  return new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.listen(port, '127.0.0.1', () => {
      const bound = s.address();
      s.close(() => res(!!bound));
    });
  });
}

function bindEphemeral() {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => res(port));
    });
  });
}

// Spawns the fixture server as a child on `port` with the given
// env overlay; resolves once the fixture has printed LISTENING and
// returns { child, url, kill } (kill is synchronous best-effort).
export async function startFixture({ port, env = {} } = {}) {
  const boundPort = port ?? await pickPort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: FIXTURE_DIR,
    env: { ...process.env, PORT: String(boundPort), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`fixture did not print LISTENING within 4s on port ${boundPort}`)), 4000);
    let stderrBuf = '';
    child.stderr.on('data', (chunk) => { stderrBuf += String(chunk); });
    child.on('exit', (code) => rej(new Error(`fixture exited early (code=${code}) stderr=${stderrBuf.slice(0, 400)}`)));
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`LISTENING ${boundPort}`)) { clearTimeout(timer); res(); }
    });
  });
  const url = new URL(`http://127.0.0.1:${boundPort}`);
  return {
    child,
    url,
    port: boundPort,
    // Await child exit and propagate any error. A teardown failure
    // must fail the verdict (master brief addendum 2026-09-11 §5);
    // no swallowed errors here.
    kill: () => new Promise((res, rej) => {
      let settled = false;
      const done = (err) => { if (settled) return; settled = true; err ? rej(err) : res(); };
      child.once('exit', () => done());
      child.once('error', (err) => done(err));
      try { child.kill('SIGTERM'); } catch (err) { return done(err); }
      setTimeout(() => {
        if (settled) return;
        try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
      }, 4000);
    }),
  };
}

// Issue an HTTP request against the fixture and return
// { status, headers, body, requestId }.
export async function fixtureFetch(url, pathAndQuery, init = {}) {
  const target = new URL(pathAndQuery, url);
  const res = await fetch(target, init);
  const body = await res.text();
  const requestId = res.headers.get(REQUEST_ID_HEADER);
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body, requestId };
}

export function excerpt(body, maxLen = 240) {
  if (typeof body !== 'string') return '';
  return body.length <= maxLen ? body : body.slice(0, maxLen) + '…';
}

export function aggregate(results) {
  // Master brief addendum 2026-09-11 §3: no-checks-ran is a fail.
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: SLUG,
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
    aggregateVerdict: aggregate(results),
    ...(extra ?? {}),
  };
  const filepath = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(filepath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { report, path: filepath };
}

export async function runShim(probeName, engine, mainFn) {
  try {
    const outcome = (await mainFn()) ?? { results: [] };
    const { results, extra } = outcome;
    const { report, path: filepath } = await writeReport({ probeName, engine, results, extra });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`report written to ${filepath}\n`);
    if (report.aggregateVerdict === 'fail') process.exitCode = 1;
  } catch (err) {
    // Master brief addendum 2026-09-11 §3: exception rows have no
    // observed AC; anchor null (never a fabricated id like
    // "unknown"), carry an evidence object with the error excerpt.
    const message = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? err.stack : String(err);
    const results = [{
      anchorAcId: null,
      verdict: 'fail',
      detail: `probe threw: ${message}`,
      evidence: {
        errorMessage: message,
        errorExcerpt: excerpt(stack, 480),
      },
    }];
    const { report, path: filepath } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${stack}\n`);
    process.stderr.write(`report written to ${filepath}\n`);
    process.exitCode = 1;
  }
}
