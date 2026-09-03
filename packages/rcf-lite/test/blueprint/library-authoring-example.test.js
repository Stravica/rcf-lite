// The worked-example library shipped under
// `test/fixtures/library-authoring-example/` is the load-bearing
// content for `docs/library-authoring.md`. These assertions catch a
// drift between the doc's walkthrough and the actual on-disk shape:
// the library must load cleanly under the phase-2b library loader; a
// plain-path apply (A2 route) and a qualified apply (post-registration)
// must produce identical effective slugs and stamped ids.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject, walkTree } from '#core/store';
import { applyBlueprint } from '../../src/blueprint/apply.js';
import { loadLibrary } from '../../src/blueprint/library-loader.js';
import { resolveBlueprintSource } from '../../src/blueprint/shelf-resolver.js';
import { REGISTRY_PATH, REGISTRY_VERSION } from '../../src/blueprint/library-registry.js';
import { isRcfError } from '../../src/core/errors/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');
const FIXTURE_ROOT = resolve(PACKAGE_ROOT, 'test', 'fixtures', 'library-authoring-example');

const now = new Date('2026-09-04T10:00:00Z');

test('worked-example fixture loads cleanly under the library loader (validateBlueprints: true)', async () => {
  const lib = await loadLibrary(FIXTURE_ROOT);
  assert.equal(isRcfError(lib), false, JSON.stringify(lib));
  assert.equal(lib.libraryPrefix, 'wla');
  assert.equal(lib.libraryRef, '1.0.0');
  assert.equal(lib.bands.ac.start, 60000);
  assert.equal(lib.bands.ac.end, 60999);
  assert.equal(lib.blueprints.length, 1);
  assert.equal(lib.blueprints[0].slug, 'example-standard');
});

test('worked-example fixture: plain-path apply (A2) and qualified apply produce identical slug and ids', async () => {
  const bpDirA = join(FIXTURE_ROOT, 'blueprints', 'example-standard');

  // Route A: plain path apply (A2 route)
  const projectA = await scaffoldProject();
  const resA = await resolveBlueprintSource(bpDirA);
  assert.equal(isRcfError(resA), false, JSON.stringify(resA));
  assert.equal(resA.kind, 'library');
  const treeA = (await walkTree({ projectRoot: projectA })).tree;
  const applyA = await applyBlueprint({
    projectRoot: projectA, tree: treeA, source: resA.resolved, now,
    displaySource: resA.original,
    effectiveSlug: resA.effectiveSlug,
    libraryPrefix: resA.libraryPrefix,
    libraryBands: resA.libraryBands,
  });
  assert.equal(applyA.applied, true, JSON.stringify(applyA));

  // Route B: qualified apply after registering the fixture as a local
  // library on a fresh project.
  const projectB = await scaffoldProject();
  await writeFile(join(projectB, REGISTRY_PATH), JSON.stringify({
    registryVersion: REGISTRY_VERSION,
    libraries: [{
      libraryPrefix: 'wla',
      sourceKind: 'local',
      sourceRef: FIXTURE_ROOT,
      displayName: 'Worked-example library authoring fixture',
      publisher: { id: 'wla', displayName: 'Worked-example publisher' },
      libraryRef: '1.0.0',
      bands: { ac: { start: 60000, end: 60999 }, suffixBlocks: [{ kind: 'adr', start: 6000, end: 6099 }] },
      blueprints: [{ slug: 'example-standard', path: 'blueprints/example-standard' }],
      addedAt: '2026-09-03T00:00:00Z',
      reviewedBy: 'operator',
      provenance: { tier: 'local' },
      cachePath: FIXTURE_ROOT,
    }],
  }, null, 2), 'utf8');
  const resB = await resolveBlueprintSource('wla:example-standard', { projectRoot: projectB });
  assert.equal(isRcfError(resB), false, JSON.stringify(resB));
  const treeB = (await walkTree({ projectRoot: projectB })).tree;
  const applyB = await applyBlueprint({
    projectRoot: projectB, tree: treeB, source: resB.resolved, now,
    displaySource: resB.original,
    effectiveSlug: resB.effectiveSlug,
    libraryPrefix: resB.libraryPrefix,
    libraryBands: resB.libraryBands,
  });
  assert.equal(applyB.applied, true, JSON.stringify(applyB));

  // Effective slug is identical on both routes.
  assert.equal(applyA.slug, applyB.slug);
  assert.equal(applyA.slug, 'wla-example-standard');

  // REQ stamped identically on disk (same id, same path).
  const reqA = JSON.parse(await readFile(join(projectA, 'rcf', 'requirements', 'wla-example-standard-req-60001.json'), 'utf8'));
  const reqB = JSON.parse(await readFile(join(projectB, 'rcf', 'requirements', 'wla-example-standard-req-60001.json'), 'utf8'));
  assert.equal(reqA.reqId, 'wla-example-standard-REQ-60001');
  assert.equal(reqA.reqId, reqB.reqId);

  // ADR stamped identically on disk.
  const adrA = JSON.parse(await readFile(join(projectA, 'rcf', 'adrs', 'adr-6001-wla-example-standard.json'), 'utf8'));
  const adrB = JSON.parse(await readFile(join(projectB, 'rcf', 'adrs', 'adr-6001-wla-example-standard.json'), 'utf8'));
  assert.equal(adrA.adrId, 'ADR-6001-wla-example-standard');
  assert.equal(adrA.adrId, adrB.adrId);

  // Both applied records carry the same libraryPrefix.
  const manifestA = JSON.parse(await readFile(join(projectA, 'rcf', 'manifest.json'), 'utf8'));
  const manifestB = JSON.parse(await readFile(join(projectB, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifestA.blueprints[0].libraryPrefix, 'wla');
  assert.equal(manifestB.blueprints[0].libraryPrefix, 'wla');
});

async function scaffoldProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-fixture-wla-'));
  const init = await initProject({ projectRoot: root, projectName: 'LibraryAuthoringExample' });
  assert.equal(init.kind, undefined, JSON.stringify(init));
  return root;
}
