// Anatomy test for the persistence-data-sqlite v1.1.3 shelf blueprint.
// Covers criterion e (positive-evidence) probe pack shape + shipped
// blueprint metadata; extends only where a criterion e pack has been
// added.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectEnvReads, listMjsUnder, importProbe, resultHasEvidenceShape, collectShippedAcIds, skipReasonNamesExactlyOneDeclared } from './_probe-anatomy-helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'persistence-data-sqlite');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const FIXTURE_DIR = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-persistence-data-sqlite');

const PROBES = ['boot-open-migrate', 'facade-round-trip', 'wal-checkpoint'];

test('persistence-data-sqlite: blueprint.json version pinned at 1.1.5 (TC-crit-e-blueprint-json-version)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'persistence-data-sqlite');
  assert.equal(doc.version, '1.1.5');
});

test('persistence-data-sqlite: contributions/probes/ pack is present and every probe declares anchor + accountBound (TC-crit-e-probe-pack)', async () => {
  for (const p of PROBES) {
    const mod = await importProbe(join(PROBES_DIR, p + '.mjs'));
    assert.ok(typeof mod.default === 'function', p + ': default export must be an async probe fn');
    assert.ok(typeof mod.anchorAcId === 'string' && mod.anchorAcId.length > 0, p + ': anchorAcId string required');
    assert.equal(typeof mod.accountBound, 'boolean', p + ': accountBound boolean required');
    const runShimText = await readFile(join(PROBES_DIR, 'run-' + p + '.mjs'), 'utf8');
    assert.match(runShimText, /runShim\(/, 'run-' + p + '.mjs must invoke runShim');
  }
  const utils = await readFile(join(PROBES_DIR, 'probe-utils.mjs'), 'utf8');
  assert.match(utils, /DECLARED_ENV/, 'probe-utils.mjs must export DECLARED_ENV');
});

test('persistence-data-sqlite: DECLARED_ENV covers every process.env read across probes + fixture src (TC-crit-e-env-derivation)', async () => {
  const probeFiles = await listMjsUnder(PROBES_DIR);
  const fixtureFiles = await listMjsUnder(join(FIXTURE_DIR, 'src'));
  const actualReads = await collectEnvReads([...probeFiles, ...fixtureFiles]);
  const utils = await importProbe(join(PROBES_DIR, 'probe-utils.mjs'));
  const declared = utils.DECLARED_ENV instanceof Set ? utils.DECLARED_ENV : new Set(Array.from(utils.DECLARED_ENV || []));
  const missing = [...actualReads].filter((n) => !declared.has(n));
  assert.equal(missing.length, 0, 'DECLARED_ENV must include every process.env name read by probes or fixture; missing: ' + JSON.stringify(missing) + '; actualReads=' + JSON.stringify([...actualReads]));
});

test('persistence-data-sqlite: fixture README declares every env var in DECLARED_ENV (TC-crit-e-fixture-env-declaration)', async () => {
  const readme = await readFile(join(FIXTURE_DIR, 'README.md'), 'utf8');
  assert.match(readme, /Declared env vars/, 'fixture README must have a Declared env vars section');
  const utils = await importProbe(join(PROBES_DIR, 'probe-utils.mjs'));
  const declared = utils.DECLARED_ENV instanceof Set ? [...utils.DECLARED_ENV] : Array.from(utils.DECLARED_ENV || []);
  for (const env of declared) {
    assert.match(readme, new RegExp(env), 'fixture README must name env var ' + env);
  }
});

test('persistence-data-sqlite: every probe returns results whose rows each carry a 7d evidence shape or an honest skip (TC-crit-e-result-shape)', async () => {
  const shippedAcIds = await collectShippedAcIds(BLUEPRINT_ROOT);
  const browserOnlyAcIds = new Set();
  const utils = await importProbe(join(PROBES_DIR, 'probe-utils.mjs'));
  const declared = utils.DECLARED_ENV instanceof Set ? utils.DECLARED_ENV : new Set(Array.from(utils.DECLARED_ENV || []));
  for (const p of PROBES) {
    const mod = await importProbe(join(PROBES_DIR, p + '.mjs'));
    const outcome = await mod.default();
    const results = outcome && Array.isArray(outcome.results) ? outcome.results : null;
    assert.ok(results && results.length > 0, p + ': probe returned no results');
    for (const [i, r] of results.entries()) {
      const check = resultHasEvidenceShape(r, { shippedAcIds, browserOnlyAcIds });
      assert.ok(check.ok, p + ' result[' + i + '] anchor=' + r.anchorAcId + ' verdict=' + r.verdict + ' fails 7d evidence shape: ' + check.reason);
      if (r.accountBoundSkipped === true) {
        const named = skipReasonNamesExactlyOneDeclared(r.reason, declared);
        assert.ok(named.ok, p + ' result[' + i + '] accountBoundSkipped reason must name exactly one declared env var: ' + named.reason);
      }
    }
  }
});
