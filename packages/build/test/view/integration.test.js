// Integration tests for `renderModelToPage` against fresh fixture trees
// built on the fly via `initProject`. Phase 3.8 removed the disk-write
// path: this file was previously wired against the `.rcf-view/` output
// convention (deleted). It now asserts the pure-render surface: walk
// the tree, produce the full-page HTML plus the innerHTML content
// payload, verify shape and error propagation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { renderModelToPage } from '../../src/view/index.js';

test('renderModelToPage on a clean fresh tree returns HTML with no errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-clean-'));
  await initProject({ projectRoot: root });
  const result = await renderModelToPage({ projectRoot: root });
  assert.deepEqual(result.errors, []);
  assert.match(result.fullPageHtml, /^<!DOCTYPE html>/);
  assert.match(result.fullPageHtml, /<\/html>\s*$/);
  assert.ok(result.contentHtml.length > 0);
  assert.ok(!result.contentHtml.startsWith('<!DOCTYPE'));
});

test('renderModelToPage default mode surfaces broken-tree errors alongside a render', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-broken-default-'));
  await initProject({ projectRoot: root });
  const reqPath = join(root, 'rcf', 'requirements', 'req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const result = await renderModelToPage({ projectRoot: root });
  assert.ok(result.errors.length > 0);
  assert.match(result.fullPageHtml, /PRD-999/);
  assert.match(result.fullPageHtml, /Tree has \d+ error/);
});

test('renderModelToPage never writes to disk (Phase 3.8 regression)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-nofs-'));
  await initProject({ projectRoot: root });
  await renderModelToPage({ projectRoot: root });
  await assert.rejects(stat(join(root, '.rcf-view')), { code: 'ENOENT' });
});

test('renderModelToPage picks up manifest changes between calls (re-walk is fresh)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-fresh-'));
  await initProject({ projectRoot: root, projectName: 'First' });
  const first = await renderModelToPage({ projectRoot: root });
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.projectName = 'Second';
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
  const second = await renderModelToPage({ projectRoot: root });
  assert.match(first.fullPageHtml, /First/);
  assert.match(second.fullPageHtml, /Second/);
  assert.doesNotMatch(second.fullPageHtml, /<title>First/);
});

test('renderModelToPage always wraps content in <div id="rcf-live-content"> (D13a)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-wrap-'));
  await initProject({ projectRoot: root });
  const result = await renderModelToPage({ projectRoot: root });
  assert.match(result.fullPageHtml, /<div id="rcf-live-content">/);
  assert.match(result.fullPageHtml, /<script src="\/live-client\.js" defer><\/script>/);
});

test('renderModelToPage always emits the live-client script tag (D13a)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-render-script-'));
  await initProject({ projectRoot: root });
  const result = await renderModelToPage({ projectRoot: root });
  assert.match(result.fullPageHtml, /<script src="\/live-client\.js" defer>/);
});
