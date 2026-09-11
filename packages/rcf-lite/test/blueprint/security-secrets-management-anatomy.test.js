// Anatomy + shape + probe-pack test for security-secrets-management
// (criterion e hardening, 2026-09-11).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'security-secrets-management');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'security-secrets-management');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');

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
// self-provisions and self-cleans a throwaway keypair.
for (const probe of ['encrypt-decrypt-round-trip', 'add-recipient-rotation', 'key-rotation', 'mismatched-key-refusal']) {
  test(`security-secrets-management ${probe} probe: aggregate pass on real sops+age engine`, async () => {
    const runProbe = (await import(pathToFileURL(join(PROBES_DIR, `${probe}.mjs`)).href)).default;
    const { results } = await runProbe();
    for (const r of results) assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`);
  });
}

test('security-secrets-management blueprint.json: version bumped and updatedAt refreshed', async () => {
  const manifest = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.match(manifest.version, /^1\.1\./);
  assert.ok(manifest.updatedAt, 'blueprint.json must carry an updatedAt');
});
