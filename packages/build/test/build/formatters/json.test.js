// Formatter tests for the D14 JSON envelopes (Phase 6 §D14, §3.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatJson } from '../../../src/build/formatters/json.js';

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, keys);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      collectKeys(v, keys);
    }
  }
  return keys;
}

test('queue envelope: ok + mode precede the queue result keys', () => {
  const out = formatJson({
    bs: { bsId: 'BS-001', title: 'Plan', generationStrategy: 'dependencyFirst' },
    totals: { items: 0 },
    nextActionable: null,
    items: [],
  }, 'queue');
  const body = JSON.parse(out);
  assert.deepEqual(Object.keys(body), ['ok', 'mode', 'bs', 'totals', 'nextActionable', 'items']);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'queue');
});

test('bundle envelope carries mode bundle and the completionContract strings', () => {
  const out = formatJson({
    fbs: { fbsId: 'FBS-005' },
    completionContract: {
      markInProgress: 'rcf build FBS-005 --mark inProgress',
      markComplete: 'rcf build FBS-005 --mark complete',
      markVerified: 'rcf build FBS-005 --mark verified',
    },
  }, 'bundle');
  const body = JSON.parse(out);
  assert.equal(body.mode, 'bundle');
  assert.equal(body.completionContract.markComplete, 'rcf build FBS-005 --mark complete');
});

test('next-mode empty envelope: queueEmpty / totals / blocked / inProgress', () => {
  const out = formatJson({
    queueEmpty: false,
    totals: { items: 2 },
    blocked: ['FBS-002'],
    inProgress: ['FBS-001'],
  }, 'next');
  const body = JSON.parse(out);
  assert.deepEqual(Object.keys(body), ['ok', 'mode', 'queueEmpty', 'totals', 'blocked', 'inProgress']);
  assert.equal(body.mode, 'next');
  assert.deepEqual(body.blocked, ['FBS-002']);
});

test('every key in every envelope is camelCase (D17)', () => {
  const envelope = formatJson({
    fbs: { fbsId: 'FBS-001', executionStatus: 'notStarted' },
    blockedBy: [],
    context: {
      tadSections: {},
      unresolvedSections: [],
      passThrough: { existingModules: [], schemas: [], externalDocs: [], other: [] },
    },
    tests: [{ acId: 'AC-101-1', covered: false, suites: [], cases: [] }],
  }, 'bundle');
  const keys = collectKeys(JSON.parse(envelope));
  for (const key of keys) {
    assert.match(key, CAMEL_CASE, `key ${key} is not camelCase`);
  }
});

test('unresolvedSections carried through in the context block', () => {
  const out = formatJson({
    context: { unresolvedSections: ['ghost'] },
  }, 'bundle');
  assert.deepEqual(JSON.parse(out).context.unresolvedSections, ['ghost']);
});

test('serialisation is two-space stable and ends with a newline', () => {
  const out = formatJson({ items: [] }, 'queue');
  assert.equal(out.endsWith('\n'), true);
  assert.equal(out, formatJson({ items: [] }, 'queue'));
});
