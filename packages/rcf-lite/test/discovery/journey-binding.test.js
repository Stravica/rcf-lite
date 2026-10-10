// DEFINE 2026-10-09 (UX intake gate, REQ-189): test declarations for US-18906, one per
// acceptance criterion, flagged todo until the owning FBS (FBS-215) builds them. The strict
// coverage audit binds each criterion to its declaration. Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('AC-18906-1 happy: an fbs whose journeystepids all resolve to steps', { todo: 'built by FBS-215 (US-18906)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-18906-2 happy: a light or central product', { todo: 'built by FBS-215 (US-18906)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-18906-3 happy: rcf build review on a light or central product', { todo: 'built by FBS-215 (US-18906)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-18906-4 failure: an fbs whose journeystepids names an id that res', { todo: 'built by FBS-215 (US-18906)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-18906-5 edge: a step bound to two build specs with executionst', { todo: 'built by FBS-215 (US-18906)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});

test('AC-18906-6 must-not: journeystepids on any fbs', { todo: 'built by FBS-215 (US-18906)' }, () => {
  assert.fail('DEFINE declaration: not built yet');
});
