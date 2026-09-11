// Shared helpers for deploy-hetzner-server probes (v1.1.4, criterion e
// v1.1.5, 2026-09-11).
//
// Every result row a probe returns MUST carry either an `evidence`
// object naming the observed artefact (server id, inventory-diff,
// response body excerpt, deploy record) OR `accountBoundSkipped: true`
// with a `reason` field naming exactly one unset variable. Empty or
// null probe outcomes FAIL with detail exactly `no checks ran` per
// binding rule 3 of the criterion e .
//
// Runtime-dependency posture:
// - cloud-init-render-lint, manifest-schema-validate and
//   hcloud-dry-run-mock run in-process against the shared throwaway-
//   server fixture at packages/rcf-lite/test/fixtures/hetzner-throwaway-
//   server/. No real API call fires; hcloud is mocked via
//   src/hcloud-mock.mjs so the shim never crosses the process boundary.
// - real-account-* probes call the fixture's provision.mjs / destroy.mjs
//   / snapshot verbs. Without CI_HAS_HETZNER_ACCOUNT set to exactly the
//   string "true", each probe records accountBoundSkipped: true and a
//   reason naming CI_HAS_HETZNER_ACCOUNT (set-but-not-true is reported
//   as such, distinguished from unset).

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(
  PROJECT_ROOT,
  'packages/rcf-lite/test/fixtures/hetzner-throwaway-server',
);
export const MANIFEST_DIR = process.env.RCF_FIXTURE_MANIFEST_DIR
  ? resolve(process.env.RCF_FIXTURE_MANIFEST_DIR)
  : resolve(FIXTURE_DIR, 'hetzner/servers');
export const SCHEMA_PATH = resolve(HERE, '..', 'schemas', 'hetzner-server.schema.json');
export const REPORT_DIR = process.env.RCF_REPORT_DIR_OVERRIDE
  ? resolve(process.env.RCF_REPORT_DIR_OVERRIDE, 'blueprints/deploy-hetzner-server')
  : resolve(PROJECT_ROOT, '.rcf/reports/blueprints/deploy-hetzner-server');

// Aggregation rule (the shape rule): an empty results array is never
// pass; it is a fail with detail `no checks ran`. Callers hand the
// empty case a synthesised fail row via `emptyResultsFail()` before
// aggregating so the report body itself carries the row.
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
  // the anchor-prefix rule: every row's detail starts with the first eight
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
    slug: 'deploy-hetzner-server',
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
    // rather than the invented "unknown" fallback (defect).
    // The runShim caller carries the probeName so evidence names it.
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

export async function readManifestFiles(dir = MANIFEST_DIR) {
  let entries;
  try {
    entries = (await readdir(dir))
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch (err) {
    return { present: false, entries: [], files: [], error: err.message };
  }
  const files = [];
  for (const name of entries) {
    const p = join(dir, name);
    const text = await readFile(p, 'utf8');
    files.push({ name, path: p, text });
  }
  return { present: entries.length > 0, entries, files };
}

// Skip helper (the shape rule): the reason field names exactly one
// unset variable. A gate variable set to a value other than 'true'
// is reported as `set-but-not-true` with the observed value, not as
// `unset`. Callers hand the exact variable name and a short note.
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

// Second-tier skip helper (the shape rule): the account-bound branch
// requires HCLOUD_TOKEN once the first-tier gate is true. When only the
// second-tier is missing, the skip row names HCLOUD_TOKEN in `reason`,
// carries accountBoundSkipped: true, and the aggregate still flips to
// pass. Missing configuration is a skip, not a failure.
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

// Legacy shim (kept during the update cutover for callers not yet
// updated). Prefer firstTierGateSkipResult / secondTierMissingSkipResult.
export function accountBoundSkippedResult(anchorAcId, note) {
  return firstTierGateSkipResult(anchorAcId, 'CI_HAS_HETZNER_ACCOUNT', note);
}

// the anchor-prefix rule: every result row's detail starts with the first
// eight words of the anchored AC text. This map holds those prefixes
// for the deploy-hetzner-server ACs and the shared AC-14501-1 chain
// artefact (used elsewhere in the estate); callers wrap their detail
// via `anchored(anchorAcId, detail)`.
export const AC_ANCHOR_PREFIX = {
  'AC-37101-1': 'On process boot the provisioner facade opens against',
  'AC-37102-1': 'manifest-schema-validate.mjs asserts every hetzner/servers/*.json under the shared throwaway-server',
  'AC-37103-1': 'The real-account-throwaway-server-provision probe (accountBound: true, skipped without CI_HAS_HETZNER_ACCOUNT)',
  'AC-37104-1': 'cloud-init-render-lint.mjs renders the template with the fixture manifest',
  'AC-37105-1': 'real-account-cloud-init-hardened.mjs (accountBound: true, skipped without CI_HAS_HETZNER_ACCOUNT) waits for',
  'AC-37106-1': 'manifest-schema-validate.mjs asserts every fixture manifest carries a firewallRules',
  'AC-37107-1': 'manifest-schema-validate.mjs asserts every fixture manifest carries snapshotCadence with',
  'AC-37108-1': 'real-account-snapshot-on-demand.mjs (accountBound: true, skipped without CI_HAS_HETZNER_ACCOUNT) fires the',
  'AC-37109-1': 'hcloud-dry-run-mock.mjs drives every lifecycle event through the facade',
  'AC-37109-3': 'Event fires once per lifecycle moment (repeat-run idempotency).',
};

export function anchored(anchorAcId, body) {
  const prefix = AC_ANCHOR_PREFIX[anchorAcId];
  return prefix ? `${prefix}. ${body}` : body;
}
