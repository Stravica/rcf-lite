// End-to-end tests for src/blueprint/list.js and src/blueprint/remove.js.
// Covers AC-1001-2 (list prints applied blueprints in apply order),
// AC-1001-3 (remove refuses on referring docs) and the clean-remove
// happy path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject, walkTree } from '#core/store';
import { applyBlueprint } from '../../src/blueprint/apply.js';
import { enrichRowsWithCategories, groupRowsByCategory, listBlueprints } from '../../src/blueprint/list.js';
import { removeBlueprint } from '../../src/blueprint/remove.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

// See cli.test.js's helper of the same name: the packaged shelf under
// `packages/rcf-lite/blueprints/` is populated by prepack (or the
// `stage:blueprints` script) from the repo-root shelf. CI checks out
// the repo-root copy only.
async function ensurePackagedShelfStaged() {
  const packageRoot = resolve(here, '..', '..');
  const shelfDir = join(packageRoot, 'blueprints');
  const stageScript = join(packageRoot, 'scripts', 'stage-blueprint-shelf.mjs');
  const entries = await readdir(shelfDir, { withFileTypes: true }).catch(() => []);
  const populated = entries.filter((e) => e.isDirectory()).length > 0;
  if (populated) return;
  await exec(process.execPath, [stageScript], { cwd: packageRoot, encoding: 'utf8' });
}

async function scaffoldProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-blueprint-lr-'));
  const init = await initProject({ projectRoot: root, projectName: 'BLR' });
  assert.equal(init.kind, undefined);
  return root;
}

async function writeBlueprintSource(rootDir, name, spec) {
  const dir = join(rootDir, `blueprint-${name}`);
  await mkdir(join(dir, 'contributions'), { recursive: true });
  await writeFile(join(dir, 'blueprint.json'), JSON.stringify(spec, null, 2), 'utf8');
  for (const c of spec.contributions ?? []) {
    await writeFile(join(dir, 'contributions', c.path), JSON.stringify(c.body ?? {}, null, 2), 'utf8');
  }
  return dir;
}

function reqBody(reqId) {
  return {
    reqId, prdId: 'PRD-001', title: 'x', description: 'y',
    category: 'functional', priority: 'must', domain: 'ui',
    version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
}

test('enrichRowsWithCategories: reads category from each source blueprint.json', async () => {
  const root = await scaffoldProject();
  const alphaSrc = await writeBlueprintSource(root, 'alpha', {
    slug: 'alpha', version: '1.0.0', category: 'security',
    contributions: [{ kind: 'req', id: 'alpha-REQ-001', path: 'alpha-req-001.json', body: reqBody('alpha-REQ-001') }],
  });
  const betaSrc = await writeBlueprintSource(root, 'beta', {
    slug: 'beta', version: '1.0.0', // no category declared
    contributions: [{ kind: 'req', id: 'beta-REQ-001', path: 'beta-req-001.json', body: reqBody('beta-REQ-001') }],
  });
  await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source: alphaSrc, now: new Date('2026-08-30T10:00:00Z') });
  await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source: betaSrc, now: new Date('2026-08-30T11:00:00Z') });
  const { tree } = await walkTree({ projectRoot: root });
  const enriched = await enrichRowsWithCategories(listBlueprints(tree));
  const alpha = enriched.find((r) => r.slug === 'alpha');
  const beta = enriched.find((r) => r.slug === 'beta');
  assert.equal(alpha.category, 'security');
  assert.equal(beta.category, null);
});

test('enrichRowsWithCategories: bare shelf-slug source re-resolves through the packaged shelf (F1)', async () => {
  await ensurePackagedShelfStaged();
  // Regression for integration review d-2026-08-31-046 F1: pre-fix, a
  // manifest carrying `source: 'application-spa'` (legacy sugar-recorded
  // row) fell through the loader's fs.readFile and every row rendered
  // under `uncategorised`. With `projectRoot` threaded through, the
  // enricher hands the token to the shelf resolver first and reads the
  // shipping blueprint.json off the packaged shelf.
  const root = await mkdtemp(join(tmpdir(), 'rcf-blueprint-enrich-slug-'));
  const rows = [{
    slug: 'application-spa', version: '1.0.0', appliedAt: '2026-08-30T10:00:00Z',
    source: 'application-spa', // bare slug (the F1 shape)
    namespace: null, contributionCount: 0,
  }];
  const enriched = await enrichRowsWithCategories(rows, { projectRoot: root });
  // Packaged shelf's application-spa declares its category on the
  // shipping blueprint.json; the row must not fall to `null`.
  assert.equal(typeof enriched[0].category, 'string', `expected category, got ${enriched[0].category}`);
  assert.notEqual(enriched[0].category, null);
});

