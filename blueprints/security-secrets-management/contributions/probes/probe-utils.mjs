// Shared helpers for security-secrets-management probes.
//
// Engine posture: sops (v3.x) + age (v1.x) are real, in-process
// engines on the developer machine. Every probe runs against a
// throwaway age recipient the probe itself generates in a scratch
// directory under the operator's scratchpad, encrypts a scratch
// scope file, and cleans up on completion. The estate's canonical
// vault (repo-root .vault/) is NEVER touched.
//
// SOPS metadata (lastmodified, mac, unencrypted_suffix, and the
// recipients array under sops.age[]) is inspected as positive
// evidence per rule 7d shape 2 (response-body excerpt): a before/
// after MAC divergence proves the encrypt/decrypt cycle mutated
// the file; a recipient added to sops.age[] proves the rotation
// verb succeeded.

import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const SLUG = 'security-secrets-management';
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/security-secrets-management');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/security-secrets-management');

export const DECLARED_ENV = Object.freeze([
  'SOPS_AGE_KEY_FILE',
  'RCF_SECRETS_SCRATCH_DIR',
  'PATH',
  'HOME',
]);

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
  const report = { slug: 'security-secrets-management', probeName, runAt: new Date().toISOString(), engine, results: prefixedResults, aggregateVerdict, ...(extra ?? {}) };
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
    const results = [{ anchorAcId: 'unknown', verdict: 'fail', detail: `probe threw: ${err && err.message ? err.message : String(err)}` }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}

// Creates a scratch working dir under RCF_SECRETS_SCRATCH_DIR (or
// the OS tmpdir), generates a fresh throwaway age keypair inside
// it and writes the key to a file the caller can point sops at.
// Returns { dir, keyPath, recipient } and a cleanup function.
import { execFileSync } from 'node:child_process';

// De-claim helper. When the shipped AC does not observe what the probe observes, the row keeps its
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

export async function createScratchAgeScope({ prefix = 'pxe-secrets-' } = {}) {
  const base = process.env.RCF_SECRETS_SCRATCH_DIR || tmpdir();
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, prefix));
  const keyPath = join(dir, 'age-key.txt');
  // age-keygen -o <path> writes both public and private key.
  execFileSync('age-keygen', ['-o', keyPath], { stdio: 'pipe' });
  // Read the public key line: `# public key: age1...`
  const keyText = execFileSync('cat', [keyPath], { encoding: 'utf8' });
  const m = keyText.match(/# public key:\s*(age1[a-z0-9]+)/i);
  if (!m) throw new Error('age-keygen output missing public key comment');
  const recipient = m[1];
  return {
    dir, keyPath, recipient,
    async cleanup() { await rm(dir, { recursive: true, force: true }); },
  };
}
