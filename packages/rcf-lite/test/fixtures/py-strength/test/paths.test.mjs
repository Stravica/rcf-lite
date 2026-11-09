import { test } from 'node:test';
import assert from 'node:assert/strict';
import { python } from './_harness/python.mjs';

test('canonical collapses repeated slashes and drops a trailing slash', () => {
  const r = python(['from paths import canonical', 'print(canonical("a//b/"))']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '/a/b\n');
});

test('warm remembers the canonical form of every path', () => {
  const r = python([
    'import json',
    'from paths import CACHE, warm',
    'n = warm(["a//b", "c/"])',
    'print(json.dumps({"n": n, "cache": CACHE}, sort_keys=True))',
  ]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { n: 2, cache: { 'a//b': '/a/b', 'c/': '/c' } });
});
