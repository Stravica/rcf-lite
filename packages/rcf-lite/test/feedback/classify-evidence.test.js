// Issue #245 (0.28.3): --evidence pointers must render with the label
// matching their shape, not always "(command)". The classifier is
// exported from src/cli/feedback.js and used by feedback add / preview
// / submit to stamp the { kind, value } shape on each evidence entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyEvidence } from '../../src/cli/feedback.js';

test('issue #245: a bare RCF id classifies as id', () => {
  assert.deepEqual(classifyEvidence('AC-15601-6'), { kind: 'id', value: 'AC-15601-6' });
  assert.deepEqual(classifyEvidence('REQ-155'), { kind: 'id', value: 'REQ-155' });
  assert.deepEqual(classifyEvidence('FBS-181'), { kind: 'id', value: 'FBS-181' });
  assert.deepEqual(classifyEvidence('US-15701'), { kind: 'id', value: 'US-15701' });
});

test('issue #245: a path:line pointer classifies as file', () => {
  assert.deepEqual(
    classifyEvidence('packages/rcf-lite/src/feedback/redact.js:492'),
    { kind: 'file', value: 'packages/rcf-lite/src/feedback/redact.js:492' },
  );
  assert.deepEqual(classifyEvidence('a.js:1'), { kind: 'file', value: 'a.js:1' });
});

test('issue #245: a bare filesystem path with a known extension classifies as file (Dex\'s WSD case)', () => {
  // The exact evidence pointer Dex hit on 0.28.2 that rendered as
  // "(command)" despite being a plain path to a library manifest.
  assert.deepEqual(
    classifyEvidence('rcf/.blueprint-libraries/wsd/1.0.0/library.json'),
    { kind: 'file', value: 'rcf/.blueprint-libraries/wsd/1.0.0/library.json' },
  );
  assert.equal(classifyEvidence('/abs/path/to/README.md').kind, 'file');
  assert.equal(classifyEvidence('CHANGELOG.md').kind, 'file');
  assert.equal(classifyEvidence('config.yml').kind, 'file');
  assert.equal(classifyEvidence('backslash\\path\\file.log').kind, 'file');
});

test('issue #245: a shell verb invocation classifies as command', () => {
  assert.deepEqual(
    classifyEvidence('rcf feedback preview'),
    { kind: 'command', value: 'rcf feedback preview' },
  );
  assert.equal(classifyEvidence('pnpm --filter rcf-lite test').kind, 'command');
  assert.equal(classifyEvidence('git status').kind, 'command');
});

test('issue #245: a whitespace-bearing pathish string falls back to command (safety default)', () => {
  // A token with whitespace is almost never a real file path; treat
  // as command so the operator sees the shape they typed.
  assert.equal(classifyEvidence('has spaces/file.json').kind, 'command');
});

test('issue #245: a bare token without a known extension classifies as command', () => {
  assert.equal(classifyEvidence('nothing-special').kind, 'command');
  assert.equal(classifyEvidence('README').kind, 'command');
});

test('issue #245: empty or non-string input classifies as command (never throws)', () => {
  assert.equal(classifyEvidence('').kind, 'command');
  assert.equal(classifyEvidence(null).kind, 'command');
  assert.equal(classifyEvidence(undefined).kind, 'command');
});
