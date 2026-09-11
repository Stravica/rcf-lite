// Shared helpers for security-auth-clerk probes.
//
// Runtime-dependency posture:
// - Local probes drive shipped-shape checks against the fixture at
//   packages/rcf-lite/test/fixtures/security-auth-clerk/ without
//   contacting Clerk.
// - real-account-* probes call the Clerk Backend API (base URL
//   https://api.clerk.com/v1, docs verifiedOn 2026-09-11
//   https://clerk.com/docs/reference/backend-api) via fetch. The
//   probe records real request ids (Clerk stamps X-Request-ID and
//   returns object ids like user_..., ses_...) and cleans up the
//   scratch principal in a finally block. Without
//   CI_HAS_CLERK_ACCOUNT the probe records accountBoundSkipped: true
//   naming the missing var per rule 7d.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const SLUG = 'security-auth-clerk';
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/security-auth-clerk');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/security-auth-clerk');

// Declared env vars (mirror the fixture README table).
export const DECLARED_ENV = Object.freeze([
  'CI_HAS_CLERK_ACCOUNT',
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_API_BASE_URL',
  'GITHUB_RUN_ID',
]);

export const SCRATCH_PRINCIPAL_PREFIX = 'pxe-clerk-';

// First-8-words-of-anchor helper. Each result row's `detail` starts
// with the first eight words of the anchored AC's or REQ's
// description text. Anchor lookup walks contributions/user-stories/
// and contributions/requirements/ under the blueprint root and
// caches the map on first call. Null / unknown / missing anchors
// yield an empty prefix.
import { readFileSync as _rf } from 'node:fs';
import { readdirSync as _rd } from 'node:fs';
let _anchorMap = null;
function _loadAnchorMap() {
  const map = new Map();
  const dirs = [
    { dir: resolve(PROJECT_ROOT, 'blueprints', SLUG, 'contributions', 'user-stories'), kind: 'ac' },
    { dir: resolve(PROJECT_ROOT, 'blueprints', SLUG, 'contributions', 'requirements'), kind: 'req' },
  ];
  for (const { dir, kind } of dirs) {
    let entries;
    try { entries = _rd(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      let j;
      try { j = JSON.parse(_rf(resolve(dir, name), 'utf8')); } catch { continue; }
      if (kind === 'ac') {
        const usId = j.usId;
        for (const ac of (j.acceptanceCriteria || [])) {
          // AC id in the shipped JSON is like "AC-9101-1"; the
          // anchor form used by probes is "<slug>-AC-9101-1".
          const key = `${SLUG}-${ac.id}`;
          map.set(key, ac.description || '');
        }
      } else {
        const key = j.reqId; // already "<slug>-REQ-###"
        if (key) map.set(key, j.description || j.title || '');
      }
    }
  }
  return map;
}
export function first8Words(anchor) {
  if (!anchor) return '';
  if (!_anchorMap) _anchorMap = _loadAnchorMap();
  const txt = _anchorMap.get(anchor) || '';
  if (!txt) return '';
  const words = txt.split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  return words;
}
export function withAnchorPrefix(row) {
  const prefix = first8Words(row.anchorAcId);
  if (!prefix) return row;
  const already = typeof row.detail === 'string' && row.detail.startsWith(prefix);
  if (already) return row;
  const oldDetail = row.detail || '';
  return { ...row, detail: `${prefix} :: ${oldDetail}` };
}

export function aggregate(results) {
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export function isSkipped(results) {
  return results.length > 0 && results.every((r) => r.accountBoundSkipped === true);
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  // Prefix every row's detail with the first eight words of its
  // anchored AC or REQ description; unanchored rows are left alone.
  const prefixedResults = (results || []).map(withAnchorPrefix);
  const raw = aggregate(prefixedResults);
  const aggregateVerdict = isSkipped(prefixedResults) ? 'pass' : raw;
  const report = {
    slug: 'security-auth-clerk',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results: prefixedResults,
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
    if (!outcome || !Array.isArray(outcome.results) || outcome.results.length === 0) {
      const results = [{
        anchorAcId: 'unknown',
        verdict: 'fail',
        detail: 'no checks ran',
      }];
      const { report, path } = await writeReport({ probeName, engine, results });
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      process.stderr.write(`no-checks-ran fail written to ${path}\n`);
      process.exitCode = 1;
      return;
    }
    const { results, extra } = outcome;
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

// De-claim helper. When the third closure disputed an anchor, the row keeps its
// verdict, evidence and engine as they are, but the anchor drops to null and the
// row carries conformanceOnly:true plus a limitation string naming the AC that
// this probe does NOT observe and why. The integration-harness follow-up (the auth integration harness follow-up)
// is the surface where those AC-level properties become observable.
export function deClaim(row, { ac, limitation }) {
  const acId = ac || 'unknown-AC';
  const limText = (limitation || '').trim();
  const finalLim = /^(security-[a-z0-9-]+-)?(AC|REQ)-/.test(limText) ? limText : (limText ? `${acId}: ${limText}` : `${acId}: not observable at this probe surface; needs the integration harness (the auth integration harness follow-up)`);
  const out = { ...row };
  out.anchorAcId = null;
  if ('anchorReqId' in out) delete out.anchorReqId;
  out.conformanceOnly = true;
  out.limitation = finalLim;
  const tag = ` :: conformance-only (${finalLim})`;
  if (typeof out.detail === 'string' && !out.detail.includes('conformance-only')) {
    out.detail = out.detail + tag;
  }
  return out;
}

export function accountBoundSkippedResult(anchorAcId, capability, reason) {
  return {
    anchorAcId,
    capability,
    verdict: 'pass',
    accountBoundSkipped: true,
    reason,
    detail: `accountBoundSkipped: ${reason} unset; probe did not execute against a real Clerk account. Set the missing var and re-run.`,
  };
}
