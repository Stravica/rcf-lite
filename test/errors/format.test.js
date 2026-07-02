import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatError, formatErrors, isRcfError, rcfError } from '../../src/errors/index.js';

test('rcfError builds a structured error', () => {
  const err = rcfError({
    kind: 'validation',
    message: 'priority does not match enum',
    documentId: 'REQ-002',
    filePath: 'rcf/requirements/req-002.json',
    field: 'priority',
    rule: 'enum',
  });
  assert.equal(err.kind, 'validation');
  assert.equal(err.documentId, 'REQ-002');
  assert.equal(err.filePath, 'rcf/requirements/req-002.json');
  assert.equal(err.field, 'priority');
  assert.equal(err.rule, 'enum');
});

test('rcfError rejects unknown kinds', () => {
  assert.throws(() => rcfError({ kind: 'mystery', message: 'm' }), TypeError);
});

test('rcfError rejects empty message', () => {
  assert.throws(() => rcfError({ kind: 'validation', message: '' }), TypeError);
});

test('rcfError omits optional fields when unset', () => {
  const err = rcfError({ kind: 'usage', message: 'bad flag' });
  assert.equal(err.kind, 'usage');
  assert.equal(err.message, 'bad flag');
  assert.equal('documentId' in err, false);
  assert.equal('filePath' in err, false);
  assert.equal('field' in err, false);
  assert.equal('rule' in err, false);
});

test('isRcfError accepts valid errors', () => {
  const err = rcfError({ kind: 'missingFile', message: 'not there' });
  assert.equal(isRcfError(err), true);
});

test('isRcfError rejects non-objects and unknown kinds', () => {
  assert.equal(isRcfError(null), false);
  assert.equal(isRcfError('x'), false);
  assert.equal(isRcfError({ kind: 'whatever', message: 'x' }), false);
  assert.equal(isRcfError({ kind: 'usage' }), false);
});

test('formatError renders a single-line summary including the document id', () => {
  const err = rcfError({
    kind: 'validation',
    message: 'priority does not match enum',
    documentId: 'REQ-002',
  });
  const line = formatError(err);
  assert.match(line, /\[error\] validation/);
  assert.match(line, /REQ-002/);
  assert.match(line, /priority does not match enum/);
});

test('formatError verbose mode appends field and rule', () => {
  const err = rcfError({
    kind: 'validation',
    message: 'oops',
    documentId: 'REQ-002',
    field: 'priority',
    rule: 'enum',
  });
  const line = formatError(err, { verbose: true });
  assert.match(line, /field=priority/);
  assert.match(line, /rule=enum/);
});

test('formatErrors includes default --strict pointer', () => {
  const errs = [
    rcfError({ kind: 'validation', message: 'a', documentId: 'REQ-001' }),
    rcfError({ kind: 'missingFile', message: 'b', documentId: 'FBS-099' }),
  ];
  const out = formatErrors(errs);
  assert.match(out, /2 errors found/);
  assert.match(out, /Pass --strict/);
});

test('formatErrors strict mode omits the --strict pointer', () => {
  const errs = [rcfError({ kind: 'validation', message: 'a', documentId: 'REQ-001' })];
  const out = formatErrors(errs, { strict: true });
  assert.match(out, /1 error found/);
  assert.doesNotMatch(out, /Pass --strict/);
  assert.match(out, /output not written/);
});

test('formatErrors returns empty string when no errors', () => {
  assert.equal(formatErrors([]), '');
});

test('rcfError accepts brokenReference as a valid kind (D8)', () => {
  const err = rcfError({
    kind: 'brokenReference',
    message: 'REQ REQ-001 references unknown PRD PRD-001',
    documentId: 'REQ-001',
    filePath: 'rcf/requirements/req-001.json',
    field: 'prdId',
    rule: 'resolveTo:prd',
  });
  assert.equal(err.kind, 'brokenReference');
  assert.equal(err.field, 'prdId');
});

test('formatError renders brokenReference errors on stderr with file + field', () => {
  const err = rcfError({
    kind: 'brokenReference',
    message: 'REQ REQ-001 references unknown PRD PRD-999',
    documentId: 'REQ-001',
    filePath: 'rcf/requirements/req-001.json',
    field: 'prdId',
  });
  const line = formatError(err, { verbose: true });
  assert.match(line, /brokenReference/);
  assert.match(line, /REQ-001/);
  assert.match(line, /field=prdId/);
});

test('isRcfError accepts brokenReference kind', () => {
  const err = { kind: 'brokenReference', message: 'x' };
  assert.equal(isRcfError(err), true);
});
