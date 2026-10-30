// Builder hygiene test (FBS-242, the stage-keeper's rulings D3 and C1): rcf
// audit test-strength places a strip-mode refusal or a TypeScript syntax
// error at the position node:module's stripTypeScriptTypes gives in its
// error's stack (src/audit/test-strength/source.js diagnosticAt): a
// ":<line>" first line and a caret line under the construct. This pins
// that shape on the engine floor (package.json engines). It tests code
// hygiene only, is bound to no test case, and sits outside the RCF suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { diagnosticAt, diagnosticLine, sourceColumn } from '../../src/audit/test-strength/source.js';

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

test('hygiene: an invalid-syntax error carries its line and column in the stack', () => {
  const err = refusal('export function run(n: number): number {\n  const a = n;\n  const b = ;\n  return a;\n}\n');
  assert.equal(err?.code, 'ERR_INVALID_TYPESCRIPT_SYNTAX');
  assert.deepEqual(diagnosticAt(err), { line: 3, col: 13 });
});

test('hygiene: a strip-mode refusal carries the refused construct\'s line and column in the stack', () => {
  const err = refusal('declare enum A { X }\nexport enum B { Y }\n');
  assert.equal(err?.code, 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
  assert.deepEqual(diagnosticAt(err), { line: 2, col: 8 });
});

test('hygiene: an error with no position in its stack reads null', () => {
  assert.equal(diagnosticAt(new Error('no position')), null);
  assert.equal(diagnosticAt(undefined), null);
});

// Round D fix round 2 (the stage-keeper's rulings on R-1 and R-3).
test('hygiene: node prints a tab to the next stop of four in its caret line, and diagnosticAt given the text counts the source line with a tab as one', () => {
  const text = 'export class Ledger {\n\tprivate x = 1;\n\tconstructor(private y: number) {}\n}\n';
  const err = refusal(text);
  assert.equal(err?.code, 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
  assert.deepEqual(diagnosticAt(err), { line: 3, col: 25 });
  assert.deepEqual(diagnosticAt(err, text), { line: 3, col: 22 });
  assert.equal(sourceColumn('const q = 1;\tconst b = ;', 26), 24);
  assert.equal(sourceColumn(' \t constructor(private y', 25), 24);
  assert.equal(sourceColumn('const s = \'漢\';\tconst b = ;', 26), 26);
});

test('hygiene: an input ending inside a brace gives a line and no caret: diagnosticLine reads it, diagnosticAt reads null', () => {
  const err = refusal('export function run(n: number): number {\n  const a = n;\n  if (a) {\n    return a;\n');
  assert.equal(err?.code, 'ERR_INVALID_TYPESCRIPT_SYNTAX');
  assert.equal(diagnosticLine(err), 4);
  assert.equal(diagnosticAt(err), null);
  assert.equal(diagnosticLine(new Error('no position')), null);
});
