// Track C+D §4 REQ-shape classifier tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyReq,
  mergeClassificationOntoReq,
  composeOperatorOverride,
} from '../../src/req-detection/index.js';

const FIXED_NOW = new Date('2026-07-31T10:00:00.000Z');

test('classifyReq flags webUi on plain UI prose', () => {
  const req = {
    title: 'Admin dashboard',
    description: 'operators need a browser page to view every registered device with a searchable table.',
    rationale: '',
  };
  const block = classifyReq(req, { now: FIXED_NOW });
  assert.equal(block.reason, 'keyword-scan');
  assert.ok(block.shapes.includes('webUi'), `expected webUi in ${JSON.stringify(block.shapes)}`);
  assert.equal(block.classifiedAt, FIXED_NOW.toISOString());
  assert.ok(Array.isArray(block.signals) && block.signals.length > 0);
  for (const s of block.signals) {
    assert.ok(['title', 'description', 'rationale'].includes(s.source));
    assert.ok(['webUi', 'httpApi', 'auth', 'persistence', 'notifications'].includes(s.shape));
    assert.equal(typeof s.match, 'string');
    assert.ok(s.match.length > 0);
  }
});

test('classifyReq returns multi-shape when text spans shapes', () => {
  const req = {
    title: 'Sign-in page',
    description: 'render an HTML login form that accepts email and password, then issues a session cookie.',
    rationale: '',
  };
  const block = classifyReq(req, { now: FIXED_NOW });
  assert.ok(block.shapes.includes('webUi'));
  assert.ok(block.shapes.includes('auth'));
});

test('classifyReq returns [none] for pure business-rule prose', () => {
  const req = {
    title: 'Subscription plan pricing',
    description: 'the monthly plan is charged at the same rate every calendar month.',
    rationale: '',
  };
  const block = classifyReq(req, { now: FIXED_NOW });
  assert.deepEqual(block.shapes, ['none']);
  assert.equal(block.reason, 'keyword-scan');
});

test('classifyReq returns content-pending when description is empty', () => {
  const block = classifyReq({ title: 'x', description: '', rationale: '' }, { now: FIXED_NOW });
  assert.deepEqual(block.shapes, []);
  assert.equal(block.reason, 'content-pending');
  assert.equal(block.signals, undefined);
});

test('classifyReq treats a TODO-only description as content-pending', () => {
  const block = classifyReq({ title: 'x', description: 'TODO: fill me in later', rationale: '' }, { now: FIXED_NOW });
  assert.equal(block.reason, 'content-pending');
});

test('classifyReq folds parent PRD context to widen shapes when the REQ itself is silent', () => {
  const req = {
    title: 'Recovery flow',
    description: 'the operator can trigger a recovery when the guard trips.',
    rationale: '',
  };
  const parentPrd = {
    intent: 'monitor uptime and notify by email when service degrades.',
    problem: 'operators miss outages overnight.',
  };
  const block = classifyReq(req, { parentPrd, now: FIXED_NOW });
  assert.ok(block.shapes.includes('notifications'));
});

test('mergeClassificationOntoReq preserves an existing operator override on subsequent runs', () => {
  const req = {
    title: 'Sign-in page',
    description: 'render an HTML login form.',
    shapeClassification: {
      shapes: ['httpApi'],
      reason: 'operatorOverride',
      classifiedAt: '2026-07-30T10:00:00.000Z',
      operatorOverride: {
        originalShapes: ['webUi', 'auth'],
        newShapes: ['httpApi'],
        reason: 'the auth surface is API-only per the platform contract, drop the UI shapes.',
        ackAt: '2026-07-30T10:00:00.000Z',
      },
    },
  };
  const fresh = classifyReq(req, { now: FIXED_NOW });
  const merged = mergeClassificationOntoReq(req, fresh);
  assert.deepEqual(merged.shapeClassification.shapes, ['httpApi']);
  assert.ok(merged.shapeClassification.operatorOverride);
  assert.equal(merged.shapeClassification.operatorOverride.reason.length > 0, true);
});

test('mergeClassificationOntoReq refuses to overwrite a real verdict with content-pending', () => {
  const req = {
    title: 'x',
    description: 'a browser page',
    shapeClassification: {
      shapes: ['webUi'],
      reason: 'keyword-scan',
      classifiedAt: '2026-07-30T10:00:00.000Z',
    },
  };
  const pending = { shapes: [], reason: 'content-pending', classifiedAt: FIXED_NOW.toISOString() };
  const merged = mergeClassificationOntoReq(req, pending);
  assert.equal(merged, req, 'expected the untouched original doc back');
});

test('composeOperatorOverride captures both shape lists and the reason', () => {
  const block = composeOperatorOverride({
    originalShapes: ['webUi', 'auth'],
    newShapes: ['httpApi'],
    reason: 'the auth surface is API-only per the platform contract, drop the UI shapes.',
    now: FIXED_NOW,
  });
  assert.deepEqual(block.shapes, ['httpApi']);
  assert.equal(block.reason, 'operatorOverride');
  assert.equal(block.operatorOverride.reason.length > 0, true);
  assert.equal(block.operatorOverride.ackAt, FIXED_NOW.toISOString());
  assert.deepEqual(block.operatorOverride.originalShapes, ['webUi', 'auth']);
  assert.deepEqual(block.operatorOverride.newShapes, ['httpApi']);
});
