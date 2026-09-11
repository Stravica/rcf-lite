// Anatomy + shape + probe-pack test for the security-auth-clerk
// blueprint (criterion e hardening, 2026-09-11). Pins the probe
// pack shape, the fixture env-var manifest, the local-probe
// aggregateVerdict on the fixture-driven paths, and the account-
// bound skip shape on the live probe when CI_HAS_CLERK_ACCOUNT is
// unset.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'security-auth-clerk');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-clerk');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');

test('security-auth-clerk pack: expected probe files present', async () => {
  const required = [
    'probe-utils.mjs',
    'role-model-adapter.mjs',
    'run-role-model-adapter.mjs',
    'hosted-identity-ui-config.mjs',
    'run-hosted-identity-ui-config.mjs',
    'real-account-principal-directory-round-trip.mjs',
    'run-real-account-principal-directory-round-trip.mjs',
    'real-account-session-inventory.mjs',
    'run-real-account-session-inventory.mjs',
  ];
  for (const name of required) {
    assert.ok(existsSync(join(PROBES_DIR, name)), `missing probe pack file: ${name}`);
  }
});

test('security-auth-clerk fixture README declares every env var read by the pack', async () => {
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const v of ['CI_HAS_CLERK_ACCOUNT', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_API_BASE_URL', 'GITHUB_RUN_ID']) {
    assert.ok(readme.includes(v), `fixture README must declare ${v}`);
  }
  // Every var read by the probes must appear in DECLARED_ENV export.
  const utils = await readFile(join(PROBES_DIR, 'probe-utils.mjs'), 'utf8');
  for (const v of ['CI_HAS_CLERK_ACCOUNT', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_API_BASE_URL', 'GITHUB_RUN_ID']) {
    assert.ok(utils.includes(`'${v}'`), `probe-utils DECLARED_ENV must include ${v}`);
  }
});

test('security-auth-clerk role-model-adapter probe: aggregate pass on fixture', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'role-model-adapter.mjs')).href)).default;
  const { results } = await runProbe();
  const kinds = new Set(results.map((r) => r.anchorAcId));
  assert.ok(kinds.has('security-auth-clerk-AC-9102-1'), 'happy-path result missing');
  assert.ok(kinds.has('security-auth-clerk-AC-9102-2'), 'unknown-role refusal result missing');
  assert.ok(kinds.has('security-auth-clerk-AC-9102-3'), 'non-array refusal result missing');
  for (const r of results) assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`);
});

test('security-auth-clerk hosted-identity-ui-config probe: aggregate pass on fixture', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'hosted-identity-ui-config.mjs')).href)).default;
  const { results } = await runProbe();
  for (const r of results) assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`);
});

test('security-auth-clerk real-account principal-directory probe: honest skip without CI_HAS_CLERK_ACCOUNT', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-principal-directory-round-trip.mjs')).href)).default;
  const originalGate = process.env.CI_HAS_CLERK_ACCOUNT;
  delete process.env.CI_HAS_CLERK_ACCOUNT;
  try {
    const { results, extra } = await runProbe();
    const r = results.find((x) => x.anchorAcId === 'security-auth-clerk-AC-9101-1');
    assert.ok(r, 'probe must emit an AC-9101-1 result');
    assert.equal(r.verdict, 'pass');
    assert.equal(r.accountBoundSkipped, true);
    assert.equal(r.reason, 'CI_HAS_CLERK_ACCOUNT');
    assert.equal(extra && extra.accountBoundSkipped, true);
  } finally {
    if (originalGate !== undefined) process.env.CI_HAS_CLERK_ACCOUNT = originalGate;
  }
});

test('security-auth-clerk real-account session-inventory probe: honest skip without CI_HAS_CLERK_ACCOUNT', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-session-inventory.mjs')).href)).default;
  const originalGate = process.env.CI_HAS_CLERK_ACCOUNT;
  delete process.env.CI_HAS_CLERK_ACCOUNT;
  try {
    const { results, extra } = await runProbe();
    const r = results.find((x) => x.anchorAcId === 'security-auth-clerk-AC-9103-1');
    assert.ok(r, 'probe must emit an AC-9103-1 result');
    assert.equal(r.verdict, 'pass');
    assert.equal(r.accountBoundSkipped, true);
    assert.equal(r.reason, 'CI_HAS_CLERK_ACCOUNT');
    assert.equal(extra && extra.accountBoundSkipped, true);
  } finally {
    if (originalGate !== undefined) process.env.CI_HAS_CLERK_ACCOUNT = originalGate;
  }
});

test('security-auth-clerk blueprint.json: version bumped and updatedAt refreshed', async () => {
  const manifest = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.match(manifest.version, /^1\.5\./, `version prefix expected 1.5.x for the criterion-e bump; observed ${manifest.version}`);
  assert.ok(manifest.updatedAt, 'blueprint.json must carry an updatedAt');
});
