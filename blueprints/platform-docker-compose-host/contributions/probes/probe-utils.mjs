// Shared helpers for platform-docker-compose-host probes (v1.1.4,
// criterion e closure fix pass, 2026-09-11).
//
// Every result row a probe returns MUST carry either an `evidence`
// object naming the observed artefact (compose service list, on-server
// response body excerpt, burst counters, event body sample) OR
// `accountBoundSkipped: true` with a `reason` field naming exactly
// one unset variable (Addendum rule 3). Empty or null probe outcomes
// FAIL with detail exactly `no checks ran`.
//
// Runtime-dependency posture:
// - compose-config-lint shells to docker compose config against the applied
//   fixture compose.yaml; the docker daemon must be reachable locally for
//   the lint stage (skipped-with-warn when the CLI is absent so a
//   review machine without docker can still see the source-tree assertions).
// - secrets-as-files-scan runs in-process against the fixture; no external
//   engine required. Scans compose.yaml, .env, every service config
//   under caddy/, secrets/ metadata and the compose secret-shape.
// - caddyfile-validate shells to caddy validate. When a local caddy binary
//   is not on PATH the probe runs the vendor container caddy:2 via docker
//   run --rm; when docker is also absent it skips-with-warn. The probe
//   also asserts the compose file bind-mounts the Caddyfile read-only.
// - real-account-* probes call the fixture's provision.mjs, drive docker
//   compose over ssh against the throwaway server, and tear down in
//   always(). Without CI_HAS_HETZNER_ACCOUNT set to exactly the string
//   "true" the probe records accountBoundSkipped: true and a reason
//   naming CI_HAS_HETZNER_ACCOUNT (set-but-not-true reported as such,
//   distinguished from unset). A second-tier HCLOUD_TOKEN unset once
//   past the first-tier gate has its own honest skip row.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(
  PROJECT_ROOT,
  'packages/rcf-lite/test/fixtures/hetzner-throwaway-server',
);
export const COMPOSE_PATH = resolve(FIXTURE_DIR, 'compose.yaml');
export const CADDYFILE_PATH = resolve(FIXTURE_DIR, 'caddy/Caddyfile');
export const SECRET_PATH = resolve(FIXTURE_DIR, 'secrets/web-token');
export const ENV_PATH = resolve(FIXTURE_DIR, '.env');
export const REPORT_DIR = process.env.RCF_REPORT_DIR_OVERRIDE
  ? resolve(process.env.RCF_REPORT_DIR_OVERRIDE, 'blueprints/platform-docker-compose-host')
  : resolve(PROJECT_ROOT, '.rcf/reports/blueprints/platform-docker-compose-host');

