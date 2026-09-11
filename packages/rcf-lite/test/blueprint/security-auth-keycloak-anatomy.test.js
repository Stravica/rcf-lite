// Anatomy + shape + probe-pack test for security-auth-keycloak
// (criterion e hardening, 2026-09-11).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'security-auth-keycloak');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');

// Rule 7d evidence-shape asserter (closure addendum rule 6): every
// result row carries either an `evidence` object (one of the four
// 7d shapes) or `accountBoundSkipped: true` with a non-empty
// `reason`. verdict alone never satisfies rule 7d.
function assertEvidenceOrSkip(r, ctx = '') {
  if (r.accountBoundSkipped === true) {
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, `${ctx} accountBoundSkipped requires a non-empty reason on ${r.anchorAcId}`);
    return;
  }
  assert.ok(r.evidence && typeof r.evidence === 'object', `${ctx} result must carry evidence object on ${r.anchorAcId}: ${r.detail}`);
}

test('security-auth-keycloak pack: expected probe files present', async () => {
  const required = [
    'probe-utils.mjs',
    'discovery-shape.mjs', 'run-discovery-shape.mjs',
    'jwt-verifier-shape.mjs', 'run-jwt-verifier-shape.mjs',
    'introspection-shape.mjs', 'run-introspection-shape.mjs',
    'role-adapter-shape.mjs', 'run-role-adapter-shape.mjs',
    'real-account-realm-round-trip.mjs', 'run-real-account-realm-round-trip.mjs',
  ];
  for (const name of required) assert.ok(existsSync(join(PROBES_DIR, name)), `missing: ${name}`);
});

test('security-auth-keycloak fixture README declares every env var read by the pack', async () => {
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const v of ['CI_HAS_KEYCLOAK_ACCOUNT', 'KEYCLOAK_BASE_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_ADMIN_CLIENT_ID', 'KEYCLOAK_ADMIN_CLIENT_SECRET', 'KEYCLOAK_INTROSPECTION_TOKEN']) {
    assert.ok(readme.includes(v), `fixture README must declare ${v}`);
  }
});

for (const probe of ['discovery-shape', 'jwt-verifier-shape', 'introspection-shape', 'role-adapter-shape']) {
  test(`security-auth-keycloak ${probe} probe: aggregate pass`, async () => {
    const runProbe = (await import(pathToFileURL(join(PROBES_DIR, `${probe}.mjs`)).href)).default;
    const { results } = await runProbe();
      assert.ok(results.length > 0, 'no checks ran');
    for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, probe); }
  });
}

test('security-auth-keycloak real-account probe: honest skip without CI_HAS_KEYCLOAK_ACCOUNT', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-realm-round-trip.mjs')).href)).default;
  const originalGate = process.env.CI_HAS_KEYCLOAK_ACCOUNT;
  delete process.env.CI_HAS_KEYCLOAK_ACCOUNT;
  try {
    const { results, extra } = await runProbe();
    const r = results.find((x) => x.anchorAcId === 'security-auth-keycloak-AC-11112-2');
    assert.ok(r);
    assert.equal(r.verdict, 'pass');
    assert.equal(r.accountBoundSkipped, true);
    assert.equal(r.reason, 'CI_HAS_KEYCLOAK_ACCOUNT');
    assert.equal(extra && extra.accountBoundSkipped, true);
  } finally {
    if (originalGate !== undefined) process.env.CI_HAS_KEYCLOAK_ACCOUNT = originalGate;
  }
});

test('security-auth-keycloak blueprint.json: version bumped and updatedAt refreshed', async () => {
  const manifest = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.match(manifest.version, /^1\.4\./, `expected 1.4.x; observed ${manifest.version}`);
  assert.ok(manifest.updatedAt, 'blueprint.json must carry an updatedAt');
});
