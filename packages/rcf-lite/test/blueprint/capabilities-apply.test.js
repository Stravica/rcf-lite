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
// Infra round 5 T-2: object-storage-s3 declares requiresAppliedCapabilities
// gating on secretsProvider (a capability that security-secrets-management
// v1.0.1 declares). Extends the T-5 mechanism to the secretsProvider path
// with allowSkipFlag "allow-no-secrets-yet" and refusalMessageId
// "object-storage-s3-no-secrets".
const OBJECT_STORAGE_BP = join(REPO_ROOT, 'blueprints', 'object-storage-s3');
const SECRETS_BP = join(REPO_ROOT, 'blueprints', 'security-secrets-management');
// Infra round 5 T-4: jobs-background declares requiresAppliedCapabilities
// gating on queue (a capability that messaging-queue-cloudflare v1.0.0
// declares). Extends the T-5 mechanism to the queue-capability path with
// allowSkipFlag "allow-no-queue-yet" and refusalMessageId
// "jobs-background-no-queue".
const JOBS_BACKGROUND_BP = join(REPO_ROOT, 'blueprints', 'jobs-background');
const MESSAGING_QUEUE_BP = join(REPO_ROOT, 'blueprints', 'messaging-queue-cloudflare');

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
  assert.equal(doc.version, '1.3.0');
  assert.equal(doc.allowNoAuthYet, true);
  assert.deepEqual(doc.appliedCapabilities, []);
  assert.match(doc.notes, /no auth yet/i);
});

test('object-storage-s3 apply refuses on a bare project with the object-storage-s3-no-secrets tag and names the override (TC-051-obj-storage-refuse)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-obj-bare-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const result = await applyIn(scratch, OBJECT_STORAGE_BP);
  assert.equal(result.kind, 'requiresAppliedCapabilities', JSON.stringify(result));
  // First-line tag is the stable message id; dashboards/lints bind here.
  assert.match(result.message, /\[object-storage-s3-no-secrets\]/);
  assert.match(result.message, /object-storage-s3 requires an applied blueprint declaring/);
  assert.match(result.message, /secretsProvider/);
  assert.match(result.message, /security-secrets-management/);
  assert.match(result.message, /--allow-no-secrets-yet/);
});

test('object-storage-s3 --allow-no-secrets-yet override writes sidecar with secrets-management-flavoured notes (TC-051-obj-storage-allow-skip)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-obj-skip-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const result = await applyIn(scratch, OBJECT_STORAGE_BP, { allowNoAuthYet: true });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.sidecarPath, 'rcf/blueprints/object-storage-s3.applied.json');
  const raw = await readFile(join(scratch, result.sidecarPath), 'utf8');
  const doc = JSON.parse(raw);
  assert.equal(doc.slug, 'object-storage-s3');
  // Follow-up adapter minor bump (round-7 spec section 5.4) took the
  // blueprint to v1.1.0; the shipped requiresAppliedCapabilities /
  // allowSkipFlag shape is unchanged.
  assert.equal(doc.version, '1.2.2');
  assert.equal(doc.allowNoAuthYet, true);
  assert.deepEqual(doc.appliedCapabilities, []);
  // Predecessor-family word is derived from the allowSkipFlag name;
  // the secrets override reads "no secrets-management yet" not
  // "no auth yet" so the note is legible for its predecessor family.
  assert.match(doc.notes, /no secrets-management yet/);
  assert.match(doc.notes, /--allow-no-secrets-yet/);
  assert.match(doc.notes, /secretsProvider/);
  assert.doesNotMatch(doc.notes, /no auth yet/,
    'the sidecar note for the secrets-management override must not use the auth-family prose');
});

