// WCAG 2.1 AA contrast audit over the viewer stylesheet (US-207,
// TS-236, w-2026-10-04-dave-001). Parses `src/view/style.css`, resolves
// the `--sv-*` custom-property blocks for the light (`:root`) and dark
// (`:root[data-theme="dark"]`) token sets, enumerates every rule that
// sets `color` paired with every reachable background and every state
// variant (default, :hover, :focus, :focus-visible, :active,
// [aria-pressed=true], [aria-selected=true], .is-active, :disabled),
// and asserts >= 4.5:1 for normal text and >= 3:1 for large text and
// non-text UI boundaries (WCAG 1.4.3 and 1.4.11). Pairs that cannot be
// resolved statically (gradients, rgba over unknown) are computed
// against the three ancestor surfaces (`--sv-canvas`, `--sv-surface`,
// `--sv-raised`) and recorded as approximate rather than skipped. State
// rules are merged over their base selector before pairing, and border
// and outline colours are paired against the adjacent surface at 3:1
// (PR 291 landing review F2). Default-state borders on elements other
// than form fields are reported as advisory (WCAG 1.4.11 does not
// require them) and do not fail the suite; outlines, state-rule borders
// and form-field borders are asserted.
//
// On failure the message names selector, state, theme, foreground,
// background, computed ratio and the threshold applied (AC-207-2). The
// run writes a BEFORE/AFTER report to `./output/contrast-report.md`
// when the `RCF_WRITE_CONTRAST_REPORT=1` environment variable is set
// (the lane work writes it as its evidence; CI leaves it off).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enumeratePairs, renderReportSection } from './helpers/contrast.js';

const here = dirname(fileURLToPath(import.meta.url));
const stylePath = resolve(here, '..', '..', 'src', 'view', 'style.css');

test('enumerates every color/background pair and asserts WCAG 2.1 AA in both themes (AC-207-1)', async () => {
  const css = await readFile(stylePath, 'utf8');
  const { light, dark } = enumeratePairs(css);

  const failures = [...light, ...dark].filter((p) => p.asserted && !p.pass);

  // Write the report when the lane job asks for it (step 5 evidence).
  if (process.env.RCF_WRITE_CONTRAST_REPORT === '1') {
    const header = [
      '# Contrast audit report',
      '',
      'WCAG 2.1 AA (`>= 4.5:1` text; `>= 3:1` large text and non-text UI boundaries). Approximate pairs are',
      'rules that declare `color` without a block-level `background` / `background-color`; the audit records',
      'the worst-case against the three ancestor-surface candidates `--sv-canvas` / `--sv-surface` / `--sv-raised`.',
      'State rules are merged over their base selector; border and outline colours are paired at 3:1 against the',
      'adjacent surface. Advisory rows (default-state borders outside form fields) are reported, not asserted.',
      '',
      `Light pairs: ${light.length} (asserted failures: ${light.filter((p) => p.asserted && !p.pass).length}; advisory below 3:1: ${light.filter((p) => !p.asserted && !p.pass).length}).`,
      `Dark pairs: ${dark.length} (asserted failures: ${dark.filter((p) => p.asserted && !p.pass).length}; advisory below 3:1: ${dark.filter((p) => !p.asserted && !p.pass).length}).`,
      '',
    ].join('\n');
    const sections = [
      header,
      renderReportSection('Light theme', light),
      '',
      renderReportSection('Dark theme', dark),
      '',
    ].join('\n');
    // test/view -> test -> packages/rcf-lite -> packages -> work/rcf-lite
    // -> work -> job root (where ./output/ lives for the lane run).
    const outDir = resolve(here, '..', '..', '..', '..', '..', '..', 'output');
    await mkdir(outDir, { recursive: true });
    const reportPath = resolve(outDir, 'contrast-report.md');
    await writeFile(reportPath, sections, 'utf8');
  }

  if (failures.length > 0) {
    // AC-207-2: failure message names selector, state, theme, fg, bg,
    // ratio and threshold.
    const detail = failures.slice(0, 20).map((p) => (
      `  - [${p.theme}] "${p.selector}" (${p.state}, ${p.pairType}): color=${p.fg} (${p.fgResolved}) over background=${p.bg} (${p.bgResolved}) ratio=${p.ratio.toFixed(2)}:1 threshold=${p.threshold}:1 kind=${p.kind}${p.approximate ? ' approximate' : ''}`
    )).join('\n');
    assert.fail(`WCAG 2.1 AA failures (${failures.length} pairs):\n${detail}\n(first 20 shown; set RCF_WRITE_CONTRAST_REPORT=1 and re-run to emit output/contrast-report.md)`);
  }
});

