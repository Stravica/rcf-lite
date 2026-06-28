import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../../src/store/index.js';
import { renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('renderPage emits a valid HTML5 document (AC-202-1)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en-GB">/);
  assert.match(html, /<title>/);
  assert.match(html, /<\/html>\s*$/);
});

test('renderPage includes the master Mermaid block and per-REQ subdiagrams', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // 1 master + N per-REQ subdiagrams (one per requirement).
  const blocks = html.match(/class="mermaid"/g) ?? [];
  assert.equal(blocks.length, 1 + model.requirements.length);
});

test('renderPage carries an anchor per document section (AC-202-3 via D12)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  for (const id of ['PRD-001', 'REQ-002', 'US-201', 'TAD-001', 'TAC-001', 'ADR-001', 'BS-001', 'FBS-003']) {
    const anchor = `id="doc-${id.toLowerCase()}"`;
    assert.ok(html.includes(anchor), `missing anchor for ${id}`);
  }
});

test('renderPage table-of-contents links match top-level section ids', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  for (const id of ['diagram', 'prd', 'requirements', 'user-stories', 'architecture', 'build']) {
    assert.match(html, new RegExp(`href="#${id}"`));
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('renderPage references mermaid.min.js as a relative script tag (AC-202-1)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /<script src="mermaid.min.js"/);
});

test('renderPage renders curated key fields, not raw JSON (AC-202-2)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /<strong>Executive summary:<\/strong>/);
  assert.match(html, /<strong>As a:<\/strong>/);
  assert.match(html, /Given/);
  // Raw JSON disclosure is collapsed by default.
  assert.match(html, /<details/);
  assert.match(html, /Show raw JSON/);
});

test('renderPage carries a tree-errors banner when errors are present', async () => {
  const result = {
    tree: {
      manifest: { version: '2.0.0', projectName: 'X' },
      prd: null,
      tad: null,
      bs: null,
      requirements: [],
      userStories: [],
      tacs: [],
      adrs: [],
      fbsItems: [],
      testSuites: [],
      byId: new Map(),
      rawById: new Map(),
      brokenIds: new Set(),
    },
    errors: [{ kind: 'missingFile', message: 'gone', documentId: 'REQ-099' }],
  };
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /Tree has 1 error/);
  assert.match(html, /REQ-099/);
});

test('renderPage is deterministic across runs (D15)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  assert.equal(renderPage(model), renderPage(model));
});
