// External-library manifest loader tests (Phase 2b, spec §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadLibrary } from '../../src/blueprint/library-loader.js';
import { isRcfError } from '../../src/core/errors/index.js';

async function scaffoldLibrary(root, manifest, blueprintDirs = []) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'library.json'), JSON.stringify(manifest, null, 2), 'utf8');
  for (const bp of blueprintDirs) {
    const dir = join(root, bp.path);
    await mkdir(join(dir, 'contributions'), { recursive: true });
    await writeFile(join(dir, 'blueprint.json'), JSON.stringify({ slug: bp.slug, version: '1.0.0', contributions: [] }, null, 2), 'utf8');
  }
}

function validManifest(overrides = {}) {
  return {
    libraryVersion: 1,
    libraryPrefix: 'wsd',
    displayName: 'WSD organisational blueprint library',
    publisher: { id: 'wsd', displayName: 'West Somerset Data' },
    libraryRef: '1.2.0',
    bands: { ac: { start: 50000, end: 59999 }, suffixBlocks: [{ kind: 'adr', start: 5000, end: 5099 }] },
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
    ...overrides,
  };
}

test('loads a valid library and validates each declared blueprint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  await scaffoldLibrary(root, validManifest(), [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }]);
  const lib = await loadLibrary(root);
  assert.equal(isRcfError(lib), false);
  assert.equal(lib.libraryPrefix, 'wsd');
  assert.equal(lib.libraryRef, '1.2.0');
  assert.equal(lib.blueprints.length, 1);
  assert.equal(lib.blueprints[0].slug, 'auth-oauth2');
  assert.equal(lib.bands.ac.start, 50000);
  assert.equal(lib.bands.suffixBlocks[0].kind, 'adr');
});

test('refuses a library missing library.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  const lib = await loadLibrary(root);
  assert.equal(isRcfError(lib), true);
  assert.match(lib.message, /no library\.json/);
});

test('refuses a library with an unknown libraryVersion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  await scaffoldLibrary(root, validManifest({ libraryVersion: 99 }));
  const lib = await loadLibrary(root);
  assert.equal(isRcfError(lib), true);
  assert.match(lib.message, /libraryVersion/);
});

test('refuses a library whose declared blueprint slug disagrees with its own blueprint.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  await scaffoldLibrary(root, validManifest({
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/oops' }],
  }));
  // Scaffold the blueprint dir with a MISMATCHED slug on disk.
  const bpDir = join(root, 'blueprints/oops');
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({ slug: 'not-the-same', version: '1.0.0', contributions: [] }, null, 2), 'utf8');
  const lib = await loadLibrary(root);
  assert.equal(isRcfError(lib), true);
  assert.match(lib.message, /declares its own slug/);
});

test('refuses a library with bands.ac out of the 1..99999 range', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  await scaffoldLibrary(root, validManifest({ bands: { ac: { start: 0, end: 200 } } }));
  const lib = await loadLibrary(root);
  assert.equal(isRcfError(lib), true);
  assert.match(lib.message, /1\.\.99999/);
});

test('refuses a library with duplicate blueprint slugs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  await scaffoldLibrary(root, validManifest({
    blueprints: [
      { slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' },
      { slug: 'auth-oauth2', path: 'blueprints/auth-oauth2-again' },
    ],
  }));
  const lib = await loadLibrary(root);
  assert.equal(isRcfError(lib), true);
  assert.match(lib.message, /declared more than once/);
});

test('attaches globalTopics per blueprint from scope:global ADR contributions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  await scaffoldLibrary(root, validManifest({
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
  }), [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }]);
  // Overwrite the scaffolded blueprint.json with contributions that
  // carry scope:global ADRs and a non-global REQ (ignored).
  const bpDir = join(root, 'blueprints/auth-oauth2');
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({
    slug: 'auth-oauth2',
    version: '1.0.0',
    contributions: [
      { id: 'ADR-5001', kind: 'adr', path: 'authModel.json', scope: 'global', topic: 'authModel' },
      { id: 'ADR-5002', kind: 'adr', path: 'errorEnvelope.json', scope: 'global', topic: 'errorEnvelope' },
      { id: 'REQ-50101', kind: 'req', path: 'req.json' },
    ],
  }, null, 2), 'utf8');
  const lib = await loadLibrary(root);
  assert.equal(isRcfError(lib), false, `loadLibrary failed: ${JSON.stringify(lib)}`);
  assert.deepEqual(lib.blueprints[0].globalTopics, ['authModel', 'errorEnvelope']);
});

test('attaches an empty globalTopics list when no scope:global ADRs are contributed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  await scaffoldLibrary(root, validManifest(), [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }]);
  const lib = await loadLibrary(root);
  assert.equal(isRcfError(lib), false);
  assert.deepEqual(lib.blueprints[0].globalTopics, []);
});

test('validateBlueprints:false skips the per-blueprint walk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-'));
  // Manifest names a blueprint whose directory does not exist. With
  // validateBlueprints:false, load succeeds.
  await scaffoldLibrary(root, validManifest());
  const lib = await loadLibrary(root, { validateBlueprints: false });
  assert.equal(isRcfError(lib), false);
  assert.equal(lib.libraryPrefix, 'wsd');
});
