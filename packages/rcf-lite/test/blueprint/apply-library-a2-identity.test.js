// A2 identity assertion (spec amendment 2026-09-03 consequence line):
// a plain-path apply of a blueprint inside a library and a qualified
// apply after `library add` must produce identical effective slug,
// stamped contribution ids, and library-ownership record fields.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject, walkTree } from '#core/store';
import { applyBlueprint } from '../../src/blueprint/apply.js';
import { resolveBlueprintSource } from '../../src/blueprint/shelf-resolver.js';
import { REGISTRY_PATH, REGISTRY_VERSION } from '../../src/blueprint/library-registry.js';

const now = new Date('2026-09-04T10:00:00Z');

const reqBody = (id) => ({
  reqId: id, prdId: 'PRD-001',
  title: 'A2 identity REQ',
  description: 'REQ authored under a library, applied both ways.',
  category: 'functional', priority: 'must', domain: 'ui',
  version: '0.1.0', status: 'draft',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
});

async function scaffoldLibrary() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-a2-id-lib-'));
  const bpDir = join(root, 'blueprints', 'auth-oauth2');
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({
    slug: 'auth-oauth2', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
  }, null, 2), 'utf8');
  await writeFile(join(bpDir, 'contributions', 'req.json'), JSON.stringify(reqBody('wsd-auth-oauth2-REQ-50101'), null, 2), 'utf8');
  await writeFile(join(root, 'library.json'), JSON.stringify({
    libraryVersion: 1,
    libraryPrefix: 'wsd',
    displayName: 'WSD library',
    publisher: { id: 'wsd', displayName: 'West Somerset Data' },
    libraryRef: '1.0.0',
    bands: { ac: { start: 50000, end: 59999 } },
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
  }, null, 2), 'utf8');
  return { libraryRoot: root, bpDir };
}

async function scaffoldProjectWithRegistry(entry) {
  const root = await mkdtemp(join(tmpdir(), 'rcf-a2-id-proj-'));
  const init = await initProject({ projectRoot: root, projectName: 'A2IdentityTest' });
  assert.equal(init.kind, undefined, JSON.stringify(init));
  if (entry) {
    await writeFile(join(root, REGISTRY_PATH), JSON.stringify({
      registryVersion: REGISTRY_VERSION,
      libraries: [entry],
    }, null, 2), 'utf8');
  }
  return root;
}

test('A2 identity: plain-path apply and qualified apply produce the same slug, ids, and libraryPrefix', async () => {
  const { libraryRoot, bpDir } = await scaffoldLibrary();

  // Route A: plain path apply against the library (no registry).
  const projectA = await scaffoldProjectWithRegistry(null);
  const resA = await resolveBlueprintSource(bpDir);
  const treeA = (await walkTree({ projectRoot: projectA })).tree;
  const applyA = await applyBlueprint({
    projectRoot: projectA, tree: treeA, source: resA.resolved, now,
    displaySource: resA.original,
    effectiveSlug: resA.effectiveSlug,
    libraryPrefix: resA.libraryPrefix,
    libraryBands: resA.libraryBands,
  });
  assert.equal(applyA.applied, true, JSON.stringify(applyA));

  // Route B: qualified apply after registering the library.
  const projectB = await scaffoldProjectWithRegistry({
    libraryPrefix: 'wsd',
    sourceKind: 'local',
    sourceRef: libraryRoot,
    displayName: 'WSD library',
    publisher: { id: 'wsd', displayName: 'West Somerset Data' },
    libraryRef: '1.0.0',
    bands: { ac: { start: 50000, end: 59999 } },
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
    addedAt: '2026-09-01T00:00:00Z',
    reviewedBy: 'operator',
    provenance: { tier: 'local' },
    cachePath: libraryRoot,
  });
  const resB = await resolveBlueprintSource('wsd:auth-oauth2', { projectRoot: projectB });
  const treeB = (await walkTree({ projectRoot: projectB })).tree;
  const applyB = await applyBlueprint({
    projectRoot: projectB, tree: treeB, source: resB.resolved, now,
    displaySource: resB.original,
    effectiveSlug: resB.effectiveSlug,
    libraryPrefix: resB.libraryPrefix,
    libraryBands: resB.libraryBands,
  });
  assert.equal(applyB.applied, true, JSON.stringify(applyB));

  // Identity: effective slug matches on both.
  assert.equal(applyA.slug, applyB.slug);
  assert.equal(applyA.slug, 'wsd-auth-oauth2');

  // Identity: contribution ids on disk match on both.
  const docA = JSON.parse(await readFile(join(projectA, 'rcf', 'requirements', 'wsd-auth-oauth2-req-50101.json'), 'utf8'));
  const docB = JSON.parse(await readFile(join(projectB, 'rcf', 'requirements', 'wsd-auth-oauth2-req-50101.json'), 'utf8'));
  assert.equal(docA.reqId, 'wsd-auth-oauth2-REQ-50101');
  assert.equal(docA.reqId, docB.reqId);

  // Identity: applied record's libraryPrefix + slug match; the `source`
  // field intentionally differs (plain path vs qualified typed ref) per
  // spec sections 5.3 and A2, so we assert on the ownership-load-bearing
  // fields only.
  const manifestA = JSON.parse(await readFile(join(projectA, 'rcf', 'manifest.json'), 'utf8'));
  const manifestB = JSON.parse(await readFile(join(projectB, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifestA.blueprints[0].slug, manifestB.blueprints[0].slug);
  assert.equal(manifestA.blueprints[0].libraryPrefix, manifestB.blueprints[0].libraryPrefix);
  assert.equal(manifestA.blueprints[0].libraryPrefix, 'wsd');
  // Qualified branch records `wsd:auth-oauth2`; plain-path branch
  // records the path as typed. Cover both to make the deviation
  // explicit.
  assert.equal(manifestB.blueprints[0].source, 'wsd:auth-oauth2');
  assert.notEqual(manifestA.blueprints[0].source, manifestB.blueprints[0].source);
});
