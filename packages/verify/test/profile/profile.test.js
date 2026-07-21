// Runtime-profile module tests (spec §4, §11). Reachability is faked — no
// real network in unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRcfError } from '@stravica-ai/rcf-lite-core/errors';
import {
  PROFILES,
  resolveProfile,
  looksLocal,
  checkDeployedReachability,
  verdictAuthorityFor,
  isNotDeployed,
  stampProvenance,
} from '../../src/profile/index.js';

test('resolveProfile: --profile is mandatory (usage error as data)', () => {
  const err = resolveProfile({ url: 'https://x.com' });
  assert.ok(isRcfError(err));
  assert.equal(err.kind, 'usage');
  assert.equal(err.field, 'profile');
});

test('resolveProfile: --url is mandatory', () => {
  const err = resolveProfile({ profile: 'deployed' });
  assert.ok(isRcfError(err));
  assert.equal(err.field, 'url');
});

test('resolveProfile: invalid profile is a usage error', () => {
  const err = resolveProfile({ profile: 'prod', url: 'https://x.com' });
  assert.ok(isRcfError(err));
  assert.match(err.message, /deployed, ci, local-dev/);
});

test('resolveProfile: valid input returns the normalised declaration', () => {
  const r = resolveProfile({ profile: 'ci', url: 'http://localhost:3000', parityEnv: true });
  assert.deepEqual(r, { profile: 'ci', url: 'http://localhost:3000', parityEnv: true });
});

test('PROFILES is the three-profile set', () => {
  assert.deepEqual([...PROFILES], ['deployed', 'ci', 'local-dev']);
});

test('looksLocal: localhost/127.0.0.1/::1/.local/private ranges flagged; a real host is not', () => {
  assert.equal(looksLocal('http://localhost:8787'), true);
  assert.equal(looksLocal('http://127.0.0.1:3000'), true);
  assert.equal(looksLocal('http://[::1]:3000'), true);
  assert.equal(looksLocal('http://myapp.local'), true);
  assert.equal(looksLocal('http://192.168.1.20'), true);
  assert.equal(looksLocal('http://10.0.0.5'), true);
  assert.equal(looksLocal('not-a-url'), true); // advisory-strict
  assert.equal(looksLocal('https://app.example.com'), false);
});

test('verdictAuthorityFor: deployed=ship; ci/local-dev=correctness unless parity; parity lifts ci and local-dev', () => {
  assert.equal(verdictAuthorityFor('deployed', false), 'ship');
  assert.equal(verdictAuthorityFor('ci', false), 'correctness');
  assert.equal(verdictAuthorityFor('local-dev', false), 'correctness');
  assert.equal(verdictAuthorityFor('ci', true), 'ship');
  assert.equal(verdictAuthorityFor('local-dev', true), 'ship'); // honoured but discouraged
});

test('checkDeployedReachability: a HEAD that returns any status is reachable', async () => {
  const fetchImpl = async () => ({ status: 503 });
  const r = await checkDeployedReachability('https://app.example.com', { fetchImpl });
  assert.deepEqual(r, { reachable: true, looksLocal: false });
});

test('checkDeployedReachability: a thrown probe is unreachable (advisory-strict)', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const r = await checkDeployedReachability('https://down.example.com', { fetchImpl });
  assert.deepEqual(r, { reachable: false, looksLocal: false });
});

test('isNotDeployed: deployed + local URL -> NOT-DEPLOYED; deployed + unreachable -> NOT-DEPLOYED', () => {
  assert.equal(isNotDeployed('deployed', { reachable: true, looksLocal: true }), true);
  assert.equal(isNotDeployed('deployed', { reachable: false, looksLocal: false }), true);
  assert.equal(isNotDeployed('deployed', { reachable: true, looksLocal: false }), false);
});

test('isNotDeployed: never fires for ci/local-dev (localhost is legitimate there)', () => {
  assert.equal(isNotDeployed('ci', { reachable: false, looksLocal: true }), false);
  assert.equal(isNotDeployed('local-dev', { reachable: false, looksLocal: true }), false);
});

test('stampProvenance: attaches profile/url/parityEnv/reachability without mutating input', () => {
  const verdict = { verdict: 'PASS' };
  const stamped = stampProvenance(verdict, { profile: 'deployed', url: 'https://x', parityEnv: false, reachability: { reachable: true, looksLocal: false } });
  assert.equal(stamped.provenance.profile, 'deployed');
  assert.equal(stamped.provenance.parityEnv, false);
  assert.equal(verdict.provenance, undefined); // untouched
});
