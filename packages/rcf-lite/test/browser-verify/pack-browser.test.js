// Unit tests for the parts of pack-browser that do not touch the
// Playwright MCP process itself. The MCP + browser end-to-end path is
// covered by the live pack run captured in the PR body.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseEvaluateResult } from '../../src/browser-verify/pack-browser.js';

test('parseEvaluateResult returns a parsed JSON value when the MCP block ends with Result: <json>', () => {
  const text = '- Ran Playwright code:\n```js\n() => 42\n```\n- Result:\n```json\n{"count":3,"names":["a","b"]}\n```';
  const out = parseEvaluateResult(text);
  assert.deepEqual(out, { count: 3, names: ['a', 'b'] });
});

test('parseEvaluateResult tolerates plain string tails when no fenced block wraps the result', () => {
  const text = '- Ran Playwright code:\n() => document.title\n- Result: "Grid"';
  const out = parseEvaluateResult(text);
  assert.equal(out, 'Grid');
});

test('parseEvaluateResult falls back to the raw tail when the value is neither JSON nor quoted', () => {
  const text = '- Ran Playwright code:\n... \n- Result: nothing-quoteable';
  const out = parseEvaluateResult(text);
  assert.equal(out, 'nothing-quoteable');
});

test('parseEvaluateResult treats a non-string input as a passthrough (defensive)', () => {
  const value = { verdict: 'pass' };
  assert.strictEqual(parseEvaluateResult(value), value);
});
