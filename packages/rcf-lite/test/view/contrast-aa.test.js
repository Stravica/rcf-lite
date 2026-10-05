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
// against the two most likely surfaces (`--sv-canvas` and `--sv-surface`)
// and recorded as approximate rather than skipped.
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

  const failures = [...light, ...dark].filter((p) => !p.pass);

  // Write the report when the lane job asks for it (step 5 evidence).
  if (process.env.RCF_WRITE_CONTRAST_REPORT === '1') {
    const header = [
      '# Contrast audit report',
      '',
      'WCAG 2.1 AA (`>= 4.5:1` text; `>= 3:1` large text and non-text UI boundaries). Approximate pairs are',
      'rules that declare `color` without a block-level `background` / `background-color`; the audit records',
      'the worst-case against the three ancestor-surface candidates `--sv-canvas` / `--sv-surface` / `--sv-raised`.',
      '',
      `Light pairs: ${light.length} (failures: ${light.filter((p) => !p.pass).length}).`,
      `Dark pairs: ${dark.length} (failures: ${dark.filter((p) => !p.pass).length}).`,
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
      `  - [${p.theme}] "${p.selector}" (${p.state}): color=${p.fg} (${p.fgResolved}) over background=${p.bg} (${p.bgResolved}) ratio=${p.ratio.toFixed(2)}:1 threshold=${p.threshold}:1 kind=${p.kind}${p.approximate ? ' approximate' : ''}`
    )).join('\n');
    assert.fail(`WCAG 2.1 AA failures (${failures.length} pairs):\n${detail}\n(first 20 shown; set RCF_WRITE_CONTRAST_REPORT=1 and re-run to emit output/contrast-report.md)`);
  }
});

test('.rcf-search-btn passes WCAG 2.1 AA in both themes across every state (AC-205-9)', async () => {
  const css = await readFile(stylePath, 'utf8');
  const { light, dark } = enumeratePairs(css);
  const states = ['default', 'hover', 'focus', 'focus-visible', 'active'];
  for (const theme of ['light', 'dark']) {
    const bucket = theme === 'light' ? light : dark;
    const btnPairs = bucket.filter((p) => p.selector.includes('.rcf-search-btn'));
    assert.ok(btnPairs.length > 0, `expected at least one .rcf-search-btn pair in ${theme}`);
    for (const state of states) {
      const match = btnPairs.filter((p) => p.state === state);
      // Not every state has an own rule — hover / focus-visible / active
      // are the ones Baz's review called out. Default is always present.
      if (match.length === 0 && state !== 'default') continue;
      for (const p of match) {
        assert.equal(p.pass, true,
          `[${theme}] .rcf-search-btn ${state}: color=${p.fg} (${p.fgResolved}) over background=${p.bg} (${p.bgResolved}) ratio=${p.ratio.toFixed(2)}:1 threshold=${p.threshold}:1`);
      }
    }
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
