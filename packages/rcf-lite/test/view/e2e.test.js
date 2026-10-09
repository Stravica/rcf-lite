// End-to-end test against the live Phase 2 rcf/ tree in the repo. Phase
// 3.8 replaced the disk-write path with a server-only surface; this file
// asserts the pure-render entry point (renderModelToPage) against the
// live tree and confirms the deltas Phase 3.8 introduced.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findProjectRoot, renderModelToPage } from '../../src/view/index.js';

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

test('renderModelToPage against the live rcf tree returns no errors (e2e)', async () => {
  const result = await renderModelToPage({ projectRoot: repoRoot });
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors, null, 2));
  assert.ok(result.fullPageHtml.length > 10000);
  assert.ok(result.contentHtml.length > 5000);
});

test('rendered live-tree HTML carries a hash anchor for every well-known document', async () => {
  const { fullPageHtml: html } = await renderModelToPage({ projectRoot: repoRoot });
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

test('rendered page carries no per-REQ Mermaid slice on the user-facing surface (AC-209-5)', async () => {
  // FBS-208 (AC-209-5) retires the per-REQ Mermaid slice on the
  // Requirements and Readiness tabs. The chain's generator still
  // produces the "AC -> FBS delivered-by" edge for AC-201-1 under
  // test/view/mermaid-diagram.test.js (AC-201-1), but no user-facing
  // tabpanel renders it any more.
  const { fullPageHtml: html } = await renderModelToPage({ projectRoot: repoRoot });
  const reqStart = html.indexOf('id="tab-requirements"');
  const archStart = html.indexOf('id="tab-architecture"', reqStart);
  const requirements = reqStart >= 0 && archStart > reqStart ? html.slice(reqStart, archStart) : '';
  assert.doesNotMatch(requirements, /AC-201-1 -\.-&gt;\|delivered by\| FBS-003/);
  assert.doesNotMatch(requirements, /<pre class="mermaid">/);
});
