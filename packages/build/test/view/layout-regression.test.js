// Layout regression against the Phase 3.6 baseline fixture. Phase 3.8
// wraps the tabpanels in `<div id="rcf-live-content">`, injects the
// `<script src="/live-client.js" defer>` tag, and adds
// `data-doc-id="{parentId}::raw"` to every raw-json disclosure. Every
// other byte of the rendered page must match the baseline byte-for-byte
// once those three deltas are normalised. The committed baseline is
// `test/view/fixtures/phase-3-6-static.html`, regenerated whenever the
// dogfood tree changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../../src/store/index.js';
import { renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const fixturePath = resolve(here, 'fixtures', 'phase-3-6-static.html');

/**
 * Normalise a Phase 3.8 render down to the Phase 3.6 shape by peeling
 * off the three whitelisted additive shape deltas:
 * (1) the `<div id="rcf-live-content">` wrapper around the tabpanels
 * (2) the `<script src="/live-client.js" defer></script>` tag
 * (3) `data-doc-id="{...}::raw"` on `<details class="raw-json">`
 *
 * Plus one prose swap that is not a shape change but is intentional:
 *   footer's "regenerate with rcf-view" line replaced by the live
 *   streaming equivalent. Normalising this so the shape assertion
 *   isn't drowned out by an intentional string change.
 *
 * Anything else that differs is a genuine regression.
 */
function stripKnownDeltas(html) {
  let out = html;
  out = out.replace(/\n    <div id="rcf-live-content">\n    /, '\n    ');
  out = out.replace(/\n    <\/div>\n  <\/main>/, '\n  </main>');
  out = out.replace(/\s*<script src="\/live-client\.js" defer><\/script>/, '');
  out = out.replace(/<details class="raw-json" data-doc-id="[^"]+"/g, '<details class="raw-json"');
  out = out.replace(
    /Read-only; changes on disk stream to this tab automatically\./,
    'Read-only; regenerate with <code>rcf-view</code> to see fresh state.',
  );
  return out;
}

test('layout regression: rendered live tree matches the Phase 3.6 baseline up to the three whitelisted deltas', async () => {
  const baseline = await readFile(fixturePath, 'utf8');
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const rendered = renderPage(model);
  const normalised = stripKnownDeltas(rendered);
  if (normalised !== baseline) {
    // Localise the first diff to make failure legible.
    let i = 0;
    while (i < Math.min(normalised.length, baseline.length) && normalised[i] === baseline[i]) i += 1;
    const around = 120;
    const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - around), i + around));
    assert.fail(`layout regression at byte ${i}\n\nbaseline:\n${ctx(baseline)}\n\nrendered:\n${ctx(normalised)}`);
  }
  assert.equal(normalised, baseline);
});

test('layout regression: baseline fixture is committed and non-trivial', async () => {
  const baseline = await readFile(fixturePath, 'utf8');
  assert.ok(baseline.length > 10000, `baseline fixture is unexpectedly small (${baseline.length} bytes)`);
  assert.match(baseline, /<!DOCTYPE html>/);
  // Sanity: baseline was captured before Phase 3.8 was applied.
  assert.doesNotMatch(baseline, /<div id="rcf-live-content">/);
  assert.doesNotMatch(baseline, /<script src="\/live-client\.js"/);
});

test('layout regression: the current render carries exactly the three additive deltas over the baseline', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const rendered = renderPage(model);
  // Wrapper opens and closes.
  assert.match(rendered, /<div id="rcf-live-content">/);
  // Script tag present exactly once.
  const scriptMatches = rendered.match(/<script src="\/live-client\.js" defer><\/script>/g) ?? [];
  assert.equal(scriptMatches.length, 1);
  // Raw-json disclosures now carry a stable data-doc-id.
  assert.match(rendered, /<details class="raw-json" data-doc-id="PRD-001::raw"/);
});
