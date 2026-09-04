// Anatomy + apply test for the application-error-handling v1.0.0
// shelf blueprint (core-companions train, spec section 1.2).
//
// Covers TS-039.

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
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-error-handling');

test('application-error-handling: blueprint.json declares the ratified shape (TC-039-blueprint-json-fields)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-error-handling');
  assert.equal(doc.version, '1.0.0');
  assert.equal(doc.category, 'application');
  assert.deepEqual(doc.providesRoles, ['errorHandling']);
  assert.equal(doc.suggestedCompanions.length, 1);
  assert.equal(doc.suggestedCompanions[0].role, 'logging');
  const globalAdrs = doc.contributions.filter((c) => c.kind === 'adr' && c.scope === 'global');
  assert.equal(globalAdrs.length, 1);
  assert.equal(globalAdrs[0].id, 'ADR-1701-application-error-handling-record-shape');
  assert.equal(globalAdrs[0].topic, 'errorHandling');
  const reqIds = doc.contributions.filter((c) => c.kind === 'req').map((c) => c.id).sort();
  assert.deepEqual(reqIds, [
    'application-error-handling-REQ-001',
    'application-error-handling-REQ-002',
    'application-error-handling-REQ-003',
    'application-error-handling-REQ-004',
  ]);
  const tacIds = doc.contributions.filter((c) => c.kind === 'tac').map((c) => c.id).sort();
  assert.deepEqual(tacIds, [
    'TAC-1701-application-error-handling-boundary',
    'TAC-1702-application-error-handling-record-factory',
  ]);
});

test('application-error-handling: apply into a fresh fixture succeeds and writes the namespaced contributions (TC-039-clean-apply)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-err-apply-'));
  await initProject({ projectRoot: root, projectName: 'err-apply' });
  const { tree } = await walkTree({ projectRoot: root });
  const res = await applyBlueprint({ projectRoot: root, tree, source: BLUEPRINT_ROOT });
  assert.equal(res.applied, true, JSON.stringify(res));
  assert.equal(res.slug, 'application-error-handling');
  const adrPath = join(root, 'rcf', 'adrs', 'adr-1701-application-error-handling-record-shape.json');
  const st = await stat(adrPath);
  assert.ok(st.isFile());
});

test('application-error-handling: docs/topics.md distinguishes errorHandling from errorEnvelope (TC-039-topics-distinct)', async () => {
  const topics = await readFile(join(BLUEPRINT_ROOT, 'docs', 'topics.md'), 'utf8');
  assert.match(topics, /`errorHandling`/);
  assert.match(topics, /errorEnvelope/);
  assert.match(topics, /Distinction from/);
  assert.match(topics, /16101-16899/);
  assert.match(topics, /17xx/);
});
