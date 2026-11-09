import { test } from 'node:test';
import assert from 'node:assert/strict';
import { python } from './_harness/python.mjs';

test('summarise counts every word it is given', () => {
  const r = python(['import json', 'from report import summarise', 'print(json.dumps(summarise(["b", "a", "b"]), sort_keys=True))']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { a: 1, b: 2 });
});
