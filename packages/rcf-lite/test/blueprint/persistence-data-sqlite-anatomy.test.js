// Anatomy test for the persistence-data-sqlite v1.1.2 shelf blueprint.
// Covers e-mixed (2026-09-11) probe pack shape + shipped blueprint
// metadata. Extends the existing test surface only where a criterion
// e pack has been added; blueprint.json fields not touched here stay
// under the shelf lint's remit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'persistence-data-sqlite');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const FIXTURE_DIR = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-persistence-data-sqlite');

const PROBES = ['boot-open-migrate', 'facade-round-trip', 'wal-checkpoint'];

test('persistence-data-sqlite: blueprint.json version pinned at 1.1.2 (TC-e-mixed-blueprint-json-version)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'persistence-data-sqlite');
  assert.equal(doc.version, '1.1.2');
});

test('persistence-data-sqlite: contributions/probes/ pack is present and every probe declares anchor + accountBound (TC-e-mixed-probe-pack)', async () => {
  for (const p of PROBES) {
    const modUrl = pathToFileURL(join(PROBES_DIR, p + '.mjs'));
    const mod = await import(modUrl.href);
    assert.ok(typeof mod.default === 'function', p + ': default export must be an async probe fn');
    assert.ok(typeof mod.anchorAcId === 'string' && mod.anchorAcId.length > 0, p + ': anchorAcId string required');
    assert.equal(typeof mod.accountBound, 'boolean', p + ': accountBound boolean required');
    const runShimText = await readFile(join(PROBES_DIR, 'run-' + p + '.mjs'), 'utf8');
    assert.match(runShimText, /runShim\(/, 'run-' + p + '.mjs must invoke runShim');
  }
  const utils = await readFile(join(PROBES_DIR, 'probe-utils.mjs'), 'utf8');
  assert.match(utils, /DECLARED_ENV/, 'probe-utils.mjs must export DECLARED_ENV');
});

test('persistence-data-sqlite: fixture README declares every env var the probes read (TC-e-mixed-fixture-env-declaration)', async () => {
  const readme = await readFile(join(FIXTURE_DIR, 'README.md'), 'utf8');
  assert.match(readme, /Declared env vars/, 'fixture README must have a Declared env vars section');
  const utils = await readFile(join(PROBES_DIR, 'probe-utils.mjs'), 'utf8');
  const declared = [...utils.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]);
  const uniq = [...new Set(declared)].filter((n) => n.startsWith('CI_') || n.startsWith('RCF_FIXTURE_') || n.startsWith('CF_') || n.startsWith('RESEND_') || n === 'SIMULATE_D1_RATE_LIMIT');
  for (const env of uniq) {
    assert.match(readme, new RegExp(env), 'fixture README must name env var ' + env);
  }
});
