import { test } from 'node:test';
import assert from 'node:assert/strict';
import { python } from './_harness/python.mjs';

test('lookup returns the value of a key', () => {
  const r = python(['from config import Config', 'print(Config({"a": 1}).lookup("a"))']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '1\n');
});

test('from_text reads a JSON object', () => {
  const r = python(['from config import Config', 'c = Config.from_text(\'{"a": 2, "b": 3}\')', 'print(c.lookup("a"), c.lookup("b"))']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '2 3\n');
});

test('fetch returns the value of a key from the event loop', () => {
  const r = python(['import asyncio', 'from config import Config', 'print(asyncio.run(Config({"k": "v"}).fetch("k")))']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'v\n');
});
