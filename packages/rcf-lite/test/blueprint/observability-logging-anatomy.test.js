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
  assert.equal(doc.version, '1.1.0');
  assert.equal(doc.category, 'observability');
  assert.deepEqual(doc.providesRoles, ['logging']);
  // Visual round T-5: declares capabilities: [auditLog] so the
  // application-admin-console probe pack's AC-21105-1 audit-log check
  // activates when this shelf blueprint is applied. One grammar; no
  // role-to-capability inference.
  assert.deepEqual(doc.capabilities, ['auditLog']);
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
  ]);
  const usIds = doc.contributions.filter((c) => c.kind === 'us').map((c) => c.id).sort();
  assert.ok(usIds.includes('observability-logging-US-15101'));
  assert.ok(usIds.includes('observability-logging-US-15108'));
  const tacIds = doc.contributions.filter((c) => c.kind === 'tac').map((c) => c.id).sort();
  assert.deepEqual(tacIds, [
    'TAC-1601-observability-logging-logger-factory',
    'TAC-1602-observability-logging-redaction-boundary',
  ]);
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
  assert.equal(res.version, '1.1.0');
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
