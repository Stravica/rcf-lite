import { test } from 'node:test';
import assert from 'node:assert/strict';

import { documentIdOf, idFieldFor, knownKinds, validateDocument } from '../../src/store/validator.js';

test('knownKinds covers every Phase 3 schema', () => {
  const kinds = knownKinds();
  for (const k of ['manifest', 'prd', 'req', 'userStory', 'tad', 'tac', 'adr', 'buildSequence', 'fbs', 'testSuite']) {
    assert.ok(kinds.includes(k), `missing kind ${k}`);
  }
});

test('idFieldFor returns the schema id property name', () => {
  assert.equal(idFieldFor('prd'), 'prdId');
  assert.equal(idFieldFor('userStory'), 'usId');
  assert.equal(idFieldFor('buildSequence'), 'bsId');
  assert.equal(idFieldFor('manifest'), null);
});

test('idFieldFor rejects unknown kinds', () => {
  assert.throws(() => idFieldFor('mystery'), TypeError);
});

test('documentIdOf reads the right field per kind', () => {
  assert.equal(documentIdOf({ reqId: 'REQ-001' }, 'req'), 'REQ-001');
  assert.equal(documentIdOf({}, 'req'), null);
  assert.equal(documentIdOf({ projectName: 'x' }, 'manifest'), null);
});

test('validateDocument returns null for a valid PRD', () => {
  const prd = {
    prdId: 'PRD-001',
    productName: 'Acme',
    version: '0.1.0',
    status: 'draft',
    problemStatement: 'something',
    objectives: ['one'],
    requirementIds: ['REQ-001'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  assert.equal(validateDocument({ doc: prd, kind: 'prd' }), null);
});

test('validateDocument returns a validation error for an invalid PRD', () => {
  const prd = {
    prdId: 'BAD-1',
    productName: 'Acme',
    version: '0.1.0',
    status: 'draft',
    problemStatement: 'x',
    objectives: ['one'],
    requirementIds: ['REQ-001'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const err = validateDocument({ doc: prd, kind: 'prd' });
  assert.ok(err);
  assert.equal(err.kind, 'validation');
  assert.match(err.field ?? '', /prdId/);
});

test('validateDocument reports unknown kinds as validation errors', () => {
  const err = validateDocument({ doc: {}, kind: 'mystery' });
  assert.ok(err);
  assert.equal(err.kind, 'validation');
  assert.match(err.message, /Unknown document kind/);
});

test('validateDocument propagates filePath into the error', () => {
  const us = { usId: 'US-101' };
  const err = validateDocument({ doc: us, kind: 'userStory', filePath: 'rcf/user-stories/us-101.json' });
  assert.ok(err);
  assert.equal(err.filePath, 'rcf/user-stories/us-101.json');
});

test('validateDocument re-validates the registered schema (no drift)', () => {
  // Two passes use the cached compiled validator.
  const req = {
    reqId: 'REQ-001',
    prdId: 'PRD-001',
    title: 't',
    description: 'd',
    category: 'functional',
    domain: 'core',
    priority: 'must',
    version: '0.1.0',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  assert.equal(validateDocument({ doc: req, kind: 'req' }), null);
  assert.equal(validateDocument({ doc: req, kind: 'req' }), null);
});