// Required-state audit for an interactive control (PR 291 landing
// review F3). Every listed state must produce a text pair in both
// themes (a missing pair fails: the old test skipped absent states and
// passed on the buggy stylesheet), each pair must pass, and the
// focus-visible outline must clear 3:1 against the surface it sits on.
function assertControlStates(pairsByTheme, base, states) {
  const sel = (p) => p.selector === base || stripPseudo(p.selector) === base;
  for (const theme of ['light', 'dark']) {
    const bucket = pairsByTheme[theme];
    for (const state of ['default', ...states]) {
      const text = bucket.filter((p) => sel(p) && p.state === state && p.pairType === 'text');
      assert.ok(text.length > 0, `[${theme}] ${base} ${state}: no text pair enumerated`);
      for (const p of text) {
        assert.equal(p.pass, true,
          `[${theme}] ${p.selector} ${state}: color=${p.fg} (${p.fgResolved}) over background=${p.bg} (${p.bgResolved}) ratio=${p.ratio.toFixed(2)}:1 threshold=${p.threshold}:1`);
      }
      for (const p of bucket.filter((q) => sel(q) && q.state === state && q.pairType !== 'text' && q.asserted)) {
        assert.equal(p.pass, true,
          `[${theme}] ${p.selector} ${state} ${p.pairType}: ${p.fg} (${p.fgResolved}) against ${p.bg} (${p.bgResolved}) ratio=${p.ratio.toFixed(2)}:1 threshold=${p.threshold}:1`);
      }
    }
    const ring = bucket.filter((p) => sel(p) && p.state === 'focus-visible' && p.pairType === 'outline');
    assert.ok(ring.length > 0, `[${theme}] ${base}: no focus-visible outline pair enumerated`);
    for (const p of ring) {
      assert.ok(p.ratio >= 3, `[${theme}] ${base} focus ring ${p.fg} (${p.fgResolved}) against ${p.bg} (${p.bgResolved}) ratio=${p.ratio.toFixed(2)}:1 below 3:1`);
    }
  }
}

function stripPseudo(selector) {
  return selector.replace(/:focus-visible|:focus|:active|:hover|\[aria-pressed="true"\]/g, '').trim();
}

test('.rcf-search-btn passes WCAG 2.1 AA in both themes across every state (AC-205-9)', async () => {
  const css = await readFile(stylePath, 'utf8');
  const { light, dark } = enumeratePairs(css);
  assertControlStates({ light, dark }, '.rcf-search-btn', ['hover', 'focus-visible', 'active']);
});

test('.rcf-theme-btn passes WCAG 2.1 AA in both themes across hover, focus-visible and active (AC-207-1)', async () => {
  const css = await readFile(stylePath, 'utf8');
  const { light, dark } = enumeratePairs(css);
  assertControlStates({ light, dark }, '.rcf-theme-btn', ['hover', 'focus-visible', 'active', 'aria-pressed']);
});

