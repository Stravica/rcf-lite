// Builder hygiene test (FBS-242, the stage-keeper's ruling F14): rcf
// audit test-strength reads .ts, .tsx and .vue files through
// node:module's experimental stripTypeScriptTypes in strip mode
// (src/audit/test-strength/source.js), splicing its rewrites into the
// original file at the offsets of the stripped view. This pins that API
// on the engine floor (package.json engines): Node strips types, and a
// strip-mode result is as long as its input. It tests code hygiene
// only, is bound to no test case, and sits outside the RCF suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';

test('hygiene: process.features.typescript is "strip" on the engine floor', () => {
  assert.equal(process.features.typescript, 'strip');
});

test('hygiene: a strip-mode stripTypeScriptTypes returns text of the same length as its input', () => {
  const input = [
    "import type { Item } from './item.ts';",
    'export interface Total { readonly sum: number }',
    'export function sumTotals<T extends Item>(items: T[], start: number = 0): number {',
    '  let total: number = start;',
    '  for (const n of items as T[]) total += n.price!;',
    '  return total;',
    '}',
    '',
  ].join('\n');
  const out = stripTypeScriptTypes(input, { mode: 'strip' });
  assert.equal(out.length, input.length);
  assert.equal(out.split('\n').length, input.split('\n').length);
  assert.ok(out.includes('export function sumTotals'), out);
  assert.ok(!out.includes('interface'), out);
});
