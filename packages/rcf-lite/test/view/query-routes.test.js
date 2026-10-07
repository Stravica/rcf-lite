// DEFINE 2026-10-07 (discovery-viewer-command-page): test declarations for the
// command page, one per acceptance criterion, flagged todo until the owning FBS
// builds them. The strict coverage audit binds each criterion to its declaration.
// Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('AC-208-1 happy: a running viewer and a known id', { todo: 'built by FBS-207 (US-208)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-208-2 happy: a running viewer and a known id', { todo: 'built by FBS-207 (US-208)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-208-3 happy: a running viewer', { todo: 'built by FBS-207 (US-208)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-208-4 failure: an unknown id', { todo: 'built by FBS-207 (US-208)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-208-5 must-not: any request to the three routes', { todo: 'built by FBS-207 (US-208)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-208-6 edge: a rewalk that publishes a new stateversion', { todo: 'built by FBS-207 (US-208)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-208-7 failure: the server before the first walk completes', { todo: 'built by FBS-207 (US-208)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});
