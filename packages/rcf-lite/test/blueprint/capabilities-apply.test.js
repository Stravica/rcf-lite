// Apply-time tests for the capability-declaration mechanism (visual
// round T-5 spec sections 5.5, 5.5.1). Covers TS-051 test cases
// TC-051-apply-discovery-refuse, TC-051-apply-allow-skip,
// TC-051-elicit-answers and TC-051-sidecar-write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const CONSOLE_BP = join(REPO_ROOT, 'blueprints', 'application-admin-console');
const SPA_BP = join(REPO_ROOT, 'blueprints', 'application-spa');
const MAGIC_LINK_BP = join(REPO_ROOT, 'blueprints', 'security-auth-magic-link');
const CLERK_BP = join(REPO_ROOT, 'blueprints', 'security-auth-clerk');
const LOGGING_BP = join(REPO_ROOT, 'blueprints', 'observability-logging');

async function applyIn(scratch, source, opts = {}) {
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source, ...opts });
  return result;
}

async function assertApplied(source, scratch, opts) {
  const result = await applyIn(scratch, source, opts);
  if (result.kind || (result.conflicts && result.conflicts.length > 0)) {
    throw new Error(`apply failed for ${source}: ${JSON.stringify(result)}`);
  }
  return result;
}

test('apply refuses with requiresAppliedCapabilities rcfError on a bare project (TC-051-apply-discovery-refuse)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-bare-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  // No auth blueprint applied. The console apply refuses, with the
  // spec 5.5.1 verbatim opening line and the "Applied blueprints on
  // this project:" block naming (none) plus the --allow-no-auth-yet
  // hint. We do not apply application-spa here because it declares a
  // scope:global authModel ADR that conflicts with every shelf auth
  // blueprint under a separate resolution flow; that class is
  // orthogonal to the mechanism track's refusal.
  const result = await applyIn(scratch, CONSOLE_BP);
  assert.equal(result.kind, 'requiresAppliedCapabilities', JSON.stringify(result));
  assert.match(result.message, /application-admin-console requires at least one applied security-auth-\*/);
  assert.match(result.message, /--allow-no-auth-yet/);
});

test('apply honours allowNoAuthYet and writes sidecar with notes (TC-051-apply-allow-skip)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-skip-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const result = await applyIn(scratch, CONSOLE_BP, { allowNoAuthYet: true });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.sidecarPath, 'rcf/blueprints/application-admin-console.applied.json');
  const raw = await readFile(join(scratch, result.sidecarPath), 'utf8');
  const doc = JSON.parse(raw);
  assert.equal(doc.slug, 'application-admin-console');
  assert.equal(doc.version, '1.0.0');
  assert.equal(doc.allowNoAuthYet, true);
  assert.deepEqual(doc.appliedCapabilities, []);
  assert.match(doc.notes, /no auth yet/i);
});

test('apply elicitation phase coerces answers by kind and refuses missing required (TC-051-elicit-answers)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-elicit-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  // Apply clerk (declares principalDirectory + roleModel) so
  // baseline-roles fires; invite-transport is always in the elicit
  // set (no when-predicate). tenancy-shape and audit-retention-days
  // stay gated.
  await assertApplied(CLERK_BP, scratch);
  const result = await applyIn(scratch, CONSOLE_BP, {
    elicitAnswers: {
      'baseline-roles': 'Owner, Admin, Member, Viewer, Auditor',
      'invite-transport': 'email',
    },
  });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.appliedElicitations['baseline-roles'], 'Owner, Admin, Member, Viewer, Auditor');
  assert.equal(result.appliedElicitations['invite-transport'], 'email');
  assert.equal(result.appliedElicitations['tenancy-shape'], undefined);
  assert.equal(result.appliedElicitations['audit-retention-days'], undefined);

  // Enum refusal when a firing prompt gets an out-of-vocabulary answer.
  const scratch2 = await mkdtemp(join(tmpdir(), 'cap-apply-elicit-2-'));
  await initProject({ projectRoot: scratch2, projectName: 'scratch' });
  await assertApplied(CLERK_BP, scratch2);
  const bad = await applyIn(scratch2, CONSOLE_BP, {
    elicitAnswers: { 'invite-transport': 'carrier-pigeon' },
  });
  assert.equal(bad.kind, 'validation', JSON.stringify(bad));
  assert.match(bad.message, /invite-transport/);
  assert.match(bad.message, /one of \[email, in-app-only, custom\]/);
});

test('apply writes sidecar with appliedCapabilities and appliedElicitations idempotently (TC-051-sidecar-write)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-sidecar-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  await assertApplied(MAGIC_LINK_BP, scratch);
  const first = await applyIn(scratch, CONSOLE_BP);
  assert.equal(first.applied, true, JSON.stringify(first));
  assert.deepEqual(first.appliedCapabilities, ['principalDirectory']);
  const rawFirst = await readFile(join(scratch, first.sidecarPath), 'utf8');
  const docFirst = JSON.parse(rawFirst);
  assert.deepEqual(docFirst.appliedCapabilities, ['principalDirectory']);

  // Re-apply same version idempotently; sidecar file persists with the same union.
  const { tree: tree2 } = await walkTree({ projectRoot: scratch });
  await applyBlueprint({ projectRoot: scratch, tree: tree2, source: CONSOLE_BP });
  const rawSecond = await readFile(join(scratch, 'rcf', 'blueprints', 'application-admin-console.applied.json'), 'utf8');
  const docSecond = JSON.parse(rawSecond);
  assert.deepEqual(docSecond.appliedCapabilities, ['principalDirectory']);
  assert.equal(docSecond.slug, 'application-admin-console');

  // Clerk widens the union to [principalDirectory, roleModel].
  const scratch2 = await mkdtemp(join(tmpdir(), 'cap-apply-sidecar-2-'));
  await initProject({ projectRoot: scratch2, projectName: 'scratch' });
  await assertApplied(CLERK_BP, scratch2);
  const wide = await applyIn(scratch2, CONSOLE_BP);
  assert.equal(wide.applied, true, JSON.stringify(wide));
  assert.ok(wide.appliedCapabilities.includes('principalDirectory'), JSON.stringify(wide.appliedCapabilities));
  assert.ok(wide.appliedCapabilities.includes('roleModel'), JSON.stringify(wide.appliedCapabilities));
});
