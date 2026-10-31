// Builder hygiene test (FBS-242, the stage-keeper's rulings 1 to 3 on the
// design review, and the rulings on re-Review 3 and on the position
// oracle): rcf audit test-strength turns an offset into <line>:<col>
// through one conversion (src/audit/test-strength/source.js positionOf:
// CRLF, a lone CR and LF are line breaks, the column counts UTF-16 code
// units), takes node:module's strip-mode refusal at node's line and the
// offset whose width, measured by node's own renderer, equals node's
// caret, places an input that ends inside a construct where the innermost
// one still open opens, and one that ends with nothing open at node's
// line, column 1. A position node gives that the audit cannot check reads
// node's display column with one stderr line saying so. This pins those
// rules and the error shape it reads on the engine floor (package.json
// engines). It tests code hygiene only, is bound to no test case, and
// sits outside the RCF suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { positionOf, refusalDetail, sourceView } from '../../src/audit/test-strength/source.js';

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
  assert.equal(v.warn, undefined, `the position node gave is checked\n${v.detail}\n${v.warn}`);
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

test('hygiene: node\'s caret, its width measured by node, places the refusal at the UTF-16 column whatever precedes it on the line', () => {
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

test('hygiene: a refusal node gives a caret for is placed where node places it, a character node\'s renderer draws with no width included', () => {
  assert.equal(at('export const a = \u0301;'), '1:18');
  assert.equal(at('export const a = 1; \u200d const b = 2;'), '1:21');
  assert.equal(at('export const a = \u0663;'), '1:18');
  assert.equal(at('\u00fc: \u00fc: while (true) break;'), '1:4');
  assert.equal(at('export const b =\f\u0301;'), '1:18', 'a tie of widths goes to the offset node refuses a marker at');
});

test('hygiene: an input that ends with nothing open is placed at the line node names, column 1', () => {
  assert.equal(at('export const a = 1;\nexport const b =\n'), '2:1');
  assert.equal(at('export const a = 1 +'), '1:1');
  assert.equal(at('export const a = 1;\nexport const b =\n\n'), '3:1', 'node names the trailing blank line');
});

test('hygiene: a position node gives that the audit cannot check reads node\'s line and its caret plus 1, with one stderr line saying so', () => {
  const err = { code: 'ERR_INVALID_TYPESCRIPT_SYNTAX', message: 'Expression expected', stack: ':1\nabc\n          ^' };
  assert.deepEqual(refusalDetail('src/a.ts', 'abc', 'abc', err), {
    ok: false,
    detail: 'src/a.ts:1:11: invalid TypeScript syntax (Expression expected)',
    warn: "test-strength: column for src/a.ts:1 is node's display column (position check withheld: no offset has the width of the caret)",
  });
});
