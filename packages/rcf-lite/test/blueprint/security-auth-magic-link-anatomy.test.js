// Anatomy + shape + probe-pack test for security-auth-magic-link
// (criterion e hardening, 2026-09-11).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertShape, loadShippedAcIds } from './_security-e-anatomy-shape.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'security-auth-magic-link');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-magic-link');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');

// Anatomy shape asserter. Delegates to the shared shape helper in
// _security-e-anatomy-shape.mjs. The helper enforces the four 7d
// shape combinations (request id + status + body, created-then-
// deleted inventory diff, deploy record, skip, conformanceOnly plus
// limitation) rather than a flat allow-list of keys, and refuses a
// conformanceOnly limitation whose AC id does not name a shipped
// acceptance criterion on this blueprint's user stories.
const SHIPPED_ACS = await loadShippedAcIds(BLUEPRINT_ROOT);
function assertEvidenceOrSkip(r, ctx = '') { assertShape(r, ctx, { shippedAcIds: SHIPPED_ACS }); }


test('security-auth-magic-link pack: expected probe files present', async () => {
  const required = [
    'probe-utils.mjs',
    'token-issue-verify.mjs', 'run-token-issue-verify.mjs',
    'token-entropy-shape.mjs', 'run-token-entropy-shape.mjs',
    'real-account-magic-link-send.mjs', 'run-real-account-magic-link-send.mjs',
  ];
  for (const name of required) assert.ok(existsSync(join(PROBES_DIR, name)), `missing: ${name}`);
});

test('security-auth-magic-link fixture README declares every env var read by the pack', async () => {
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const v of ['CI_HAS_RESEND_ACCOUNT', 'RESEND_API_KEY', 'RESEND_API_BASE_URL', 'RESEND_SANDBOX_FROM', 'RESEND_SANDBOX_TO']) {
    assert.ok(readme.includes(v), `fixture README must declare ${v}`);
  }
});

test('security-auth-magic-link token-issue-verify probe: aggregate pass', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'token-issue-verify.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'issue-verify'); }
});

test('security-auth-magic-link token-entropy-shape probe: aggregate pass', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'token-entropy-shape.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'entropy'); }
});

test('security-auth-magic-link real-account probe: honest skip without CI_HAS_RESEND_ACCOUNT', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-magic-link-send.mjs')).href)).default;
  const originalGate = process.env.CI_HAS_RESEND_ACCOUNT;
  delete process.env.CI_HAS_RESEND_ACCOUNT;
  try {
    const { results, extra } = await runProbe();
    const r = results.find((x) => x.accountBoundSkipped === true && x.reason === 'CI_HAS_RESEND_ACCOUNT');
    assert.ok(r, 'probe must emit an accountBoundSkipped result on CI_HAS_RESEND_ACCOUNT');
    assert.equal(r.verdict, 'pass');
    assert.equal(r.accountBoundSkipped, true);
    assert.equal(r.reason, 'CI_HAS_RESEND_ACCOUNT');
    assert.equal(extra && extra.accountBoundSkipped, true);
  } finally {
    if (originalGate !== undefined) process.env.CI_HAS_RESEND_ACCOUNT = originalGate;
  }
});

test('security-auth-magic-link blueprint.json: version bumped and updatedAt refreshed', async () => {
  const manifest = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.match(manifest.version, /^1\.2\./);
  assert.ok(manifest.updatedAt, 'blueprint.json must carry an updatedAt');
});
