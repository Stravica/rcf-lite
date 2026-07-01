// End-to-end test against the live Phase 2 rcf/ tree in the repo. The same
// pattern test/rcf-tree.test.js uses today; guards against any change to the
// live tree the renderer cannot handle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findProjectRoot, renderView } from '../../src/view/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('findProjectRoot walks upwards to find rcf/manifest.json (D19)', async () => {
  const fromInside = await findProjectRoot(join(repoRoot, 'src', 'view'));
  assert.equal(fromInside, repoRoot);
});

test('findProjectRoot returns null when no manifest is found', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-no-project-'));
  const out = await findProjectRoot(tmp);
  assert.equal(out, null);
});

test('renderView against the live rcf tree exits 0 (e2e)', async () => {
  const result = await renderView({ projectRoot: repoRoot });
  assert.equal(result.exitCode, 0, JSON.stringify(result.errors, null, 2));
  assert.equal(result.errors.length, 0);
  assert.equal(result.written.length, 3);
});

test('renderView against the live tree writes the expected file set', async () => {
  await renderView({ projectRoot: repoRoot });
  const indexStat = await stat(join(repoRoot, '.rcf-view', 'index.html'));
  const styleStat = await stat(join(repoRoot, '.rcf-view', 'style.css'));
  const mermaidStat = await stat(join(repoRoot, '.rcf-view', 'mermaid.min.js'));
  assert.ok(indexStat.size > 1000);
  assert.ok(styleStat.size > 100);
  assert.ok(mermaidStat.size > 1_000_000);
});

test('rendered index.html carries a hash anchor for every document in the live tree', async () => {
  await renderView({ projectRoot: repoRoot });
  const html = await readFile(join(repoRoot, '.rcf-view', 'index.html'), 'utf8');
  // Phase 2 tree carries these well-known ids; renderer must surface them
  // either as an `id="ID"` or a `data-doc-id="ID"` (the two anchor
  // conventions Phase 3.2 uses for hash routing).
  for (const id of [
    'PRD-001',
    'REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005', 'REQ-006', 'REQ-007',
    'US-101', 'US-201', 'US-301', 'US-401', 'US-501', 'US-601', 'US-701',
    'TAD-001', 'TAC-001', 'TAC-007',
    'ADR-001', 'ADR-005',
    'BS-001',
    'FBS-001', 'FBS-003', 'FBS-012',
  ]) {
    const found = html.includes(`id="${id}"`) || html.includes(`data-doc-id="${id}"`);
    assert.ok(found, `missing anchor for ${id}`);
  }
});

test('rendered per-REQ subdiagrams contain AC -> FBS delivered-by edges', async () => {
  await renderView({ projectRoot: repoRoot });
  const html = await readFile(join(repoRoot, '.rcf-view', 'index.html'), 'utf8');
  assert.match(html, /AC-201-1 -\.-&gt;\|delivered by\| FBS-003/);
});