test('object-storage-s3 apply passes on a project with security-secrets-management v1.0.1 (secretsProvider) applied (TC-051-obj-storage-cap-satisfied)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-obj-happy-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const first = await applyIn(scratch, SECRETS_BP);
  assert.equal(first.applied, true, `security-secrets-management apply failed: ${JSON.stringify(first)}`);
  const second = await applyIn(scratch, OBJECT_STORAGE_BP);
  assert.equal(second.applied, true, `object-storage-s3 apply failed after secrets-management: ${JSON.stringify(second)}`);
  assert.equal(second.slug, 'object-storage-s3');
  // The sidecar records the discovered capability set; secretsProvider
  // should appear because the applied secrets-management blueprint
  // declares it at v1.0.1.
  const raw = await readFile(join(scratch, second.sidecarPath), 'utf8');
  const doc = JSON.parse(raw);
  assert.ok(doc.appliedCapabilities.includes('secretsProvider'),
    `expected appliedCapabilities to include secretsProvider; got ${JSON.stringify(doc.appliedCapabilities)}`);
  // No override was passed on the happy path; the sidecar carries
  // neither allowNoAuthYet nor a notes field.
  assert.equal(doc.allowNoAuthYet, undefined);
  assert.equal(doc.notes, undefined);
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

test('apply on a custom-auth project fires providesCapability elicits pre-refusal and folds the answers into appliedCapabilities (TC-051-custom-auth-elicit)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-custom-auth-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  // No shelf auth applied. Custom-auth boolean answers say the
  // project's own auth provides principalDirectory + roleModel; the
  // refusal gate must NOT fire, the sidecar must record the caps
  // and the boolean answers, and the regular (when-gated) elicits
  // must fire against the effective capability set.
  const result = await applyIn(scratch, CONSOLE_BP, {
    elicitAnswers: {
      'custom-auth-provides-principal-directory': 'true',
      'custom-auth-provides-role-model': 'true',
      'baseline-roles': 'Owner, Admin, Member, Viewer',
      'invite-transport': 'email',
    },
  });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.deepEqual(result.appliedCapabilities, ['principalDirectory', 'roleModel']);
  assert.equal(result.appliedElicitations['custom-auth-provides-principal-directory'], true);
  assert.equal(result.appliedElicitations['custom-auth-provides-role-model'], true);
  assert.equal(result.appliedElicitations['baseline-roles'], 'Owner, Admin, Member, Viewer');
  assert.equal(result.appliedElicitations['invite-transport'], 'email');
  const raw = await readFile(join(scratch, result.sidecarPath), 'utf8');
  const doc = JSON.parse(raw);
  assert.deepEqual(doc.appliedCapabilities, ['principalDirectory', 'roleModel']);
  assert.equal(doc.appliedElicitations['custom-auth-provides-principal-directory'], true);
  assert.equal(doc.appliedElicitations['custom-auth-provides-role-model'], true);
});

test('apply on a custom-auth project still refuses when no capability answers are supplied and no override is passed (TC-051-custom-auth-elicit-refusal)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-custom-auth-refuse-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  // No custom-auth answers supplied and no allowNoAuthYet: refusal
  // must fire, same message as before the mechanism landed.
  const result = await applyIn(scratch, CONSOLE_BP, {
    elicitAnswers: {
      'baseline-roles': 'Owner, Admin, Member, Viewer',
      'invite-transport': 'email',
    },
  });
  assert.equal(result.kind, 'requiresAppliedCapabilities', JSON.stringify(result));
  assert.match(result.message, /application-admin-console requires at least one applied security-auth-\*/);
});

test('apply on a custom-auth project supports interactive TTY prompts via a readLine seam (TC-051-custom-auth-elicit-tty)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-custom-auth-tty-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  // Simulate a TTY session by providing a readLine seam that answers
  // each custom-auth prompt as yes / no in turn. No answers supplied
  // via the answer bag; the seam is the only source.
  const replies = { principalDirectory: 'y', roleModel: 'n', tenancy: 'no', auditLog: 'yes' };
  const readLine = async (prompt) => {
    for (const [cap, val] of Object.entries(replies)) {
      if (prompt.includes(`'${cap}'`)) return val;
    }
    return '';
  };
  const result = await applyIn(scratch, CONSOLE_BP, {
    elicitAnswers: {
      'baseline-roles': 'Owner, Admin, Member, Viewer',
      'invite-transport': 'email',
      'audit-retention-days': '90',
    },
    customAuthReadLine: readLine,
  });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.deepEqual(result.appliedCapabilities.sort(), ['auditLog', 'principalDirectory'].sort());
  assert.equal(result.appliedElicitations['custom-auth-provides-principal-directory'], true);
  assert.equal(result.appliedElicitations['custom-auth-provides-role-model'], false);
  assert.equal(result.appliedElicitations['custom-auth-provides-tenancy'], false);
  assert.equal(result.appliedElicitations['custom-auth-provides-audit-log'], true);
});

