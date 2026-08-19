// Unit tests for src/build/standards-selector.js. Covers AC-1004-1,
// AC-1004-3 (empty selection never blocks) and AC-1004-4 (deterministic
// stable per input).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectStandards } from '../../src/build/standards-selector.js';

const packs = [
  { slug: 'wsd-naming', tags: ['naming', 'conventions'] },
  { slug: 'security-baseline', tags: ['security', 'logging'] },
  { slug: 'http-errors', tags: ['api', 'errors'] },
];

test('selectStandards: FBS whose text names a tag selects that pack', () => {
  const fbs = { title: 'Wire error envelope on the api handler', summary: 'RFC 7807 problem-details on every errors response.' };
  const { standardIds } = selectStandards(fbs, packs);
  assert.deepEqual(standardIds, ['http-errors']);
});

test('selectStandards: FBS whose text names multiple tags selects multiple packs (manifest order)', () => {
  const fbs = { title: 'Add security logging on POST /users', summary: 'errors go to the api handler' };
  const { standardIds } = selectStandards(fbs, packs);
  // security tag -> security-baseline; api / errors -> http-errors. Manifest order.
  assert.deepEqual(standardIds, ['security-baseline', 'http-errors']);
});

test('selectStandards: empty selection when nothing matches (AC-1004-3)', () => {
  const fbs = { title: 'Refactor the notes store', summary: 'Move persistence to a background worker.' };
  const { standardIds } = selectStandards(fbs, packs);
  assert.deepEqual(standardIds, []);
});

test('selectStandards: empty standards list returns empty selection', () => {
  assert.deepEqual(selectStandards({ title: 'anything' }, []).standardIds, []);
  assert.deepEqual(selectStandards({ title: 'anything' }, null).standardIds, []);
});

test('selectStandards: selection is deterministic across repeat invocations (AC-1004-4)', () => {
  const fbs = { title: 'Add security logging and errors and naming', summary: 'api concerns.' };
  const a = selectStandards(fbs, packs);
  const b = selectStandards(fbs, packs);
  assert.deepEqual(a.standardIds, b.standardIds);
  assert.deepEqual(a.scoresById, b.scoresById);
});

test('selectStandards: selection includes AC descriptions and given/when/then in the source', () => {
  const fbs = {
    title: 'Feature',
    summary: 'nothing here',
    acceptanceCriteria: [
      { description: 'reject when the security check fails', given: 'x', when: 'y', then: 'z' },
    ],
  };
  const { standardIds } = selectStandards(fbs, packs);
  assert.deepEqual(standardIds, ['security-baseline']);
});