export function aggregate(results) {
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

// An empty results array is an honest failure of the probe: no anchor
// can be manufactured. Callers that KNOW the anchor may pass it in;
// otherwise the row carries anchorAcId: null so downstream tallies do
// not see an invented AC id.
export function emptyResultsFail(anchorAcId = null) {
  return {
    anchorAcId: anchorAcId ?? null,
    verdict: 'fail',
    detail: 'no checks ran',
    evidence: { reason: 'the probe returned zero result rows', probeName: '(unknown at empty-fail construction)' },
  };
}

export function isSkipped(results) {
  return Array.isArray(results) && results.length > 0 && results.every((r) => r.accountBoundSkipped === true);
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const rows = Array.isArray(results) && results.length > 0 ? results : [emptyResultsFail()];
  // Addendum 2 rule 10: every row's detail starts with the first eight
  // words of the anchored AC text. The prepend is idempotent so a
  // caller that already wrapped its detail via `anchored()` does not
  // double up.
  for (const r of rows) {
    const prefix = r && r.anchorAcId && AC_ANCHOR_PREFIX[r.anchorAcId];
    if (prefix && typeof r.detail === 'string' && !r.detail.startsWith(prefix)) {
      r.detail = `${prefix}. ${r.detail}`;
    }
  }
  const rawVerdict = aggregate(rows);
  const aggregateVerdict = isSkipped(rows) ? 'pass' : rawVerdict;
  const report = {
    slug: 'platform-docker-compose-host',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results: rows,
    aggregateVerdict,
    ...(extra ?? {}),
  };
  const path = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { report, path };
}

export async function runShim(probeName, engine, mainFn) {
  try {
    const outcome = await mainFn();
    const results = (outcome && Array.isArray(outcome.results)) ? outcome.results : null;
    const extra = outcome && outcome.extra;
    const rows = results && results.length > 0 ? results : [emptyResultsFail()];
    const { report, path } = await writeReport({ probeName, engine, results: rows, extra });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`report written to ${path}\n`);
    if (report.aggregateVerdict === 'fail') process.exitCode = 1;
  } catch (err) {
    // A probe that throws has no known anchor at this layer; use null
    // rather than the invented "unknown" fallback (reclosure BLOCKER).
    const results = [{
      anchorAcId: null,
      verdict: 'fail',
      detail: `probe threw: ${err && err.message ? err.message : String(err)}`,
      evidence: {
        probeName,
        errorMessage: err && err.message ? err.message : String(err),
        errorStack: (err && err.stack ? err.stack : String(err)).slice(0, 800),
      },
    }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}

// Skip helper (Addendum rule 4): the reason field names exactly one
// unset variable; the gateState field distinguishes unset from
// set-but-not-true, so a variable set to `false` is never reported as
// unset. Callers hand the anchor plus a short note.
export function firstTierGateSkipResult(anchorAcId, varName = 'CI_HAS_HETZNER_ACCOUNT', note = '') {
  const observed = process.env[varName];
  const state = observed === undefined
    ? `unset`
    : `set-but-not-true (observed value ${JSON.stringify(observed)})`;
  return {
    anchorAcId,
    verdict: 'skipped',
    accountBoundSkipped: true,
    reason: varName,
    gateState: state,
    detail: `accountBoundSkipped: gate variable ${varName} ${state}; ${note || 'run with CI_HAS_HETZNER_ACCOUNT=true to exercise the account-bound branch.'}`,
  };
}

// Second-tier skip helper (Addendum rule 4): the account-bound branch
// requires HCLOUD_TOKEN once the first-tier gate is true. When only the
// second-tier is missing the skip row names HCLOUD_TOKEN literally and
// still aggregates to pass; missing configuration is a skip, not a
// failure.
export function secondTierMissingSkipResult(anchorAcId, varName, note = '') {
  return {
    anchorAcId,
    verdict: 'skipped',
    accountBoundSkipped: true,
    reason: varName,
    gateState: 'unset',
    detail: `accountBoundSkipped: second-tier variable ${varName} unset while CI_HAS_HETZNER_ACCOUNT=true; ${note || 'the probe cannot open the vendor client.'}`,
  };
}

export function accountBoundSkippedResult(anchorAcId, note) {
  return firstTierGateSkipResult(anchorAcId, 'CI_HAS_HETZNER_ACCOUNT', note);
}

// Small YAML subset parser tuned for the fixture compose.yaml shape.
export function parseComposeYaml(text) {
  const doc = {};
  const lines = text.split(/\r?\n/);
  const stack = [{ indent: -1, node: doc }];
  const inlineListRe = /^\[(.*)\]$/;
  function decodeScalar(raw) {
    if (raw === '' || raw === undefined) return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null' || raw === '~') return null;
    const m = raw.match(inlineListRe);
    if (m) return m[1].split(',').map((s) => decodeScalar(s.trim()));
    return raw.replace(/^"([^"\\]*)"$/, '$1').replace(/^'([^'\\]*)'$/, '$1');
  }
  for (let raw of lines) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const indentMatch = raw.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const body = raw.slice(indent);
    if (body.startsWith('- ')) {
      const rest = body.slice(2);
      const kv = rest.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (kv) {
        const [, key, val] = kv;
        const obj = {};
        if (val === '') {
          const child = {};
          obj[key] = child;
          parent.push(obj);
          stack.push({ indent, node: child });
        } else {
          obj[key] = decodeScalar(val.trim());
          parent.push(obj);
        }
      } else {
        parent.push(decodeScalar(rest.trim()));
      }
      continue;
    }
    const kv = body.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val === '') {
      let peekIsList = false;
      for (let j = lines.indexOf(raw) + 1; j < lines.length; j++) {
        const nxt = lines[j];
        if (!nxt || nxt.trim() === '' || nxt.trim().startsWith('#')) continue;
        const nxtIndentMatch = nxt.match(/^(\s*)/);
        const nxtIndent = nxtIndentMatch ? nxtIndentMatch[1].length : 0;
        if (nxtIndent <= indent) break;
        peekIsList = nxt.slice(nxtIndent).startsWith('- ');
        break;
      }
      const child = peekIsList ? [] : {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else if (val.trim().match(inlineListRe)) {
      parent[key] = decodeScalar(val.trim());
    } else {
      parent[key] = decodeScalar(val.trim());
    }
  }
  return doc;
}

export async function readCompose() {
  const text = await readFile(COMPOSE_PATH, 'utf8');
  const doc = parseComposeYaml(text);
  return { text, doc };
}

export function whichDocker() {
  const r = spawnSync('docker', ['version', '--format', '{{.Client.Version}}'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

export function whichCaddy() {
  const r = spawnSync('caddy', ['version'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

// Addendum 2 rule 10: every result row's detail starts with the first
// eight words of the anchored AC text. This map holds those prefixes
// for the platform-docker-compose-host ACs; callers wrap their detail
// via `anchored(anchorAcId, detail)`.
export const AC_ANCHOR_PREFIX = {
  'AC-composeHost-upClean': 'The real-account-minimal-stack-up probe, when CI_HAS_HETZNER_ACCOUNT is set, scps',
  'AC-composeHost-zeroDowntimeReload': 'The real-account-reload-burst probe, when CI_HAS_HETZNER_ACCOUNT is set, runs',
  'AC-composeHost-healthcheckLint': 'The compose-config-lint probe shells to docker compose config',
  'AC-composeHost-restartClassification': 'The compose-config-lint probe asserts every service in the',
  'AC-composeHost-logDriverClassification': 'Every service in the applied compose.yaml declares a',
  'AC-composeHost-reverseProxyArtefactValid': 'The applied fixture ships caddy/Caddyfile under a caddy/',
  'AC-composeHost-secretsAreFiles': 'The secrets-as-files-scan probe walks compose.yaml plus every referenced',
  'AC-composeHost-secretShape': 'The applied compose.yaml declares at least one secret',
  'AC-38107-4': 'Read-only bind-mount: the reverse-proxy config bind-mount in compose.yaml',
};

export function anchored(anchorAcId, body) {
  const prefix = AC_ANCHOR_PREFIX[anchorAcId];
  return prefix ? `${prefix}. ${body}` : body;
}
