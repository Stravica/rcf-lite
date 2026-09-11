// Anatomy + apply test for the observability-logging v1.0.0 shelf
// blueprint (core-companions train, spec section 1.1).
//
// Covers TS-038: blueprint.json declares the ratified shape, apply
// into a fresh fixture succeeds, and anatomy files (README, guide,
// docs/topics.md) exist with the required sections.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';
import { loadBlueprint } from '../../src/blueprint/loader.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/rcf-lite/test/blueprint -> packages/rcf-lite -> monorepo root
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'observability-logging');

test('observability-logging: blueprint.json declares the ratified shape (TC-038-blueprint-json-fields)', async () => {
  const raw = await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8');
  const doc = JSON.parse(raw);
  assert.equal(doc.slug, 'observability-logging');
  assert.equal(doc.version, '1.3.5');
  assert.equal(doc.category, 'observability');
  assert.deepEqual(doc.providesRoles, ['logging']);
  // Hardening pass B4 (2026-09-09): sessionInventory removed per section 7c
  // (no requirement, story or TAC responsibility ever backed it on this
  // blueprint; owner is security-auth-clerk TAC-1003 interfaces.sessionInventory).
  // auditLog stays: application-admin-console AC-21105-1 reads it through
  // observability-logging-REQ-006. One grammar; no role-to-capability inference.
  assert.deepEqual([...doc.capabilities].sort(), ['auditLog']);
  assert.ok(Array.isArray(doc.elicits) && doc.elicits.length === 4);
  const elicitIds = doc.elicits.map((e) => e.id).sort();
  assert.deepEqual(elicitIds, [
    'boot-identity-fields',
    'correlation-header-name',
    'minimum-log-level',
    'redaction-categories-additions',
  ]);
  const globalAdrs = doc.contributions.filter((c) => c.kind === 'adr' && c.scope === 'global');
  assert.equal(globalAdrs.length, 1);
  assert.equal(globalAdrs[0].id, 'ADR-1601-observability-logging-line-shape');
  assert.equal(globalAdrs[0].topic, 'logging');
  const reqIds = doc.contributions.filter((c) => c.kind === 'req').map((c) => c.id).sort();
  assert.deepEqual(reqIds, [
    'observability-logging-REQ-001',
    'observability-logging-REQ-002',
    'observability-logging-REQ-003',
    'observability-logging-REQ-004',
    'observability-logging-REQ-005',
    'observability-logging-REQ-006',
  ]);
  const usIds = doc.contributions.filter((c) => c.kind === 'us').map((c) => c.id).sort();
  assert.ok(usIds.includes('observability-logging-US-15101'));
  assert.ok(usIds.includes('observability-logging-US-15108'));
  assert.ok(usIds.includes('observability-logging-US-15109'));
  const tacIds = doc.contributions.filter((c) => c.kind === 'tac').map((c) => c.id).sort();
  assert.deepEqual(tacIds, [
    'TAC-1601-observability-logging-logger-factory',
    'TAC-1602-observability-logging-redaction-boundary',
  ]);
  const adrIds = doc.contributions.filter((c) => c.kind === 'adr').map((c) => c.id).sort();
  assert.ok(adrIds.includes('ADR-1605-observability-logging-serialisation-refusal'));
});

test('observability-logging: apply into a fresh fixture succeeds and writes the namespaced contributions (TC-038-clean-apply)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-obs-log-apply-'));
  await initProject({ projectRoot: root, projectName: 'obs-log-apply' });
  const { tree } = await walkTree({ projectRoot: root });
  const bp = await loadBlueprint(BLUEPRINT_ROOT);
  assert.equal(bp.kind, undefined, JSON.stringify(bp));
  const res = await applyBlueprint({ projectRoot: root, tree, source: BLUEPRINT_ROOT });
  assert.equal(res.applied, true, JSON.stringify(res));
  assert.equal(res.slug, 'observability-logging');
  assert.equal(res.version, '1.3.5');
  const adrPath = join(root, 'rcf', 'adrs', 'adr-1601-observability-logging-line-shape.json');
  const st = await stat(adrPath);
  assert.ok(st.isFile(), 'expected ADR-1601 file on disk after apply');
});

