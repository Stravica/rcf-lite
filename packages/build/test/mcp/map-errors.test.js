// D10 / D11 error-mapping tests: every D10 row that terminates in a
// tool execution error, plus the two data-not-error rows exercised
// through the tool handlers in tools.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rcfError } from '../../src/errors/index.js';
import {
  errorResult,
  issueFromRcfError,
  issuesFromErrors,
  unexpectedFailureResult,
  usageErrorResult,
  walkerBlockedResult,
  writerErrorResult,
} from '../../src/mcp/map-errors.js';

const silentLog = { info: () => {}, error: () => {} };

test('issueFromRcfError maps to the validate --json issue shape with nullable fields', () => {
  const full = issueFromRcfError(rcfError({
    kind: 'brokenReference',
    message: 'dangling ref',
    documentId: 'REQ-001',
    filePath: 'rcf/requirements/req-001.json',
    field: 'prdId',
    rule: 'resolveTo:prd',
  }));
  assert.deepEqual(full, {
    id: 'REQ-001',
    kind: 'brokenReference',
    rule: 'resolveTo:prd',
    filePath: 'rcf/requirements/req-001.json',
    field: 'prdId',
    message: 'dangling ref',
  });
  const sparse = issueFromRcfError(rcfError({ kind: 'usage', message: 'nope' }));
  assert.deepEqual(sparse, { id: null, kind: 'usage', rule: null, filePath: null, field: null, message: 'nope' });
});

test('errorResult carries isError, the D11 payload and a human-readable text block', () => {
  const result = errorResult([rcfError({ kind: 'usage', message: 'id X not found', documentId: 'X' })]);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.errors.length, 1);
  assert.equal(result.structuredContent.errors[0].message, 'id X not found');
  assert.equal(result.content[0].type, 'text');
  assert.match(result.content[0].text, /usage/);
  assert.match(result.content[0].text, /id X not found/);
});

test('usageErrorResult is a one-element errors array (single-cause errors per D11)', () => {
  const result = usageErrorResult('trace: id NOPE-1 not found', { documentId: 'NOPE-1' });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.errors.length, 1);
  assert.equal(result.structuredContent.errors[0].kind, 'usage');
  assert.equal(result.structuredContent.errors[0].id, 'NOPE-1');
});

test('walkerBlockedResult carries the full issues array (the agent fixes the tree next)', () => {
  const errors = [
    rcfError({ kind: 'validation', message: 'bad field', documentId: 'US-101' }),
    rcfError({ kind: 'brokenReference', message: 'dangling', documentId: 'REQ-001' }),
  ];
  const result = walkerBlockedResult(errors);
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent.errors, issuesFromErrors(errors));
});

test('unexpectedFailureResult keeps the stack out of model context and routes it to stderr', () => {
  const stderrLines = [];
  const log = { info: () => {}, error: (l) => stderrLines.push(l) };
  const err = rcfError({ kind: 'ioFailure', message: 'write failed: disk full', stack: 'Error: disk full\n    at fake.js:1' });
  const result = unexpectedFailureResult(err, log);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.errors[0].message, 'write failed: disk full');
  assert.equal(JSON.stringify(result).includes('fake.js'), false, 'stack never enters the result');
  assert.equal(stderrLines.length, 1);
  assert.match(stderrLines[0], /fake\.js/);
});

test('writerErrorResult routes ioFailure through the unexpected-failure path', () => {
  const stderrLines = [];
  const log = { info: () => {}, error: (l) => stderrLines.push(l) };
  const result = writerErrorResult(
    rcfError({ kind: 'ioFailure', message: 'unlink failed', stack: 'Error\n    at x.js:1' }),
    log,
  );
  assert.equal(result.isError, true);
  assert.equal(stderrLines.length, 1);
});

test('writerErrorResult maps a dependents refusal to an actionable message naming the cascade remedy', () => {
  const result = writerErrorResult(
    rcfError({
      kind: 'usage',
      message: 'delete: REQ-001 has dependents (childUs=US-101); pass --cascade to opt in',
      documentId: 'REQ-001',
      rule: 'dependents',
    }),
    silentLog,
  );
  assert.equal(result.isError, true);
  assert.match(result.structuredContent.errors[0].message, /US-101/);
  assert.match(result.structuredContent.errors[0].message, /cascade: true/);
  assert.equal(result.structuredContent.errors[0].rule, 'dependents');
});

test('writerErrorResult passes plain validation / brokenReference errors through with the D11 payload', () => {
  const result = writerErrorResult(
    rcfError({ kind: 'validation', message: 'schema says no', documentId: 'US-101', field: 'title' }),
    silentLog,
  );
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent.errors[0], {
    id: 'US-101', kind: 'validation', rule: null, filePath: null, field: 'title', message: 'schema says no',
  });
});
