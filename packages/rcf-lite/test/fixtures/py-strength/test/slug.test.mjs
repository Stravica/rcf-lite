import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug } from '../src/slug.js';

test('slug joins the lower-cased words with hyphens', () => {
  assert.equal(slug('  Hello World '), 'hello-world');
});
