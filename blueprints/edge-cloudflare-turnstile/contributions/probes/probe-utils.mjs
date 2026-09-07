// Shared helpers for edge-cloudflare-turnstile probes.
//
// Runtime-dependency posture: probes drive the shipped pack fixture at
// packages/rcf-lite/test/fixtures/probe-pack-edge-cloudflare-turnstile so
// rcf-lite gains no new runtime dependency (Node's built-in http, url and
// crypto modules cover the fixture). Two probes are pure source-tree AST
// scans (secret-shape-scan, guard-shape-scan); two probes drive the live
// https://challenges.cloudflare.com/turnstile/v0/siteverify endpoint with
// the pinned Cloudflare public test keys documented at
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
// (siteverify-fixture, event-secrecy).

import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/probe-pack-edge-cloudflare-turnstile');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/edge-cloudflare-turnstile');

// Pinned Cloudflare Turnstile public test keys per
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/.
export const TEST_SITEKEYS = Object.freeze({
  alwaysPass: '1x00000000000000000000AA',
  alwaysBlock: '2x00000000000000000000AB',
  forcedInteractive: '3x00000000000000000000FF',
  invisiblePass: '1x00000000000000000000BB',
  invisibleBlock: '2x00000000000000000000BB',
});
export const TEST_SECRETS = Object.freeze({
  alwaysPass: '1x0000000000000000000000000000000AA',
  alwaysFail: '2x0000000000000000000000000000000AA',
  tokenSpent: '3x0000000000000000000000000000000AA',
});
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'edge-cloudflare-turnstile',
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

// Boot the pack fixture on a free port. Returns {url, stop}.
export async function bootFixture(env = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: FIXTURE_DIR,
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise((resolveP, rejectP) => {
    const timer = setTimeout(() => rejectP(new Error('fixture boot timeout')), 8000);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += String(d);
      const m = buf.match(/LISTENING (\d+)/);
      if (m) { clearTimeout(timer); resolveP(Number(m[1])); }
    });
    child.stderr.on('data', (d) => { buf += String(d); });
    child.on('exit', (code) => { clearTimeout(timer); rejectP(new Error(`fixture exited early code=${code}: ${buf}`)); });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolveP) => { child.once('exit', () => resolveP()); child.kill('SIGTERM'); }),
    child,
  };
}

export async function fixturePost(url, path, body) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) params.set(k, String(v));
  const resp = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave null */ }
  return { status: resp.status, json, text };
}

// Recursively walk a directory and return every file path with one of the given extensions.
export async function collectFiles(root, exts = ['.js', '.mjs', '.cjs', '.ts']) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'proof' || e.name === '.git') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
  }
  await walk(root);
  return out;
}

export async function readFileText(p) { return readFile(p, 'utf8'); }