test('observability-logging: anatomy files exist with the required sections (TC-038-anatomy-and-topics)', async () => {
  const readmePath = join(BLUEPRINT_ROOT, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  assert.match(readme, /## Apply/);
  assert.match(readme, /## Known mechanism-reach gaps/);
  const guide = await readFile(join(BLUEPRINT_ROOT, 'guide', 'observability-logging.md'), 'utf8');
  assert.ok(guide.length > 500, `guide unexpectedly small (${guide.length} bytes)`);
  const topics = await readFile(join(BLUEPRINT_ROOT, 'docs', 'topics.md'), 'utf8');
  assert.match(topics, /`logging`/);
  assert.match(topics, /15101-15899/);
  assert.match(topics, /16xx/);
});

// criterion e (2026-09-11): pin the criterion e probe pack files added under
// contributions/probes/ and the fixture under packages/rcf-lite/test/
// fixtures/probe-pack-observability-logging/.
test('observability-logging: contributions/probes/ pack is present and every probe declares its anchor + accountBound (TC-crit-e-probe-pack)', async () => {
  const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
  const FIXTURE_DIR = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-observability-logging');
  const probes = ['line-shape-and-fields', 'correlation-id-flow', 'redaction-boundary'];
  for (const p of probes) {
    const modUrl = new URL(`file://${join(PROBES_DIR, `${p}.mjs`)}`);
    const mod = await import(modUrl.href);
    assert.ok(typeof mod.default === 'function', `${p}: default export must be an async probe fn`);
    assert.ok(typeof mod.anchorAcId === 'string' && mod.anchorAcId.length > 0, `${p}: anchorAcId string required`);
    assert.equal(typeof mod.accountBound, 'boolean', `${p}: accountBound boolean required`);
    const runShimPath = join(PROBES_DIR, `run-${p}.mjs`);
    const text = await readFile(runShimPath, 'utf8');
    assert.match(text, /runShim\(/, `run-${p}.mjs must invoke runShim`);
  }
  const fixReadme = await readFile(join(FIXTURE_DIR, 'README.md'), 'utf8');
  assert.match(fixReadme, /Declared env vars/, 'fixture README must declare env vars');
  assert.match(fixReadme, /RCF_FIXTURE_LOGGER_CORRELATION_HEADER/, 'fixture README must name RCF_FIXTURE_LOGGER_CORRELATION_HEADER');
  const utils = await readFile(join(PROBES_DIR, 'probe-utils.mjs'), 'utf8');
  assert.match(utils, /DECLARED_ENV/, 'probe-utils must export DECLARED_ENV');
});

// criterion e (positive-evidence) extensions.
import { collectEnvReads, listMjsUnder, importProbe, resultHasEvidenceShape, collectShippedAcIds, skipReasonNamesExactlyOneDeclared } from './_probe-anatomy-helpers.mjs';

const PROBES_DIR_E = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const FIXTURE_DIR_E = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-observability-logging');
const PROBES_E = ['line-shape-and-fields', 'correlation-id-flow', 'redaction-boundary'];

test('observability-logging: DECLARED_ENV covers every process.env read across probes + fixture src (TC-crit-e-env-derivation)', async () => {
  const probeFiles = await listMjsUnder(PROBES_DIR_E);
  const fixtureFiles = await listMjsUnder(join(FIXTURE_DIR_E, 'src'));
  const actualReads = await collectEnvReads([...probeFiles, ...fixtureFiles]);
  const utils = await importProbe(join(PROBES_DIR_E, 'probe-utils.mjs'));
  const declared = utils.DECLARED_ENV instanceof Set ? utils.DECLARED_ENV : new Set(Array.from(utils.DECLARED_ENV || []));
  const missing = [...actualReads].filter((n) => !declared.has(n));
  assert.equal(missing.length, 0, 'DECLARED_ENV must include every process.env name read by probes or fixture; missing: ' + JSON.stringify(missing) + '; actualReads=' + JSON.stringify([...actualReads]));
});

test('observability-logging: every probe returns results whose rows each carry a 7d evidence shape or an honest skip (TC-crit-e-result-shape)', async () => {
  const shippedAcIds = await collectShippedAcIds(BLUEPRINT_ROOT);
  const browserOnlyAcIds = new Set();
  const utilsForShape = await importProbe(join(PROBES_DIR_E, 'probe-utils.mjs'));
  const declared = utilsForShape.DECLARED_ENV instanceof Set ? utilsForShape.DECLARED_ENV : new Set(Array.from(utilsForShape.DECLARED_ENV || []));
  for (const p of PROBES_E) {
    const mod = await importProbe(join(PROBES_DIR_E, p + '.mjs'));
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
