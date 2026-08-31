// Phase 2b: colon-qualified `<libraryPrefix>:<slug>` resolution via
// the project registry (spec §5.2). Precedes @stock/, path, bare-shelf,
// path-fallthrough in the resolver order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveBlueprintSource } from '../../src/blueprint/shelf-resolver.js';
import { REGISTRY_PATH, REGISTRY_VERSION } from '../../src/blueprint/library-registry.js';
import { isRcfError } from '../../src/core/errors/index.js';

async function scaffoldProjectWithRegistry(entries, libraryCache) {
  const project = await mkdtemp(join(tmpdir(), 'rcf-proj-'));
  await mkdir(join(project, 'rcf'), { recursive: true });
  await writeFile(
    join(project, REGISTRY_PATH),
    JSON.stringify({ registryVersion: REGISTRY_VERSION, libraries: entries }, null, 2),
    'utf8',
  );
  return project;
}

async function scaffoldLibraryOnDisk(root, blueprintSlug) {
  const bpDir = join(root, 'blueprints', blueprintSlug);
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({ slug: blueprintSlug, version: '1.0.0', contributions: [] }, null, 2), 'utf8');
  return bpDir;
}

test('colon-qualified <prefix>:<slug> resolves to the library-cache blueprint dir', async () => {
  const libRoot = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  await scaffoldLibraryOnDisk(libRoot, 'auth-oauth2');
  const project = await scaffoldProjectWithRegistry([{
    libraryPrefix: 'wsd',
    sourceKind: 'local',
    sourceRef: libRoot,
    displayName: 'WSD library',
    publisher: { id: 'wsd', displayName: 'West Somerset Data' },
    libraryRef: '1.0.0',
    bands: { ac: { start: 50000, end: 59999 } },
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
    addedAt: '2026-09-01T00:00:00Z',
    reviewedBy: 'operator',
    provenance: { tier: 'local' },
    cachePath: libRoot,
  }]);
  const res = await resolveBlueprintSource('wsd:auth-oauth2', { projectRoot: project });
  assert.equal(isRcfError(res), false);
  assert.equal(res.kind, 'library');
  assert.equal(res.libraryPrefix, 'wsd');
  assert.equal(res.libraryBlueprintSlug, 'auth-oauth2');
  assert.equal(res.effectiveSlug, 'wsd-auth-oauth2');
  assert.equal(res.original, 'wsd:auth-oauth2');
  assert.equal(res.resolved, join(libRoot, 'blueprints', 'auth-oauth2'));
  assert.equal(res.libraryBands.ac.start, 50000);
});

test('colon-qualified refuses when the library is not registered', async () => {
  const project = await scaffoldProjectWithRegistry([]);
  const res = await resolveBlueprintSource('wsd:auth-oauth2', { projectRoot: project });
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /not registered on this project/);
  assert.match(res.message, /rcf define blueprint library add/);
});

test('colon-qualified refuses when the library is registered but has no such blueprint', async () => {
  const libRoot = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  const project = await scaffoldProjectWithRegistry([{
    libraryPrefix: 'wsd',
    sourceKind: 'local',
    sourceRef: libRoot,
    displayName: 'WSD library',
    publisher: { id: 'wsd', displayName: 'West Somerset Data' },
    libraryRef: '1.0.0',
    bands: { ac: { start: 50000, end: 59999 } },
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
    addedAt: '2026-09-01T00:00:00Z',
    reviewedBy: 'operator',
    provenance: { tier: 'local' },
    cachePath: libRoot,
  }]);
  const res = await resolveBlueprintSource('wsd:not-there', { projectRoot: project });
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /has no blueprint with slug 'not-there'/);
});

test('colon-qualified refuses when the on-disk blueprint dir is missing', async () => {
  // Registry says the blueprint is there; on disk it is not.
  const libRoot = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  const project = await scaffoldProjectWithRegistry([{
    libraryPrefix: 'wsd',
    sourceKind: 'local',
    sourceRef: libRoot,
    displayName: 'WSD library',
    publisher: { id: 'wsd', displayName: 'West Somerset Data' },
    libraryRef: '1.0.0',
    bands: { ac: { start: 50000, end: 59999 } },
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
    addedAt: '2026-09-01T00:00:00Z',
    reviewedBy: 'operator',
    provenance: { tier: 'local' },
    cachePath: libRoot,
  }]);
  const res = await resolveBlueprintSource('wsd:auth-oauth2', { projectRoot: project });
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /that path is missing/);
  assert.match(res.message, /library refresh/);
});

test('colon-qualified refuses when no projectRoot is supplied', async () => {
  const res = await resolveBlueprintSource('wsd:auth-oauth2');
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /without a projectRoot/);
});
