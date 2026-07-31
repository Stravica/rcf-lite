// Interactive / non-interactive session tests (spec §5.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normaliseNonInteractiveInput, runInteractiveSession } from '../../src/ui-baseline/session.js';

test('normaliseNonInteractiveInput accepts an empty input as full acceptance', () => {
  const out = normaliseNonInteractiveInput({});
  assert.deepEqual(out, { optOuts: [], overrides: {} });
});

test('normaliseNonInteractiveInput accepts opt-outs on known fields with 20+ char reasons', () => {
  const out = normaliseNonInteractiveInput({
    optOuts: [
      { field: 'themeMode', reason: 'kiosk-only build across the estate, no toggle required' },
    ],
    overrides: { 'themeMode': 'single-theme-declared' },
  });
  assert.equal(out.optOuts.length, 1);
  assert.equal(out.optOuts[0].field, 'themeMode');
  assert.equal(out.overrides.themeMode, 'single-theme-declared');
});

test('normaliseNonInteractiveInput refuses opt-outs whose reason is under 20 chars', () => {
  assert.throws(() => normaliseNonInteractiveInput({
    optOuts: [{ field: 'themeMode', reason: 'no toggle' }],
  }), /at least 20 characters/);
});

test('normaliseNonInteractiveInput refuses unknown fields', () => {
  assert.throws(() => normaliseNonInteractiveInput({
    optOuts: [{ field: 'made.up.field', reason: 'a legitimate twenty-plus reason string' }],
  }), /unknown field/);
  assert.throws(() => normaliseNonInteractiveInput({
    overrides: { 'not.real': true },
  }), /unknown field/);
});

test('normaliseNonInteractiveInput strips a leading `defaults.` prefix on field names', () => {
  const out = normaliseNonInteractiveInput({
    optOuts: [{ field: 'defaults.themeMode', reason: 'a legitimate twenty-plus reason string here' }],
    overrides: { 'defaults.themeMode': 'single-theme-declared' },
  });
  assert.equal(out.optOuts[0].field, 'themeMode');
  assert.equal(out.overrides.themeMode, 'single-theme-declared');
});

test('runInteractiveSession commits on ENTER (empty answer) with no opt-outs', async () => {
  const lines = [];
  const write = (line) => lines.push(line);
  const answers = ['']; // press ENTER to accept all
  let idx = 0;
  const prompt = async () => answers[idx++];
  const out = await runInteractiveSession({ prompt, write });
  assert.deepEqual(out.optOuts, []);
  // Summary rendered before the prompt.
  assert.ok(lines.some((l) => l.includes('themeMode')));
});

test('runInteractiveSession records an opt-out via `opt-out <reason>`', async () => {
  const lines = [];
  const write = (line) => lines.push(line);
  const answers = [
    'themeMode',
    'opt-out kiosk-only build across the estate, no toggle required',
    '', // accept remaining defaults
  ];
  let idx = 0;
  const prompt = async () => answers[idx++];
  const out = await runInteractiveSession({ prompt, write });
  assert.equal(out.optOuts.length, 1);
  assert.equal(out.optOuts[0].field, 'themeMode');
  assert.match(out.optOuts[0].reason, /kiosk-only/);
});

test('runInteractiveSession refuses opt-out reasons under 20 characters and keeps the state', async () => {
  const lines = [];
  const write = (line) => lines.push(line);
  const answers = [
    'themeMode',
    'opt-out short',
    '', // accept
  ];
  let idx = 0;
  const prompt = async () => answers[idx++];
  const out = await runInteractiveSession({ prompt, write });
  assert.equal(out.optOuts.length, 0);
  assert.ok(lines.some((l) => l.includes('at least 20 characters')));
});

test('runInteractiveSession cancels via `cancel` and throws with the operator-cancel message', async () => {
  const lines = [];
  const write = (line) => lines.push(line);
  const answers = ['cancel'];
  let idx = 0;
  const prompt = async () => answers[idx++];
  await assert.rejects(runInteractiveSession({ prompt, write }), /session cancelled by operator/);
});

test('runInteractiveSession seeds overrides from the preflight seam', async () => {
  const lines = [];
  const write = (line) => lines.push(line);
  const prompt = async () => ''; // accept
  const out = await runInteractiveSession({
    prompt, write,
    preflightOverrides: { 'authFlow.htmlLoginPageRequired': false },
  });
  assert.equal(out.overrides['authFlow.htmlLoginPageRequired'], false);
});
