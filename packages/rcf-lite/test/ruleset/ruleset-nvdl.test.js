// 0.30.0 PR 8 (US-17902; REQ-179 / TAC-4125 / AC-17902-1).
//
// Pin that NV-DL-ADM-01..05 land on the shipped ruleset with
// refuseByDefault: true and overrideChannel: 'recordedInChain', and
// that each row carries a non-empty title the admissibility layer
// can quote in a refusal.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getRuleset, resetRulesetCache } from '#ruleset';

const NV_DL_IDS = [
  'NV-DL-ADM-01',
  'NV-DL-ADM-02',
  'NV-DL-ADM-03',
  'NV-DL-ADM-04',
  'NV-DL-ADM-05',
];

test('ruleset NV-DL (PR 8, AC-17902-1): NV-DL-ADM-01..05 refuse by default with overrideChannel recordedInChain', async () => {
  resetRulesetCache();
  const ruleset = await getRuleset({ fresh: true });
  const byId = new Map();
  for (const rule of ruleset.admissibilityRules) byId.set(rule.id, rule);
  for (const id of NV_DL_IDS) {
    const row = byId.get(id);
    assert.ok(row, `${id} must appear in admissibilityRules`);
    assert.equal(row.refuseByDefault, true, `${id} must refuse by default`);
    assert.equal(
      row.overrideChannel,
      'recordedInChain',
      `${id} must declare overrideChannel 'recordedInChain'`,
    );
    assert.ok(
      typeof row.title === 'string' && row.title.length > 0,
      `${id} must carry a non-empty title`,
    );
  }
});
