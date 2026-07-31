// The 0.7.0 preflight credentials side-file rides the 0.6.0 managed
// `.gitignore` aggregator seam. AC coverage:
//
// 1. The preflightEntry constant shape matches the aggregator's entry
//    contract (path, owner, since) with the correct side-file path.
// 2. managedGitignoreEntries() returns exactly identityEntry followed
//    by preflightEntry, proving the extension shipped through the same
//    aggregator the 0.6.0 spec §4.1 D-4 pattern promised.
// 3. The composed block carries the preflight side-file path on its
//    own line with the owner comment above it.
// 4. Adding the entry to the aggregator produces a stable, deterministic
//    hash change (a real drift signal for `rcf doctor`'s stale-hash
//    check).
//
// This test file exists to make the "genuinely two lines" claim from
// verification-integrity-cluster-spec §4.6 / §8.3 directly falsifiable:
// changing the aggregator function to a non-two-line implementation
// (recomputing the list, forgetting the import, etc.) breaks the
// assertion below.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  composeGitignoreBlock,
  computeGitignoreBlockHash,
  computeGitignoreBlockHashFromEntries,
  managedGitignoreEntries,
} from '../../src/setup/managed-gitignore.js';
import { preflightEntry } from '../../src/preflight/secrets.js';

test('preflightEntry has the aggregator entry shape and the spec-declared path', () => {
  assert.equal(typeof preflightEntry.path, 'string');
  assert.equal(typeof preflightEntry.owner, 'string');
  assert.equal(typeof preflightEntry.since, 'string');
  assert.equal(preflightEntry.path, '.rcf/preflight-secrets.local.json',
    'side-file path is the one verification-integrity-cluster-spec §4.6 names');
  assert.equal(preflightEntry.since, '0.7.0');
  assert.match(preflightEntry.owner, /rcf preflight/);
  // Owner text is what appears in the composed block; the tone must
  // read as a plain description of what the entry is for and MUST NOT
  // hint at a secret value.
  assert.equal(/token|secret value|api[_ ]?key/i.test(preflightEntry.owner), false,
    'owner comment surfaces the mechanism, not any secret material');
});

test('managedGitignoreEntries() carries identity then preflight, in aggregator-registered order', () => {
  const entries = managedGitignoreEntries();
  assert.equal(entries.length, 2, 'aggregator carries exactly identity + preflight after the 0.7.0 extension');
  assert.equal(entries[0].path, 'rcf/.identity/');
  assert.equal(entries[1].path, '.rcf/preflight-secrets.local.json');
  // Object identity: the second entry IS the exported constant, not a
  // dup. Proves the extension is by import, not by inline literal.
  assert.equal(entries[1], preflightEntry);
});

test('composed .gitignore block carries the preflight side-file line with its owner comment', () => {
  const composed = composeGitignoreBlock();
  const preflightLineIdx = composed.indexOf('.rcf/preflight-secrets.local.json');
  assert.notEqual(preflightLineIdx, -1, 'preflight path appears in the composed block');
  const ownerLineIdx = composed.indexOf('# rcf preflight');
  assert.notEqual(ownerLineIdx, -1, 'owner comment appears in the composed block');
  assert.equal(ownerLineIdx < preflightLineIdx, true,
    'owner comment sits above the path line in the composed block');
});

test('adding preflightEntry changes the aggregator hash (doctor drift signal is real)', () => {
  const withoutPreflight = managedGitignoreEntries()
    .filter((e) => e.path !== preflightEntry.path);
  const baseHash = computeGitignoreBlockHashFromEntries(withoutPreflight);
  const currentHash = computeGitignoreBlockHash();
  assert.notEqual(baseHash, currentHash,
    'aggregator hash changes when the preflight entry is added; a repo on the pre-0.7.0 block hashes to `baseHash`, upgraded aggregator hashes to `currentHash`, doctor reports stale-hash on the difference');
});
