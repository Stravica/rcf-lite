// Integration tests for renderView against fresh fixture trees built on the
// fly via initProject. Covers the spec §9.4 view-layer integration matrix:
// happy path, strict mode, default render-with-markers behaviour, and
// fresh-each-run discipline (AC-203-1 / AC-203-2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { renderView } from '../../src/view/index.js';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('renderView on a clean fresh tree returns exit 0 and writes 3 files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-clean-'));
  await initProject({ projectRoot: root });
  const result = await renderView({ projectRoot: root });
  assert.equal(result.exitCode, 0);
  assert.equal(result.written.length, 3);
  assert.deepEqual(result.errors, []);
  assert.ok(await exists(join(root, '.rcf-view', 'index.html')));
  assert.ok(await exists(join(root, '.rcf-view', 'style.css')));
  assert.ok(await exists(join(root, '.rcf-view', 'mermaid.min.js')));
});

test('renderView default mode renders broken trees with markers (AC-201-2, OQ7)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-broken-default-'));
  await initProject({ projectRoot: root });
  // Break a reference.
  const prdPath = join(root, 'rcf', 'prd.json');
  const prd = JSON.parse(await readFile(prdPath, 'utf8'));
  prd.requirementIds = ['REQ-099'];
  await writeFile(prdPath, JSON.stringify(prd), 'utf8');
  const result = await renderView({ projectRoot: root });
  assert.equal(result.exitCode, 3);
  assert.equal(result.written.length, 3);
  const html = await readFile(join(root, '.rcf-view', 'index.html'), 'utf8');
  assert.match(html, /REQ-099/);
  assert.match(html, /Tree has \d+ error/);
});

test('renderView --strict refuses to write on broken trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-broken-strict-'));
  await initProject({ projectRoot: root });
  const prdPath = join(root, 'rcf', 'prd.json');
  const prd = JSON.parse(await readFile(prdPath, 'utf8'));
  prd.requirementIds = ['REQ-099'];
  await writeFile(prdPath, JSON.stringify(prd), 'utf8');
  const result = await renderView({ projectRoot: root, strict: true });
  assert.equal(result.exitCode, 3);
  assert.equal(result.written.length, 0);
  assert.equal(await exists(join(root, '.rcf-view', 'index.html')), false);
});

test('renderView is fresh on every run (AC-203-1, AC-203-2)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-fresh-'));
  await initProject({ projectRoot: root, projectName: 'First' });
  await renderView({ projectRoot: root });
  const first = await readFile(join(root, '.rcf-view', 'index.html'), 'utf8');
  // Rename the project.
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.projectName = 'Second';
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
  await renderView({ projectRoot: root });
  const second = await readFile(join(root, '.rcf-view', 'index.html'), 'utf8');
  assert.match(first, /First/);
  assert.match(second, /Second/);
  assert.doesNotMatch(second, /<title>First/);
});

test('renderView truncates stale output files on each run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-trunc-'));
  await initProject({ projectRoot: root });
  await renderView({ projectRoot: root });
  // Add a stale file in .rcf-view/ - the next run should remove it.
  await writeFile(join(root, '.rcf-view', 'stale.txt'), 'old', 'utf8');
  assert.equal(await exists(join(root, '.rcf-view', 'stale.txt')), true);
  await renderView({ projectRoot: root });
  assert.equal(await exists(join(root, '.rcf-view', 'stale.txt')), false);
});

test('renderView log sink receives verbose lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-verbose-'));
  await initProject({ projectRoot: root });
  const lines = [];
  await renderView({ projectRoot: root, verbose: true, log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => l.includes('walking tree')));
  assert.ok(lines.some((l) => l.includes('loaded ')));
  assert.ok(lines.some((l) => l.includes('wrote ')));
});
