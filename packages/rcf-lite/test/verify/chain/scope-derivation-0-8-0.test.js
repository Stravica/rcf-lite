// 0.8.0 slug-train car 4 (NV-BL-GATE-01, NV-BL-ADM-03): verify's chain
// reader surfaces the AC `scope` tag and the list of `boundTcs` (with
// each TC's own scope) so the verdict layer can emit SCOPE-MISMATCH.
// The scope tags live on rcf-schemas 0.4.3's AC/TC subschemas; this
// test proves the chain reader hands them through cleanly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readChain } from '../../../src/verify/chain/index.js';
import { scaffoldChain } from '../helpers/chain.js';

test('readChain surfaces AC.scope on the flattened AC and per-TC scope on boundTcs (0.8.0 car 4)', async () => {
  const acceptanceCriteria = [
    {
      id: 'AC-101-1',
      description: 'runtime observable AC',
      testable: true,
      scope: 'runtime',
    },
  ];
  const { root } = await scaffoldChain({ acceptanceCriteria });
  // Write a TS with two TCs on AC-101-1: one library-scope, one runtime-scope.
  const ts = {
    id: 'TS-500',
    usId: 'US-101',
    title: 'scope-tag readout',
    purpose: 'Prove the chain reader hands scope tags through to verify verdict.',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    status: 'draft',
    testCases: [
      { id: 'TC-500-library', acId: 'AC-101-1', description: 'lib', status: 'pending', testPointer: 'a.test.js::b', scope: 'library' },
      { id: 'TC-500-runtime', acId: 'AC-101-1', description: 'rt', status: 'pending', testPointer: 'a.test.js::c', scope: 'runtime' },
    ],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(root, 'rcf', 'test-suites', 'ts-500.json'), JSON.stringify(ts), 'utf8');

  const chain = await readChain({ repo: root });
  assert.ok(!chain.kind, `readChain returned an error: ${JSON.stringify(chain)}`);
  const ac = chain.acs.find((a) => a.acId === 'AC-101-1');
  assert.ok(ac, 'AC-101-1 should be surfaced');
  assert.equal(ac.scope, 'runtime');
  assert.equal(ac.boundTcs.length, 2);
  const tcScopes = ac.boundTcs.map((t) => `${t.tcId}=${t.scope ?? 'none'}`).sort();
  assert.deepEqual(tcScopes, ['TC-500-library=library', 'TC-500-runtime=runtime']);
});

test('readChain leaves AC.scope undefined when the AC has no scope tag (bootstrap window)', async () => {
  const { root } = await scaffoldChain();
  const chain = await readChain({ repo: root });
  const ac = chain.acs.find((a) => a.acId === 'AC-101-1');
  assert.equal(ac.scope, undefined, 'AC without scope must surface undefined, not a synthesised default');
  assert.deepEqual(ac.boundTcs, [], 'no bound TC scaffolded, boundTcs should be empty');
});
