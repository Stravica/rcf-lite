// Anatomy + shape + probe-pack test for security-auth-keycloak
// (criterion e hardening, 2026-09-11).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertShape, classifyShape, loadShippedAcIds } from './_security-e-anatomy-shape.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'security-auth-keycloak');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak');
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

// Negative anatomy assertions. The shipped-AC gate must refuse a
// limitation whose opening id is fabricated, wears the wrong slug on
// a real bare AC, or trails garbage after the AC number.
test('security-auth-keycloak anatomy: helper refuses fabricated AC ids in limitation', () => {
  const opts = { shippedAcIds: SHIPPED_ACS };
  const unknown = classifyShape({ conformanceOnly: true, anchorAcId: null, limitation: 'AC-99999-1: fabricated bare id' }, opts);
  assert.equal(unknown.ok, false, 'unknown bare AC must be refused');
  const wrongSlug = classifyShape({ conformanceOnly: true, anchorAcId: null, limitation: 'wrong-slug-AC-11101-1: real bare id under a fake slug' }, opts);
  assert.equal(wrongSlug.ok, false, 'wrong-slug prefix on a real bare AC must be refused');
  const suffixed = classifyShape({ conformanceOnly: true, anchorAcId: null, limitation: 'security-auth-keycloak-AC-11101-1bogus: trailing garbage after the AC id' }, opts);
  assert.equal(suffixed.ok, false, 'trailing characters after the AC number must be refused');
});


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