test('jobs-background apply refuses on a bare project with the jobs-background-no-queue tag, names messaging-queue-cloudflare and the --allow-no-queue-yet override (TC-051-jobs-background-refuse)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-jobs-bare-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const result = await applyIn(scratch, JOBS_BACKGROUND_BP);
  assert.equal(result.kind, 'requiresAppliedCapabilities', JSON.stringify(result));
  // First-line tag is the stable message id; dashboards/lints bind here.
  assert.match(result.message, /\[jobs-background-no-queue\]/);
  assert.match(result.message, /jobs-background requires an applied blueprint declaring/);
  assert.match(result.message, /queue/);
  assert.match(result.message, /messaging-queue-cloudflare/);
  assert.match(result.message, /--allow-no-queue-yet/);
});

test('jobs-background --allow-no-queue-yet override writes sidecar with queue-family notes (TC-051-jobs-background-allow-skip)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-jobs-skip-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const result = await applyIn(scratch, JOBS_BACKGROUND_BP, { allowNoAuthYet: true });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.sidecarPath, 'rcf/blueprints/jobs-background.applied.json');
  const raw = await readFile(join(scratch, result.sidecarPath), 'utf8');
  const doc = JSON.parse(raw);
  assert.equal(doc.slug, 'jobs-background');
  assert.equal(doc.version, '1.1.3');
  assert.equal(doc.allowNoAuthYet, true);
  assert.deepEqual(doc.appliedCapabilities, []);
  // Family word derives from allowSkipFlag; the queue override must read
  // "no queue yet" not "no auth yet" nor "no secrets-management yet".
  assert.match(doc.notes, /no queue yet/);
  assert.match(doc.notes, /--allow-no-queue-yet/);
  assert.match(doc.notes, /queue/);
  assert.doesNotMatch(doc.notes, /no auth yet/,
    'the sidecar note for the queue-family override must not use the auth-family prose');
  assert.doesNotMatch(doc.notes, /no secrets-management yet/,
    'the sidecar note for the queue-family override must not use the secrets-management prose');
});

test('jobs-background apply passes on a project with messaging-queue-cloudflare (queue) applied (TC-051-jobs-background-cap-satisfied)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-jobs-happy-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const first = await applyIn(scratch, MESSAGING_QUEUE_BP);
  assert.equal(first.applied, true, `messaging-queue-cloudflare apply failed: ${JSON.stringify(first)}`);
  const second = await applyIn(scratch, JOBS_BACKGROUND_BP);
  assert.equal(second.applied, true, `jobs-background apply failed after messaging-queue-cloudflare: ${JSON.stringify(second)}`);
  assert.equal(second.slug, 'jobs-background');
  const raw = await readFile(join(scratch, second.sidecarPath), 'utf8');
  const doc = JSON.parse(raw);
  assert.ok(doc.appliedCapabilities.includes('queue'),
    `expected appliedCapabilities to include queue; got ${JSON.stringify(doc.appliedCapabilities)}`);
  assert.equal(doc.allowNoAuthYet, undefined);
  assert.equal(doc.notes, undefined);
});

test('jobs-background legacy --allow-no-auth-yet also unblocks the queue-capability override (TC-051-jobs-background-legacy-flag)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cap-apply-jobs-legacy-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  // The runner applies the OR-of-flags shape (allowNoAuthYet piped from
  // --allow-no-auth-yet OR --allow-no-secrets-yet OR --allow-no-queue-yet).
  // A caller passing the legacy auth-family flag on a jobs-background
  // apply STILL unblocks the queue-capability gate. This is the shipped
  // backward-compatible posture; the note text still reads under the
  // queue-family because the family derivation comes from allowSkipFlag,
  // not from which flag the operator typed.
  const result = await applyIn(scratch, JOBS_BACKGROUND_BP, { allowNoAuthYet: true });
  assert.equal(result.applied, true, JSON.stringify(result));
  const raw = await readFile(join(scratch, result.sidecarPath), 'utf8');
  const doc = JSON.parse(raw);
  assert.equal(doc.slug, 'jobs-background');
  assert.match(doc.notes, /no queue yet/);
  assert.match(doc.notes, /--allow-no-queue-yet/);
});
