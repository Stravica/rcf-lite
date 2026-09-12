// Anatomy + shape + probe-pack test for security-secrets-management
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
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'security-secrets-management');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'security-secrets-management');
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
test('security-secrets-management anatomy: helper refuses fabricated AC ids in limitation', () => {
  const opts = { shippedAcIds: SHIPPED_ACS };
  const unknown = classifyShape({ conformanceOnly: true, anchorAcId: null, limitation: 'AC-99999-1: fabricated bare id' }, opts);
  assert.equal(unknown.ok, false, 'unknown bare AC must be refused');
  const wrongSlug = classifyShape({ conformanceOnly: true, anchorAcId: null, limitation: 'wrong-slug-AC-8102-1: real bare id under a fake slug' }, opts);
  assert.equal(wrongSlug.ok, false, 'wrong-slug prefix on a real bare AC must be refused');
  const suffixed = classifyShape({ conformanceOnly: true, anchorAcId: null, limitation: 'security-secrets-management-AC-8102-1bogus: trailing garbage after the AC id' }, opts);
  assert.equal(suffixed.ok, false, 'trailing characters after the AC number must be refused');
});


test('security-secrets-management pack: expected probe files present', async () => {
  const required = [
    'probe-utils.mjs',
    'encrypt-decrypt-round-trip.mjs', 'run-encrypt-decrypt-round-trip.mjs',
    'add-recipient-rotation.mjs', 'run-add-recipient-rotation.mjs',
    'key-rotation.mjs', 'run-key-rotation.mjs',
    'mismatched-key-refusal.mjs', 'run-mismatched-key-refusal.mjs',
  ];
  for (const name of required) assert.ok(existsSync(join(PROBES_DIR, name)), `missing: ${name}`);
});

test('security-secrets-management fixture README declares every env var read by the pack', async () => {
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const v of ['SOPS_AGE_KEY_FILE', 'RCF_SECRETS_SCRATCH_DIR']) {
    assert.ok(readme.includes(v), `fixture README must declare ${v}`);
  }
});

// Real-engine probes; anatomy asserts they run to completion with
// aggregate pass against the local sops+age engines. Each probe
// self-provisions and self-cleans a throwaway keypair. Hosts that
// lack the real age + sops binaries (a stock Ubuntu runner with no
// install step; a bare macOS box) route to an honest engine-absent
// skip row shaped `{ notObservableHere: { ac, reason } }` rather
// than throwing ENOENT. CI installs both binaries so the skip path
// is exercised only where the engine is truly absent.
const PROBE_UTILS = await import(pathToFileURL(join(PROBES_DIR, 'probe-utils.mjs')).href);
const ENGINE_SKIP_AC = 'security-secrets-management-AC-8102-1';
const ENGINE_SKIP_REASON = 'age or sops binary absent on this host';
for (const probe of ['encrypt-decrypt-round-trip', 'add-recipient-rotation', 'key-rotation', 'mismatched-key-refusal']) {
  test(`security-secrets-management ${probe} probe: aggregate pass on real sops+age engine`, async () => {
    const absent = PROBE_UTILS.engineAbsentReason();
    if (absent) {
      const skipRow = { notObservableHere: { ac: ENGINE_SKIP_AC, reason: absent } };
      assert.ok(skipRow.notObservableHere && typeof skipRow.notObservableHere === 'object', 'engine-absent skip must carry a notObservableHere object');
      assert.ok(typeof skipRow.notObservableHere.ac === 'string' && skipRow.notObservableHere.ac.length > 0, 'engine-absent skip must name an ac');
      assert.equal(skipRow.notObservableHere.reason, ENGINE_SKIP_REASON, 'engine-absent skip must carry the constant reason string');
      return;
    }
    const runProbe = (await import(pathToFileURL(join(PROBES_DIR, `${probe}.mjs`)).href)).default;
    const { results } = await runProbe();
    assert.ok(results.length > 0, 'no checks ran');
    for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, probe); }
  });
}

test('security-secrets-management blueprint.json: version bumped and updatedAt refreshed', async () => {
  const manifest = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(manifest.version, '1.1.5', `expected exact pin 1.1.5; observed ${manifest.version}`);
  assert.ok(manifest.updatedAt, 'blueprint.json must carry an updatedAt');
});
