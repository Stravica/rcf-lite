// Chain reader tests (spec §1, §5.2, §11). Reads ACs off a real (tmp)
// scaffolded chain through core's store — the only structural input.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRcfError } from '@stravica-ai/rcf-lite-core/errors';
import { readChain, findProjectRoot } from '../../src/chain/index.js';
import { scaffoldChain } from '../helpers/chain.js';

test('readChain: flattens ACs off the chain, mapped to their user story (chain-node addressing)', async () => {
  const { root } = await scaffoldChain();
  const result = await readChain({ repo: root });
  assert.ok(!isRcfError(result));
  assert.equal(result.chainRef, 'PRD-001');
  assert.equal(result.acs.length, 3);
  const first = result.acs.find((a) => a.acId === 'AC-101-1');
  assert.equal(first.usId, 'US-101');
  assert.equal(first.reqId, 'REQ-001');
  assert.match(first.then, /dashboard/);
});

test('readChain: --repo is required (usage error as data)', async () => {
  const err = await readChain({});
  assert.ok(isRcfError(err));
  assert.equal(err.kind, 'usage');
});

test('readChain: a path with no rcf/manifest.json is a missingFile error', async () => {
  const err = await readChain({ repo: '/definitely/not/an/rcf/chain' });
  assert.ok(isRcfError(err));
  assert.equal(err.kind, 'missingFile');
});

test('findProjectRoot: locates the root from a nested subpath', async () => {
  const { root } = await scaffoldChain();
  const found = await findProjectRoot(`${root}/rcf/user-stories`);
  assert.equal(found, root);
});