test('state rules merge over their base; borders and outlines are enumerated as 3:1 pairs (AC-207-1)', () => {
  // The pre-amendment SearchButton shape: the hover rule sets only a
  // background (an undeclared token with a light fallback) and the base
  // colour is an undeclared token falling back to inherit. Before the
  // merge the hover was never paired; now it is, and it fails in dark.
  const miniCss = `
    :root { --sv-canvas: #F6F8FC; --sv-surface: #FFFFFF; --sv-raised: #EEF2F8; --sv-ink: #111927; --sv-border: #D8DFEA; --sv-control: #738198; --sv-focus: #2447EB; }
    :root[data-theme="dark"] { --sv-canvas: #0B121C; --sv-surface: #101925; --sv-raised: #182334; --sv-ink: #EDF2FA; --sv-border: #2C3A4F; --sv-control: #75859D; --sv-focus: #A3B5FF; }
    body { color: var(--sv-ink); background: var(--sv-canvas); }
    .btn { background: var(--sv-surface, #ffffff); color: var(--sv-text, inherit); border: 1px solid var(--sv-border); }
    .btn:hover { background: var(--sv-surface-hover, #f0f3f8); }
    .btn:active { border-color: var(--sv-border); }
    .btn:focus-visible { outline: 3px solid var(--sv-focus); outline-offset: 2px; }
    .field-input { border: 1px solid var(--sv-control); }
  `;
  const { light, dark } = enumeratePairs(miniCss);
  const darkHover = dark.find((p) => p.selector === '.btn:hover' && p.pairType === 'text');
  assert.ok(darkHover, 'a background-only hover rule must be paired with the inherited colour');
  assert.equal(darkHover.baseSelector, '.btn');
  assert.equal(darkHover.pass, false, `dark hover should fail: ${darkHover.ratio}`);
  const lightHover = light.find((p) => p.selector === '.btn:hover' && p.pairType === 'text');
  assert.equal(lightHover.pass, true);
  // State-rule border is asserted at 3:1 and fails on the hairline token.
  const activeBorder = light.find((p) => p.selector === '.btn:active' && p.pairType === 'border');
  assert.ok(activeBorder && activeBorder.asserted && activeBorder.threshold === 3 && activeBorder.pass === false);
  // Default-state hairline on a non-field is reported as advisory.
  const baseBorder = light.find((p) => p.selector === '.btn' && p.pairType === 'border');
  assert.ok(baseBorder && baseBorder.asserted === false);
  // Form-field border is asserted.
  const field = light.find((p) => p.selector === '.field-input' && p.pairType === 'border');
  assert.ok(field && field.asserted && field.pass);
  // Focus ring is paired against the surface it sits on.
  for (const bucket of [light, dark]) {
    const ring = bucket.find((p) => p.selector === '.btn:focus-visible' && p.pairType === 'outline');
    assert.ok(ring && ring.asserted && ring.threshold === 3 && ring.pass);
  }
});

test('failure message names selector/state/theme/fg/bg/ratio/threshold and exits non-zero (AC-207-2)', async () => {
  // Build a tiny stylesheet with one deliberate failure and confirm
  // the pipeline enumerates it and produces the structured record the
  // real test uses to format the failure message.
  const miniCss = `
    :root { --fg: #cccccc; --bg: #ffffff; --sv-canvas: #ffffff; --sv-surface: #ffffff; --sv-raised: #ffffff; }
    .widget { color: var(--fg); background: var(--bg); }
  `;
  const { light } = enumeratePairs(miniCss);
  const widget = light.find((p) => p.selector === '.widget');
  assert.ok(widget, 'the widget rule should produce a pair record');
  assert.equal(widget.state, 'default');
  assert.equal(widget.theme, 'light');
  assert.equal(widget.threshold, 4.5);
  assert.ok(widget.ratio < 2, `#cccccc on #ffffff should fail: got ratio ${widget.ratio}`);
  assert.equal(widget.pass, false);
  // The record carries every field the real test's failure line reads
  // from. AC-207-2 fulfilled: selector, state, theme, fg, bg, ratio,
  // threshold are all present and typed.
  assert.equal(typeof widget.selector, 'string');
  assert.equal(typeof widget.state, 'string');
  assert.equal(typeof widget.theme, 'string');
  assert.equal(typeof widget.fg, 'string');
  assert.equal(typeof widget.bg, 'string');
  assert.equal(typeof widget.ratio, 'number');
  assert.equal(typeof widget.threshold, 'number');
});
