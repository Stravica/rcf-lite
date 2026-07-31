// Track C+D §5.4 Stage-1 refusal gate tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fbsRefusalForOpenSweep, formatStage1RefusalMessage } from '../../src/req-baseline/gate.js';

function makeAuthShapedTree() {
  const req = {
    reqId: 'REQ-201',
    shapeClassification: { shapes: ['auth'], reason: 'keyword-scan', classifiedAt: '2026-07-31T10:00:00.000Z' },
  };
  const us = {
    usId: 'US-2011',
    reqId: 'REQ-201',
    acceptanceCriteria: [
      { id: 'AC-2011-1', description: 'operator-authored happy path', testable: true },
    ],
  };
  const fbs = { fbsId: 'FBS-011', acIds: ['AC-2011-1'] };
  return {
    tree: {
      kindById: new Map([
        ['REQ-201', 'requirement'],
        ['US-2011', 'userStory'],
        ['FBS-011', 'featureBuildSpec'],
      ]),
      byId: new Map([
        ['REQ-201', req],
        ['US-2011', us],
        ['FBS-011', fbs],
      ]),
      parentByChild: new Map([['AC-2011-1', 'US-2011']]),
      manifest: {},
    },
  };
}

test('fbsRefusalForOpenSweep refuses an FBS whose US has open baseline candidates', () => {
  const { tree } = makeAuthShapedTree();
  const refusal = fbsRefusalForOpenSweep(tree, 'FBS-011');
  assert.ok(refusal, 'expected refusal');
  assert.equal(refusal.fbsId, 'FBS-011');
  assert.equal(refusal.usId, 'US-2011');
  assert.ok(refusal.openCandidates.length >= 1);
  assert.match(refusal.message, /refused build: FBS-011 binds ACs on US-2011/);
  assert.match(refusal.message, /open baseline[\s\S]*candidate/);
  assert.match(refusal.message, /Resolve: rcf req-baseline sweep --req REQ-201/);
});

test('fbsRefusalForOpenSweep returns null when every baseline is accepted or opted out', () => {
  const { tree } = makeAuthShapedTree();
  // Accept every auth baseline key.
  const us = tree.byId.get('US-2011');
  us.acceptanceCriteria.push(
    { id: 'AC-2011-2', description: 'x', testable: true, provenance: { authoredBy: 'baseline', baselineKey: 'auth.htmlLoginPage' } },
    { id: 'AC-2011-3', description: 'x', testable: true, provenance: { authoredBy: 'baseline', baselineKey: 'auth.postLogout' } },
    { id: 'AC-2011-4', description: 'x', testable: true, provenance: { authoredBy: 'baseline', baselineKey: 'auth.sessionCookieShape' } },
    { id: 'AC-2011-5', description: 'x', testable: true, provenance: { authoredBy: 'baseline', baselineKey: 'auth.emptyTokenRejection' } },
  );
  const refusal = fbsRefusalForOpenSweep(tree, 'FBS-011');
  assert.equal(refusal, null);
});

test('formatStage1RefusalMessage matches the spec §5.4 refusal shape', () => {
  const msg = formatStage1RefusalMessage({
    fbsId: 'FBS-011',
    usId: 'US-1101',
    reqId: 'REQ-012',
    openCandidates: [
      { baselineKey: 'auth.postLogout', canonicalText: 'given a signed-in session, when POST /logout is invoked...', reqShape: 'auth' },
      { baselineKey: 'auth.sessionCookieShape', canonicalText: 'given any signed-in response, when the auth cookie...', reqShape: 'auth' },
    ],
  });
  assert.match(msg, /refused build: FBS-011 binds ACs on US-1101, but US-1101 has 2 open baseline/);
  assert.match(msg, /candidates awaiting a decision:/);
  assert.match(msg, /auth\.postLogout: given a signed-in session, when POST \/logout is invoked\.\.\./);
  assert.match(msg, /auth\.sessionCookieShape: given any signed-in response, when the auth cookie\.\.\./);
  assert.match(msg, /Resolve: rcf req-baseline sweep --req REQ-012/);
});
