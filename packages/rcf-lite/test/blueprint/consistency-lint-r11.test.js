// 0.30.0 PR 9 (R11 lint widening): extractDeliveryFieldTail parses
// bracket forms, bare schema fields and legacy dotted forms. The
// lint accepts R11 bare fields and bracket indices without
// requiring the inner key to appear in the TAC surface text.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runPass2 } from '../../src/blueprint/consistency-lint.js';

function withReq(deliveredBy) {
  return {
    tacs: [{
      tacId: 'TAC-901',
      purpose: 'owns a thing',
      responsibilities: ['do a thing', 'do another thing'],
      interfaces: [{ name: 'loan', summary: 'create a loan' }],
    }],
    reqs: [{
      reqId: 'REQ-999',
      description: 'The system ensures something externally observable.',
      deliveredBy,
    }],
  };
}

test('runPass2 (PR 9, R11): bare schema fields do not trip reqDeliveryNotCarried', () => {
  for (const bare of ['purpose', 'internalStructure', 'responsibilities', 'interfaces', 'decision']) {
    const findings = runPass2(withReq({ tacId: 'TAC-901', field: bare }));
    assert.deepEqual(findings, [], `bare "${bare}" must not trip the lint`);
  }
});

test('runPass2 (PR 9, R11): bracket form resolves by inner key against the carried text', () => {
  // interfaces[loan] -> `loan` appears in interface.name; pass.
  assert.deepEqual(
    runPass2(withReq({ tacId: 'TAC-901', field: 'interfaces[loan]' })),
    [],
  );
  // interfaces[missing] -> `missing` not in carried text; fail.
  const miss = runPass2(withReq({ tacId: 'TAC-901', field: 'interfaces[missing]' }));
  assert.equal(miss.length, 1);
  assert.match(miss[0].message, /\[missing\]|interfaces\[missing\]/);
});

test('runPass2 (PR 9, R11): bracket integer index on responsibilities does not require a text match', () => {
  // responsibilities[0] resolves by position; the lint has nothing
  // semantic to match on the surface text and skips the check.
  assert.deepEqual(
    runPass2(withReq({ tacId: 'TAC-901', field: 'responsibilities[0]' })),
    [],
  );
});

test('runPass2 (PR 9, R11): legacy dotted form falls back to the last-segment tail match (pre-sweep tolerance)', () => {
  // `interfaces.loan` -> tail `loan` appears in carried text; pass.
  assert.deepEqual(
    runPass2(withReq({ tacId: 'TAC-901', field: 'interfaces.loan' })),
    [],
  );
  // `decision.ignored` -> `decision` is bare on the ADR schema; the
  // sweep rewrites to bare `decision`. The pre-sweep legacy form
  // here still triggers the tail match (`ignored`), which is NOT in
  // the TAC's carried text; the lint reports it so the author sweeps.
  const miss = runPass2(withReq({ tacId: 'TAC-901', field: 'decision.ignored' }));
  assert.equal(miss.length, 1);
});
