// Anatomy + shape + probe-pack test for the security-auth-oauth2
// blueprint (criterion e hardening, 2026-09-11).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertShape, classifyShape, loadShippedAcIds } from './_security-e-anatomy-shape.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'security-auth-oauth2');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2');
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
test('security-auth-oauth2 anatomy: helper refuses fabricated AC ids in limitation', () => {
  const opts = { shippedAcIds: SHIPPED_ACS };
  const unknown = classifyShape({ conformanceOnly: true, anchorAcId: null, limitation: 'AC-99999-1: fabricated bare id' }, opts);
  assert.equal(unknown.ok, false, 'unknown bare AC must be refused');
  const wrongSlug = classifyShape({ conformanceOnly: true, anchorAcId: null, limitation: 'wrong-slug-AC-10102-1: real bare id under a fake slug' }, opts);
  assert.equal(wrongSlug.ok, false, 'wrong-slug prefix on a real bare AC must be refused');
  const suffixed = classifyShape({ conformanceOnly: true, anchorAcId: null, limitation: 'security-auth-oauth2-AC-10102-1bogus: trailing garbage after the AC id' }, opts);
  assert.equal(suffixed.ok, false, 'trailing characters after the AC number must be refused');
});


test('security-auth-oauth2 pack: expected probe files present', async () => {
  const required = [
    'probe-utils.mjs',
    'pkce-challenge-shape.mjs', 'run-pkce-challenge-shape.mjs',
    'authorisation-code-flow-shape.mjs', 'run-authorisation-code-flow-shape.mjs',
    'provider-adapter-shape.mjs', 'run-provider-adapter-shape.mjs',
    'session-bridge-shape.mjs', 'run-session-bridge-shape.mjs',
    'real-account-authorisation-code-flow.mjs', 'run-real-account-authorisation-code-flow.mjs',
  ];
  for (const name of required) {
    assert.ok(existsSync(join(PROBES_DIR, name)), `missing probe pack file: ${name}`);
  }
});

test('security-auth-oauth2 fixture README declares every env var read by the pack', async () => {
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const v of ['CI_HAS_OAUTH2_PROVIDER', 'OAUTH2_ISSUER_URL', 'OAUTH2_CLIENT_ID', 'OAUTH2_CLIENT_SECRET', 'OAUTH2_REDIRECT_URI', 'OAUTH2_MOCK_PORT']) {
    assert.ok(readme.includes(v), `fixture README must declare ${v}`);
  }
});

test('security-auth-oauth2 pkce-challenge-shape probe: aggregate pass', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'pkce-challenge-shape.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'pkce'); }
});

test('security-auth-oauth2 provider-adapter-shape probe: aggregate pass', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'provider-adapter-shape.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'provider-adapter'); }
});

test('security-auth-oauth2 session-bridge-shape probe: aggregate pass', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'session-bridge-shape.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'session-bridge'); }
});

test('security-auth-oauth2 authorisation-code-flow-shape probe: aggregate pass on local mock', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'authorisation-code-flow-shape.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'flow'); }
});

test('security-auth-oauth2 real-account probe: honest skip without CI_HAS_OAUTH2_PROVIDER', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-authorisation-code-flow.mjs')).href)).default;
  const originalGate = process.env.CI_HAS_OAUTH2_PROVIDER;
  delete process.env.CI_HAS_OAUTH2_PROVIDER;
  try {
    const { results, extra } = await runProbe();
    const r = results.find((x) => x.anchorAcId === 'security-auth-oauth2-AC-10110-2');
    assert.ok(r, 'probe must emit an AC-10110-2 result');
    assert.equal(r.verdict, 'pass');
    assert.equal(r.accountBoundSkipped, true);
    assert.equal(r.reason, 'CI_HAS_OAUTH2_PROVIDER');
    assert.equal(extra && extra.accountBoundSkipped, true);
  } finally {
    if (originalGate !== undefined) process.env.CI_HAS_OAUTH2_PROVIDER = originalGate;
  }
});

test('security-auth-oauth2 blueprint.json: version bumped and updatedAt refreshed', async () => {
  const manifest = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.match(manifest.version, /^1\.3\./, `expected 1.3.x; observed ${manifest.version}`);
  assert.ok(manifest.updatedAt, 'blueprint.json must carry an updatedAt');
});
