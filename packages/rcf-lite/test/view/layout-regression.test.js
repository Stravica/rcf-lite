// Layout regression against the committed baseline fixture at
// test/view/fixtures/phase-3-6-static.html. Viewer UI refresh PR 1
// (w-2026-10-02-dave-010, Dex / wespa relay f0384046 on 2026-10-02)
// reshapes the shell (compact header with brand, Stravica brand token
// stylesheet with a light / dark pair, external ./page-init.js
// replacing the single former inline script, relative asset refs for
// the wespa reverse-proxy mount), so the pre-PR-1 Phase-3.8 strip-
// and-compare helper is retired. The baseline file is now whatever
// renderPage() produces against the live dogfood tree; any drift from
// that is a shell regression and should be a conscious re-baseline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const fixturePath = resolve(here, 'fixtures', 'phase-3-6-static.html');

test('layout regression: rendered live tree matches the committed baseline byte for byte', async () => {
  const baseline = await readFile(fixturePath, 'utf8');
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const rendered = renderPage(model);
  if (rendered !== baseline) {
    let i = 0;
    while (i < Math.min(rendered.length, baseline.length) && rendered[i] === baseline[i]) i += 1;
    const around = 120;
    const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - around), i + around));
    assert.fail(`layout regression at byte ${i}\n\nbaseline:\n${ctx(baseline)}\n\nrendered:\n${ctx(rendered)}`);
  }
  assert.equal(rendered, baseline);
});

test('layout regression: baseline fixture is committed and non-trivial', async () => {
  const baseline = await readFile(fixturePath, 'utf8');
  assert.ok(baseline.length > 10000, `baseline fixture is unexpectedly small (${baseline.length} bytes)`);
  assert.match(baseline, /<!DOCTYPE html>/);
  // Viewer UI refresh PR 1 shell markers.
  assert.match(baseline, /<header class="app-header">/);
  assert.match(baseline, /<script src="\.\/page-init\.js" defer><\/script>/);
  assert.match(baseline, /<script src="\.\/live-client\.js" defer><\/script>/);
});

test('layout regression: the current render carries the viewer UI refresh PR 1 shell', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const rendered = renderPage(model);
  // Shell markers.
  assert.match(rendered, /<header class="app-header">/);
  assert.match(rendered, /<footer class="app-footer">/);
  assert.match(rendered, /<div id="rcf-live-content">/);
  // Script tags: no inline body, two external script tags each
  // exactly once, both relative.
  const liveMatches = rendered.match(/<script src="\.\/live-client\.js" defer><\/script>/g) ?? [];
  assert.equal(liveMatches.length, 1);
  const initMatches = rendered.match(/<script src="\.\/page-init\.js" defer><\/script>/g) ?? [];
  assert.equal(initMatches.length, 1);
  assert.doesNotMatch(rendered, /<script>\(function/);
  // Raw-json disclosures still carry a stable data-doc-id.
  assert.match(rendered, /<details class="raw-json" data-doc-id="PRD-001::raw"/);
});