test('enrichRowsWithCategories: yields null when the source path no longer resolves', async () => {
  const root = await scaffoldProject();
  const src = await writeBlueprintSource(root, 'ghost', {
    slug: 'ghost', version: '1.0.0', category: 'observability',
    contributions: [{ kind: 'req', id: 'ghost-REQ-001', path: 'ghost-req-001.json', body: reqBody('ghost-REQ-001') }],
  });
  await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source: src, now: new Date('2026-08-30T10:00:00Z') });
  const { tree } = await walkTree({ projectRoot: root });
  const rows = listBlueprints(tree);
  // Mutate the source path so it no longer resolves.
  rows[0].source = join(root, 'no-such-blueprint-dir');
  const enriched = await enrichRowsWithCategories(rows);
  assert.equal(enriched[0].category, null);
});

test('groupRowsByCategory: sorts named groups alphabetically and appends the null bucket', async () => {
  const rows = [
    { slug: 'a', category: 'security' },
    { slug: 'b', category: null },
    { slug: 'c', category: 'delivery' },
    { slug: 'd', category: 'security' },
    { slug: 'e', category: undefined },
  ];
  const groups = groupRowsByCategory(rows);
  assert.deepEqual(groups.map((g) => g.category), ['delivery', 'security', null]);
  assert.deepEqual(groups[0].rows.map((r) => r.slug), ['c']);
  assert.deepEqual(groups[1].rows.map((r) => r.slug), ['a', 'd']);
  assert.deepEqual(groups[2].rows.map((r) => r.slug), ['b', 'e']);
});

test('listBlueprints: two applied blueprints render in appliedAt order (AC-1001-2)', async () => {
  const root = await scaffoldProject();
  const alphaSrc = await writeBlueprintSource(root, 'alpha', {
    slug: 'alpha', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'alpha-REQ-001', path: 'alpha-req-001.json', body: reqBody('alpha-REQ-001') }],
  });
  const betaSrc = await writeBlueprintSource(root, 'beta', {
    slug: 'beta', version: '2.0.0',
    contributions: [{ kind: 'req', id: 'beta-REQ-001', path: 'beta-req-001.json', body: reqBody('beta-REQ-001') }],
  });
  await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source: alphaSrc, now: new Date('2026-08-19T10:00:00Z') });
  await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source: betaSrc, now: new Date('2026-08-19T11:00:00Z') });
  const { tree } = await walkTree({ projectRoot: root });
  const rows = listBlueprints(tree);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].slug, 'alpha');
  assert.equal(rows[1].slug, 'beta');
  assert.equal(rows[0].contributionCount, 1);
});

test('removeBlueprint: clean remove drops the entry and deletes contribution files', async () => {
  const root = await scaffoldProject();
  const src = await writeBlueprintSource(root, 'alpha', {
    slug: 'alpha', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'alpha-REQ-001', path: 'alpha-req-001.json', body: reqBody('alpha-REQ-001') }],
  });
  await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source: src, now: new Date('2026-08-19T10:00:00Z') });
  const { tree } = await walkTree({ projectRoot: root });
  const result = await removeBlueprint({ projectRoot: root, tree, slug: 'alpha' });
  assert.equal(result.removed, true);
  assert.equal(result.deletedPaths.length, 1);
  // File is gone.
  await assert.rejects(stat(join(root, 'rcf', 'requirements', 'alpha-req-001.json')));
  // Manifest entry is gone.
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.blueprints, undefined);
});

test('removeBlueprint: refuses when a project-authored doc references a contribution id (AC-1001-3)', async () => {
  const root = await scaffoldProject();
  // Blueprint contributes a REQ; also add a project-authored US that references the blueprint REQ.
  const src = await writeBlueprintSource(root, 'alpha', {
    slug: 'alpha', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'alpha-REQ-001', path: 'alpha-req-001.json', body: reqBody('alpha-REQ-001') }],
  });
  await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source: src, now: new Date('2026-08-19T10:00:00Z') });
  // Author a US that references the blueprint's REQ.
  const us = {
    usId: 'US-999', prdId: 'PRD-001', reqId: 'alpha-REQ-001',
    version: '0.1.0', status: 'draft',
    title: 'refers', asA: 'x', iWant: 'y', soThat: 'z',
    acceptanceCriteria: [{ id: 'AC-999-1', description: 'x', testable: true }],
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  await writeFile(join(root, 'rcf', 'user-stories', 'us-999.json'), JSON.stringify(us, null, 2), 'utf8');
  const { tree } = await walkTree({ projectRoot: root });
  const result = await removeBlueprint({ projectRoot: root, tree, slug: 'alpha' });
  assert.equal(result.removed, false);
  assert.ok(result.referringDocs.length >= 1);
  assert.ok(result.referringDocs.some((r) => r.docId === 'US-999' && r.matchedId === 'alpha-REQ-001'));
  // Blueprint file and manifest entry still present.
  await stat(join(root, 'rcf', 'requirements', 'alpha-req-001.json'));
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.blueprints.length, 1);
});
