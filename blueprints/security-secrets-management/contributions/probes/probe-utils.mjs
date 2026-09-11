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
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/security-secrets-management');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/security-secrets-management');

export const DECLARED_ENV = Object.freeze([
  'SOPS_AGE_KEY_FILE',
  'RCF_SECRETS_SCRATCH_DIR',
  'PATH',
  'HOME',
]);

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
  const raw = aggregate(results);
  const aggregateVerdict = isSkipped(results) ? 'pass' : raw;
  const report = { slug: 'security-secrets-management', probeName, runAt: new Date().toISOString(), engine, results, aggregateVerdict, ...(extra ?? {}) };
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
        detail: 'no checks ran (probe returned null/empty results); positive-evidence rule 7d requires each probe to observe a property',
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

export async function createScratchAgeScope({ prefix = 'qa-e-secrets-' } = {}) {
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
