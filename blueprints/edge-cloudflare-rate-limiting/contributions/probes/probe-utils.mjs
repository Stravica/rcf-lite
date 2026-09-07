// Shared helpers for edge-cloudflare-rate-limiting probes.
//
// Runtime-dependency posture: three probes read the cf-edge fixture
// manifest directory in-process (no network); one probe fires an
// undici burst against a scheduled real-account URL when
// CI_HAS_CLOUDFLARE_ACCOUNT and CF_RATE_LIMIT_URL are set, and
// records accountBoundSkipped: true otherwise per spec section 3.5
// and ruling 6. The drift-audit runner realisation lives in the
// fixture at src/drift-audit-runner.mjs.

import { mkdir, writeFile, readFile, readdir, rename, stat } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/cf-edge');
export const MANIFEST_DIR = resolve(FIXTURE_DIR, 'cloudflare/rate-limits');
export const SCHEMA_PATH = resolve(HERE, '..', 'schemas', 'rate-limit-rule.schema.json');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/edge-cloudflare-rate-limiting');

export const REQUIRED_FIELDS = Object.freeze([
  'id',
  'expression',
  'threshold',
  'period',
  'characteristics',
  'action',
  'duration',
]);

export const ACTION_ENUM = Object.freeze(['block', 'challenge', 'log', 'managed_challenge']);

export function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'edge-cloudflare-rate-limiting',
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

export async function readManifestFiles(dir = MANIFEST_DIR) {
  const missing = process.env.SIMULATE_MANIFEST_MISSING === 'true';
  let entries;
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    return { present: false, missing: [], entries: [], error: err.message };
  }
  const hidden = new Set();
  if (missing && entries.length > 0) {
    hidden.add(entries[0]);
  }
  const files = [];
  for (const name of entries) {
    if (hidden.has(name)) continue;
    const p = join(dir, name);
    const text = await readFile(p, 'utf8');
    files.push({ name, path: p, text });
  }
  return { present: entries.length > 0, entries, files, hiddenBySimulate: [...hidden] };
}

export function scanForPlaintextSecrets(text) {
  const hits = [];
  if (/[Bb]earer\s+[A-Za-z0-9._-]{20,}/.test(text)) hits.push('bearer-token-like');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) hits.push('pem-private-key');
  if (/"?CF_API_TOKEN"?\s*:\s*"[^"]{5,}"/.test(text)) hits.push('inline-cf-api-token');
  return hits;
}

export async function loadSchema() {
  const raw = await readFile(SCHEMA_PATH, 'utf8');
  return JSON.parse(raw);
}
