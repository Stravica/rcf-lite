// Pre-flight credentials side-file unit tests
// (verification-integrity-cluster-spec §4.6).
//
// Load-bearing correctness: values NEVER enter the record. The tests
// use obviously-fake fixtures (`sk-test-not-real`) so any leak would
// be visible in the failure output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadPreflightSecretsFile,
  preflightEntry,
  preflightSecretsPath,
  recordPreflightSecret,
} from '../../src/preflight/secrets.js';

test('preflightEntry is the exact aggregator-entry shape and version', () => {
  assert.deepEqual({ ...preflightEntry }, {
    path: '.rcf/preflight-secrets.local.json',
    owner: 'rcf preflight: credential name-metadata (values never enter the chain)',
    since: '0.7.0',
  });
});

test('preflightSecretsPath returns the correct absolute path', () => {
  const p = preflightSecretsPath('/tmp/some-project');
  assert.equal(p, '/tmp/some-project/.rcf/preflight-secrets.local.json');
});

test('loadPreflightSecretsFile returns an empty file when nothing exists', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-secrets-empty-'));
  const file = await loadPreflightSecretsFile({ projectRoot: tmp });
  assert.equal(Array.isArray(file.entries), true);
  assert.equal(file.entries.length, 0);
  assert.match(file.note, /Values are never written here/);
});

test('recordPreflightSecret writes name + presence but NEVER the value', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-secrets-record-'));
  // Fake env: obviously test-only.
  const env = { RESEND_API_KEY: 'sk-test-not-real-value-abcdef' };
  const entry = await recordPreflightSecret({
    projectRoot: tmp,
    serviceId: 'resend',
    envVarName: 'RESEND_API_KEY',
    env,
    now: () => '2026-07-30T14:20:00.000Z',
  });
  assert.equal(entry.serviceId, 'resend');
  assert.equal(entry.envVarName, 'RESEND_API_KEY');
  assert.equal(entry.envVarPresentAtSessionTime, true);
  assert.equal(entry.recordedAt, '2026-07-30T14:20:00.000Z');
  const path = preflightSecretsPath(tmp);
  const raw = await readFile(path, 'utf8');
  // The fake value must NOT appear in the file. This is the load-bearing
  // redaction assertion.
  assert.equal(raw.includes('sk-test-not-real-value-abcdef'), false,
    'the value MUST NOT enter the side-file; presence is the boolean');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.entries[0].envVarName, 'RESEND_API_KEY');
});

test('recordPreflightSecret with an absent env var writes present:false', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-secrets-absent-'));
  const env = {};
  const entry = await recordPreflightSecret({
    projectRoot: tmp,
    serviceId: 'resend',
    envVarName: 'RESEND_API_KEY',
    env,
    now: () => '2026-07-30T14:20:00.000Z',
  });
  assert.equal(entry.envVarPresentAtSessionTime, false);
});

test('recordPreflightSecret is idempotent by serviceId (later call replaces)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-secrets-idem-'));
  await recordPreflightSecret({
    projectRoot: tmp, serviceId: 'resend', envVarName: 'OLD_KEY', env: {}, now: () => '2026-07-30T14:20:00.000Z',
  });
  await recordPreflightSecret({
    projectRoot: tmp, serviceId: 'resend', envVarName: 'NEW_KEY', env: { NEW_KEY: 'sk-test-not-real' }, now: () => '2026-07-30T14:25:00.000Z',
  });
  const file = await loadPreflightSecretsFile({ projectRoot: tmp });
  const resendEntries = file.entries.filter((e) => e.serviceId === 'resend');
  assert.equal(resendEntries.length, 1, 'exactly one entry per serviceId');
  assert.equal(resendEntries[0].envVarName, 'NEW_KEY');
  assert.equal(resendEntries[0].envVarPresentAtSessionTime, true);
});

test('recordPreflightSecret refuses empty serviceId / envVarName', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-secrets-refuse-'));
  await assert.rejects(recordPreflightSecret({ projectRoot: tmp, serviceId: '', envVarName: 'X', env: {} }), /serviceId required/);
  await assert.rejects(recordPreflightSecret({ projectRoot: tmp, serviceId: 'x', envVarName: '', env: {} }), /envVarName required/);
});
