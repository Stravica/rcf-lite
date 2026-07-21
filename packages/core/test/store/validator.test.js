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
  // Post-3.7 the Test Suite schema uses the plain `id` field.
  assert.equal(idFieldFor('testSuite'), 'id');
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

test('validateDocument returns null for a valid PRD (0.2.0 shape: no requirementIds)', () => {
  const prd = {
    prdId: 'PRD-001',
    productName: 'Acme',
    version: '0.1.0',
    status: 'draft',
    problemStatement: 'something',
    objectives: ['one'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  assert.equal(validateDocument({ doc: prd, kind: 'prd' }), null);
});

test('validateDocument rejects the removed requirementIds field on a PRD', () => {
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
  const err = validateDocument({ doc: prd, kind: 'prd' });
  assert.ok(err);
  assert.equal(err.kind, 'validation');
});

test('validateDocument returns a validation error for an invalid PRD', () => {
  const prd = {
    prdId: 'BAD-1',
    productName: 'Acme',
    version: '0.1.0',
    status: 'draft',
    problemStatement: 'x',
    objectives: ['one'],
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

test('validateDocument rejects a REQ that lacks the required prdId (D2 mandatory parent field)', () => {
  const req = {
    reqId: 'REQ-001',
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
  const err = validateDocument({ doc: req, kind: 'req' });
  assert.ok(err);
  assert.equal(err.kind, 'validation');
});

test('validateDocument rejects an FBS that lacks buildOrder (D6)', () => {
  const fbs = {
    fbsId: 'FBS-001',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    executionStatus: 'notStarted',
    title: 't',
    summary: 's',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const err = validateDocument({ doc: fbs, kind: 'fbs' });
  assert.ok(err);
  assert.equal(err.kind, 'validation');
});

test('validateDocument rejects an FBS whose executionStatus is not in the enum (D6)', () => {
  const fbs = {
    fbsId: 'FBS-001',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 1,
    executionStatus: 'in-progress',
    title: 't',
    summary: 's',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const err = validateDocument({ doc: fbs, kind: 'fbs' });
  assert.ok(err);
  assert.equal(err.kind, 'validation');
});

test('validateDocument accepts an ADR with status "draft" (D2 status enum extension)', () => {
  const adr = {
    adrId: 'ADR-001',
    prdId: 'PRD-001',
    tadId: 'TAD-001',
    version: '0.1.0',
    status: 'draft',
    title: 't',
    context: 'c',
    decision: 'd',
    consequences: 'q',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  assert.equal(validateDocument({ doc: adr, kind: 'adr' }), null);
});

test('validateDocument rejects a TS with an empty acIds list (D9 minItems: 1)', () => {
  const ts = {
    id: 'TS-001',
    usId: 'US-101',
    title: 't',
    purpose: 'p',
    testLevel: 'unit',
    acIds: [],
    testCases: [],
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const err = validateDocument({ doc: ts, kind: 'testSuite' });
  assert.ok(err);
  assert.equal(err.kind, 'validation');
});

test('validateDocument rejects a TS with an invalid testLevel (D9 enum)', () => {
  const ts = {
    id: 'TS-001',
    usId: 'US-101',
    title: 't',
    purpose: 'p',
    testLevel: 'perf',
    acIds: ['AC-101-1'],
    testCases: [],
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const err = validateDocument({ doc: ts, kind: 'testSuite' });
  assert.ok(err);
  assert.equal(err.kind, 'validation');
});

test('validateDocument rejects a TC with an id violating the TC-<TS>-<slug> pattern (D10)', () => {
  const ts = {
    id: 'TS-001',
    usId: 'US-101',
    title: 't',
    purpose: 'p',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    testCases: [
      { id: 'BAD_ID', acId: 'AC-101-1', description: 'x', status: 'pending' },
    ],
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const err = validateDocument({ doc: ts, kind: 'testSuite' });
  assert.ok(err);
  assert.equal(err.kind, 'validation');
});

test('validateDocument accepts the new test-suite shape (id field, inline testCases)', () => {
  const ts = {
    id: 'TS-001',
    usId: 'US-101',
    title: 'Loader smoke',
    purpose: 'Cover AC-101-1',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    testCases: [
      { id: 'TC-001-happy-path', acId: 'AC-101-1', description: 'happy', status: 'pending' },
    ],
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  assert.equal(validateDocument({ doc: ts, kind: 'testSuite' }), null);
});
