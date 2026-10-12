// ADR-4147 / US-16504: verification scope. `rcf verify run --fbs <id>`
// narrows the acceptance contract to the ACs bound to the named FBS
// items; finalise passes its own FBS by default. These tests cover the
// pure resolver and the chain reader's fbsItems projection it reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRcfError } from '#core/errors';

import { readChain } from '../../../src/verify/chain/index.js';
import {
  CHAIN_SCOPE,
  normaliseFbsIds,
  resolveScope,
  scopeLabel,
} from '../../../src/verify/chain/scope.js';
import { scaffoldChain } from '../helpers/chain.js';

const CHAIN = {
  acs: [
    { acId: 'AC-101-1' },
    { acId: 'AC-101-2' },
    { acId: 'AC-101-3' },
    { acId: 'AC-102-1' },
  ],
  fbsItems: [
    { fbsId: 'FBS-001', acIds: ['AC-101-3'] },
    { fbsId: 'FBS-002', acIds: ['AC-101-1', 'AC-101-2'] },
    { fbsId: 'FBS-003', acIds: [] },
    { fbsId: 'FBS-004', acIds: ['AC-101-2', 'AC-102-1'] },
  ],
};

test('normaliseFbsIds: repeatable flags and comma lists collapse to a de-duplicated ordered list', () => {
  assert.deepEqual(normaliseFbsIds(undefined), []);
  assert.deepEqual(normaliseFbsIds([]), []);
  assert.deepEqual(normaliseFbsIds('FBS-001'), ['FBS-001']);
  assert.deepEqual(normaliseFbsIds(['FBS-002', 'FBS-001,FBS-002', ' FBS-003 ']), ['FBS-002', 'FBS-001', 'FBS-003']);
});

test('scopeLabel: chain with no filter, fbs:<ids> otherwise', () => {
  assert.equal(scopeLabel([]), CHAIN_SCOPE);
  assert.equal(scopeLabel(['FBS-001']), 'fbs:FBS-001');
  assert.equal(scopeLabel(['FBS-001', 'FBS-004']), 'fbs:FBS-001,FBS-004');
});

test('resolveScope: no filter keeps the whole contract and labels it chain', () => {
  const scoped = resolveScope({ chain: CHAIN });
  assert.equal(isRcfError(scoped), false);
  assert.equal(scoped.scope, 'chain');
  assert.equal(scoped.acCount, 4);
  assert.deepEqual(scoped.acs.map((a) => a.acId), ['AC-101-1', 'AC-101-2', 'AC-101-3', 'AC-102-1']);
});

test('resolveScope: one FBS narrows to exactly its bound ACs in chain order', () => {
  const scoped = resolveScope({ chain: CHAIN, fbsIds: ['FBS-002'] });
  assert.equal(isRcfError(scoped), false);
  assert.equal(scoped.scope, 'fbs:FBS-002');
  assert.equal(scoped.acCount, 2);
  assert.deepEqual(scoped.acs.map((a) => a.acId), ['AC-101-1', 'AC-101-2']);
});

test('resolveScope: several FBS items take the union of their bound ACs, each AC once', () => {
  const scoped = resolveScope({ chain: CHAIN, fbsIds: ['FBS-004', 'FBS-002'] });
  assert.equal(scoped.scope, 'fbs:FBS-004,FBS-002');
  assert.equal(scoped.acCount, 3);
  assert.deepEqual(scoped.acs.map((a) => a.acId), ['AC-101-1', 'AC-101-2', 'AC-102-1']);
});

test('resolveScope: an unknown FBS id is a usage error naming the id', () => {
  const err = resolveScope({ chain: CHAIN, fbsIds: ['FBS-001', 'FBS-999'] });
  assert.equal(isRcfError(err), true);
  assert.equal(err.kind, 'usage');
  assert.match(err.message, /FBS-999/);
  assert.doesNotMatch(err.message, /FBS-001/);
});

test('resolveScope: an FBS with zero bound ACs is refused with a plain message', () => {
  const err = resolveScope({ chain: CHAIN, fbsIds: ['FBS-003'] });
  assert.equal(isRcfError(err), true);
  assert.equal(err.kind, 'usage');
  assert.match(err.message, /FBS-003 has no bound acceptance criteria; there is nothing to verify/);
});

test('readChain: surfaces fbsItems as { fbsId, acIds } for the scope resolver', async () => {
  const { root } = await scaffoldChain();
  const chain = await readChain({ repo: root });
  assert.equal(isRcfError(chain), false);
  // initProject seeds FBS-001 bound to AC-101-1.
  assert.deepEqual(chain.fbsItems, [{ fbsId: 'FBS-001', acIds: ['AC-101-1'] }]);
  const scoped = resolveScope({ chain, fbsIds: ['FBS-001'] });
  assert.deepEqual(scoped.acs.map((a) => a.acId), ['AC-101-1']);
  assert.equal(scoped.acs[0].usId, 'US-101');
});
