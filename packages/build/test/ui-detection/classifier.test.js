// UI-bearing classifier tests (ui-design-gate-0.7.0-spec §4).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyFbs, isUiBearing } from '../../src/ui-detection/classifier.js';

function stubTree({ fbs, userStories = [], requirements = [] }) {
  return {
    byId: new Map([[fbs.fbsId, fbs]]),
    kindById: new Map([[fbs.fbsId, 'fbs']]),
    userStories,
    requirements,
  };
}

test('classifyFbs returns null when the id is not on the tree', () => {
  const tree = stubTree({ fbs: { fbsId: 'FBS-001' } });
  assert.equal(classifyFbs(tree, 'FBS-404'), null);
});

test('classifyFbs verdict=ui when the FBS summary carries a UI keyword', () => {
  const tree = stubTree({
    fbs: { fbsId: 'FBS-016', title: 'Dashboard', summary: 'Render the dashboard page for signed-in owners', acIds: [] },
  });
  const block = classifyFbs(tree, 'FBS-016');
  assert.equal(block.verdict, 'ui');
  assert.equal(block.reason, 'keyword-scan');
  assert.ok(block.signals.length > 0);
  assert.ok(block.signals.every((s) => s.source === 'summary'));
});

test('classifyFbs picks up AC and US signals, anchored with acId on AC matches', () => {
  const us = {
    usId: 'US-101',
    reqId: 'REQ-101',
    iWant: 'to see a nav bar on every page',
    soThat: 'I can move between sections',
    acceptanceCriteria: [
      { id: 'AC-101-1', description: 'A shared nav renders on every route', given: 'signed in', when: 'clicking a nav link', then: 'the page loads' },
    ],
  };
  const tree = stubTree({
    fbs: { fbsId: 'FBS-016', title: 'Nav', summary: '', acIds: ['AC-101-1'] },
    userStories: [us],
    requirements: [{ reqId: 'REQ-101', description: 'A page-based experience', rationale: 'Users want a browser UI' }],
  });
  const block = classifyFbs(tree, 'FBS-016');
  assert.equal(block.verdict, 'ui');
  const sources = new Set(block.signals.map((s) => s.source));
  assert.ok(sources.has('ac.description'));
  assert.ok(sources.has('us.iWant'));
  assert.ok(sources.has('req.description'));
  const acSignal = block.signals.find((s) => s.source === 'ac.description');
  assert.equal(acSignal.acId, 'AC-101-1');
});

test('classifyFbs verdict=notUi when nothing matches', () => {
  const tree = stubTree({
    // "Reprocess pending jobs" carries none of the UI seed keywords;
    // background-worker prose is the notUi archetype.
    fbs: { fbsId: 'FBS-002', title: 'Backfill worker', summary: 'Reprocess pending records via the background queue processor.', acIds: [] },
  });
  const block = classifyFbs(tree, 'FBS-002');
  assert.equal(block.verdict, 'notUi');
  assert.equal(block.signals ?? undefined, undefined);
});

test('classifyFbs returns operatorOverride when fbs.uiBearing is set', () => {
  const tree = stubTree({
    fbs: { fbsId: 'FBS-016', title: 'Dashboard', summary: 'browser page', acIds: [], uiBearing: false },
  });
  const block = classifyFbs(tree, 'FBS-016');
  assert.equal(block.verdict, 'operatorOverride');
  assert.equal(block.reason, 'operatorOverride');
  // Evidence is still preserved for provenance.
  assert.ok(block.signals && block.signals.length > 0);
});

test('classifyFbs is deterministic on the timestamp when now is injected', () => {
  const tree = stubTree({ fbs: { fbsId: 'FBS-001', title: 'x', summary: 'y', acIds: [] } });
  const fixed = new Date('2026-07-30T14:20:00Z');
  const block = classifyFbs(tree, 'FBS-001', { now: fixed });
  assert.equal(block.classifiedAt, '2026-07-30T14:20:00.000Z');
});

test('classifyFbs picks up an auth-shaped service dependency as a summary signal', () => {
  const tree = stubTree({
    fbs: {
      fbsId: 'FBS-102',
      title: 'Sessions',
      summary: 'nothing UI here',
      acIds: [],
      dependsOnServices: [{ id: 'authy', displayName: 'Authy', purpose: '', attestationMode: 'live', acIds: [], serviceCategory: 'auth' }],
    },
  });
  const block = classifyFbs(tree, 'FBS-102');
  assert.equal(block.verdict, 'ui');
  const dep = block.signals.find((s) => s.match.startsWith('dependsOnServices:'));
  assert.ok(dep, 'expected an auth service dependency signal');
});

test('isUiBearing returns true only for explicit fbs.uiBearing === true', () => {
  assert.equal(isUiBearing({ uiBearing: true }), true);
  assert.equal(isUiBearing({ uiBearing: false }), false);
  assert.equal(isUiBearing({}), false);
  assert.equal(isUiBearing(null), false);
});
