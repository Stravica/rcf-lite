// Builder hygiene test (FBS-242, the stage-keeper's rulings 1 to 3 on the
// design review): rcf audit test-strength turns an offset into
// <line>:<col> through one conversion (src/audit/test-strength/source.js
// positionOf: CRLF, a lone CR and LF are line breaks, the column counts
// UTF-16 code units), reads node:module's strip-mode caret in a
// width-neutral shadow of the file, and places an input that ends inside
// a construct where the innermost one still open opens. This pins those
// rules and the error shape the shadow reads on the engine floor
// (package.json engines). It tests code hygiene only, is bound to no test
// case, and sits outside the RCF suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { positionOf, sourceView } from '../../src/audit/test-strength/source.js';

function refusal(text) {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    stripTypeScriptTypes(text, { mode: 'strip' });
  } catch (err) {
    return err;
  } finally {
    process.emitWarning = emit;
  }
  return null;
}

const at = (text) => {
  const v = sourceView('src/a.ts', text);
  assert.equal(v.ok, false, 'the strip view refuses the input');
  assert.notEqual(v.unplaced, true, `the refusal is placed\n${v.detail}`);
  return /^src\/a\.ts:(\d+:\d+): /.exec(v.detail)?.[1];
};

test('hygiene: positionOf counts CRLF, a lone CR and LF as one line break each, and UTF-16 code units for the column', () => {
  assert.deepEqual(positionOf('ab', 0), { line: 1, col: 1 });
  assert.deepEqual(positionOf('a\r\nb\rc\nd', 7), { line: 4, col: 1 });
  assert.deepEqual(positionOf('a\r\nb', 2), { line: 1, col: 3 }, 'a CRLF not wholly before the offset is no break');
  assert.deepEqual(positionOf('a b c\vd\fe', 8), { line: 1, col: 9 }, 'U+2028, U+2029, VT and FF are not line breaks');
  assert.deepEqual(positionOf('﻿\tกั\u{1F600}x', 6), { line: 1, col: 7 }, 'a BOM, a tab, a combining mark one unit each, an astral character two');
});

test('hygiene: node\'s strip-mode error carries ":<line>" first and a caret line under the line it prints, and no caret when the input ends inside a construct', () => {
  const err = refusal('export function run(n: number): number {\n  const a = n;\n  const b = ;\n  return a;\n}\n');
  assert.equal(err?.code, 'ERR_INVALID_TYPESCRIPT_SYNTAX');
  const lines = err.stack.split('\n');
  assert.equal(lines[0], ':3');
  const caret = lines.findIndex((l, i) => i > 1 && /^\s*\^+\s*$/.test(l));
  assert.equal(lines[caret - 1], '  const b = ;', 'the line above the caret line is the source line as written');
  assert.equal(lines[caret].indexOf('^'), 12);
  const open = refusal('export function run(n: number): number {\n  if (n) {\n');
  assert.equal(open?.code, 'ERR_INVALID_TYPESCRIPT_SYNTAX');
  assert.match(open.stack.split('\n')[0], /^:\d+$/);
  assert.equal(open.stack.split('\n').some((l) => /^\s*\^+\s*$/.test(l)), false);
});

test('hygiene: the shadow places node\'s caret at the UTF-16 column whatever precedes it on the line', () => {
  assert.equal(at("export const s = '✅'; const b = ;\n"), '1:33');
  assert.equal(at("export const s = 'กั'; const b = ;\n"), '1:34');
  assert.equal(at("export const s = '\u{1F600}'; const b = ;\n"), '1:34');
  assert.equal(at('﻿export const b = ;\n'), '1:19');
  assert.equal(at('export const a = 1;\fconst b = ;\n'), '1:31');
  assert.equal(at('export const a = 1;\r\texport const c = 2;\r\tconst b = ;\r'), '3:12');
  assert.equal(at('export class L {\n\tconstructor(private y: number) {}\n}\n'), '2:22');
});

test('hygiene: an input that ends inside a construct is placed where the innermost one still open opens', () => {
  assert.equal(at('export function run(n: number): number {\n  const a = n;\n  if (a) {\n    return a;\n'), '3:10');
  assert.equal(at('x;\nexport const t = `abc ${a}\nmore\n'), '2:18');
  assert.equal(at('x;\n/* open\nmore\n'), '2:1');
  assert.equal(at('export const t = `a ${[1, 2\n'), '1:23');
});
