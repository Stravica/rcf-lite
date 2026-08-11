// Track C+D §5 open-candidates derivation tests. Pure tree walks; no
// disk writes; the derivation is what the Stage-1 gate consumes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  openCandidatesForUs,
  listOpenCandidates,
} from '../../src/req-baseline/open-candidates.js';

function makeTreeForOneUs({ shapes, acs = [], optOuts = [] }) {
  const req = {
    reqId: 'REQ-201',
    shapeClassification: shapes.length > 0 ? { shapes, reason: 'keyword-scan', classifiedAt: '2026-07-31T10:00:00.000Z' } : undefined,
  };
  const us = {
    usId: 'US-2011',
    reqId: 'REQ-201',
    acceptanceCriteria: acs,
  };
  const manifest = { baselineAcOptOuts: optOuts };
  const kindById = new Map([
    ['REQ-201', 'requirement'],
    ['US-2011', 'userStory'],
  ]);
  const byId = new Map([
    ['REQ-201', req],
    ['US-2011', us],
  ]);
  return { kindById, byId, manifest, us };
}

test('openCandidatesForUs returns nothing when the REQ has no shapeClassification', () => {
  const { us, ...tree } = makeTreeForOneUs({ shapes: [] });
  const open = openCandidatesForUs(tree, us);
  assert.deepEqual(open, []);
});

test('openCandidatesForUs proposes all auth baseline keys for a fresh US under an auth REQ', () => {
  const { us, ...tree } = makeTreeForOneUs({ shapes: ['auth'] });
  const open = openCandidatesForUs(tree, us);
  const keys = open.map((c) => c.baselineKey).sort();
  assert.deepEqual(keys, [
    'auth.emptyTokenRejection',
    'auth.htmlLoginPage',
    'auth.postLogout',
    'auth.sessionCookieShape',
  ]);
  for (const c of open) {
    assert.equal(c.usId, 'US-2011');
    assert.equal(c.reqId, 'REQ-201');
    assert.equal(c.reqShape, 'auth');
    assert.ok(c.canonicalText.length > 0);
  }
});

test('openCandidatesForUs skips baseline keys already present as an AC with the same baselineKey', () => {
  const acs = [
    {
      id: 'AC-2011-1',
      description: 'given a signed-in session, when POST /logout is invoked, then session ends',
      testable: true,
      provenance: { authoredBy: 'baseline', baselineKey: 'auth.postLogout' },
    },
  ];
  const { us, ...tree } = makeTreeForOneUs({ shapes: ['auth'], acs });
  const open = openCandidatesForUs(tree, us);
  assert.ok(!open.some((c) => c.baselineKey === 'auth.postLogout'));
});

test('openCandidatesForUs honours a REQ-scoped opt-out record', () => {
  const optOuts = [{
    id: 'boo-2026-07-31-001',
    createdAt: '2026-07-31T10:00:00.000Z',
    baselineKey: 'auth.htmlLoginPage',
    scope: 'req',
    reason: 'the auth surface is API-only for this REQ per platform contract.',
    operatorAckAt: '2026-07-31T10:00:00.000Z',
    reqId: 'REQ-201',
  }];
  const { us, ...tree } = makeTreeForOneUs({ shapes: ['auth'], optOuts });
  const open = openCandidatesForUs(tree, us);
  assert.ok(!open.some((c) => c.baselineKey === 'auth.htmlLoginPage'));
});

test('openCandidatesForUs honours a project-scoped opt-out record even without a reqId', () => {
  const optOuts = [{
    id: 'boo-2026-07-31-002',
    createdAt: '2026-07-31T10:00:00.000Z',
    baselineKey: 'auth.htmlLoginPage',
    scope: 'project',
    reason: 'the whole project runs API-only auth; no browser sign-in exists at all.',
    operatorAckAt: '2026-07-31T10:00:00.000Z',
  }];
  const { us, ...tree } = makeTreeForOneUs({ shapes: ['auth'], optOuts });
  const open = openCandidatesForUs(tree, us);
  assert.ok(!open.some((c) => c.baselineKey === 'auth.htmlLoginPage'));
});

test('listOpenCandidates enumerates USes with open keys across the tree', () => {
  const { us, ...tree } = makeTreeForOneUs({ shapes: ['auth'] });
  const items = listOpenCandidates(tree);
  assert.equal(items.length, 1);
  assert.equal(items[0].usId, 'US-2011');
  assert.equal(items[0].reqId, 'REQ-201');
  assert.ok(items[0].baselineKeys.length >= 4);
});
