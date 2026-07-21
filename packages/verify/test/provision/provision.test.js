// Provisioning tests (spec §6, §11): route derivation from a fixture chain,
// zzverify- naming, credential-file discipline (no secret in logs/report),
// BLOCKED path + dependent-AC marking, cleanup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ZZVERIFY_PREFIX,
  MIN_AUTH_ACCOUNTS,
  classifyPrerequisite,
  deriveProvisioningPlan,
  redactSecrets,
  provisionAuth,
  runProvisioning,
  cleanup,
} from '../../src/provision/index.js';

const authAc = { acId: 'AC-1', description: 'user can sign in', given: 'a registered account', when: 'the user logs in', then: 'dashboard shown' };
const payAc = { acId: 'AC-2', description: 'checkout via payment sandbox', when: 'user pays with stripe', then: 'receipt shown' };
const seedAc = { acId: 'AC-3', description: 'admin-seeded record is visible', given: 'an admin-created row exists', when: 'user opens it', then: 'it renders' };
const plainAc = { acId: 'AC-4', description: 'landing page renders', when: 'visitor loads home', then: 'headline visible' };

test('classifyPrerequisite: auth / service / seed / none', () => {
  assert.equal(classifyPrerequisite(authAc), 'authAccount');
  assert.equal(classifyPrerequisite(payAc), 'serviceSandbox');
  assert.equal(classifyPrerequisite(seedAc), 'seedData');
  assert.equal(classifyPrerequisite(plainAc), null);
});

test('deriveProvisioningPlan: groups ACs by required prerequisite kind', () => {
  const plan = deriveProvisioningPlan([authAc, payAc, seedAc, plainAc]);
  assert.deepEqual(plan.acsByKind.authAccount, ['AC-1']);
  assert.deepEqual(plan.acsByKind.serviceSandbox, ['AC-2']);
  assert.deepEqual(plan.acsByKind.seedData, ['AC-3']);
  assert.equal(plan.required.includes('authAccount'), true);
});

test('redactSecrets: strips secret-field values recursively, leaves non-secrets', () => {
  const out = redactSecrets({ ref: 'zzverify-a', password: 'hunter2', nested: { token: 't', keep: 'ok' }, list: [{ apiKey: 'k' }] });
  assert.equal(out.ref, 'zzverify-a');
  assert.equal(out.password, '[redacted]');
  assert.equal(out.nested.token, '[redacted]');
  assert.equal(out.nested.keep, 'ok');
  assert.equal(out.list[0].apiKey, '[redacted]');
});

test('provisionAuth: with a signup route stands up >=2 zzverify- accounts', async () => {
  const signup = async ({ username }) => ({ username, password: 'secret-pw' });
  const { provisioned, blocked, credentials } = await provisionAuth({ url: 'https://app', signup });
  assert.ok(provisioned.length >= MIN_AUTH_ACCOUNTS);
  assert.equal(blocked.length, 0);
  assert.ok(provisioned.every((p) => p.ref.startsWith(ZZVERIFY_PREFIX)));
  assert.ok(credentials.every((c) => c.ref.startsWith(ZZVERIFY_PREFIX)));
});

test('provisionAuth: no signup route -> BLOCKED, naming the missing prerequisite', async () => {
  const { provisioned, blocked } = await provisionAuth({ url: 'https://app' });
  assert.equal(provisioned.length, 0);
  assert.equal(blocked[0].kind, 'authAccount');
  assert.match(blocked[0].reason, /cannot provision/);
});

test('runProvisioning: credentials go ONLY to the --provision file, never into the report body', async () => {
  const provisionPath = join(await mkdtemp(join(tmpdir(), 'rcf-prov-')), 'creds.json');
  const signup = async ({ username }) => ({ username, password: 'top-secret-123' });
  const { provisioning } = await runProvisioning({ acs: [authAc], url: 'https://app', provisionPath, signup });
  // Report-body record carries refs only, no secret.
  const body = JSON.stringify(provisioning);
  assert.doesNotMatch(body, /top-secret-123/);
  assert.match(body, /zzverify-/);
  // The provision file DOES carry the credentials (the only sink).
  const fileRaw = await readFile(provisionPath, 'utf8');
  assert.match(fileRaw, /top-secret-123/);
});

test('runProvisioning: unprovisionable prereqs BLOCK dependent ACs, never silently skipped', async () => {
  const { provisioning, blockedAcs } = await runProvisioning({ acs: [payAc, seedAc], url: 'https://app' });
  assert.ok(provisioning.blocked.length >= 2);
  const blockedIds = blockedAcs.map((b) => b.acId).sort();
  assert.deepEqual(blockedIds, ['AC-2', 'AC-3']);
  assert.ok(blockedAcs.every((b) => /cannot provision/.test(b.reason)));
});

test('runProvisioning: auth with no signup marks its dependent ACs BLOCKED', async () => {
  const { blockedAcs } = await runProvisioning({ acs: [authAc], url: 'https://app' });
  assert.deepEqual(blockedAcs.map((b) => b.acId), ['AC-1']);
});

test('runProvisioning: mode skip provisions nothing', async () => {
  const { provisioning, blockedAcs } = await runProvisioning({ acs: [authAc], url: 'https://app', mode: 'skip' });
  assert.deepEqual(provisioning.provisioned, []);
  assert.deepEqual(blockedAcs, []);
});

test('cleanup: with a teardown route removes provisioned refs and reports them', async () => {
  const removed = [];
  const teardown = async (ref) => { removed.push(ref); };
  const result = await cleanup({ provisioned: [{ ref: 'zzverify-a' }, { ref: 'zzverify-b' }], teardown });
  assert.equal(result.cleanupRan, true);
  assert.deepEqual(result.cleanupRemoved, ['zzverify-a', 'zzverify-b']);
});

test('cleanup: no teardown route -> honest cleanupRan:false, blocked listed (no false clean sweep)', async () => {
  const result = await cleanup({ provisioned: [{ ref: 'zzverify-a' }] });
  assert.equal(result.cleanupRan, false);
  assert.equal(result.cleanupBlocked[0].ref, 'zzverify-a');
});
