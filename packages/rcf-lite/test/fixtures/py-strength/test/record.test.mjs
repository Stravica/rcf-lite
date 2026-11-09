// A deliberately weak test: it shows that record runs and nothing more,
// so a record whose body is pass passes it too (the surviving noOp case).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { python } from './_harness/python.mjs';

test('record runs without an error', () => {
  const r = python(['from paths import record', 'record([], "a//b")']);
  assert.equal(r.code, 0, r.stderr);
});
