// End-to-end tests for src/blueprint/remove-resolution.js
// (spec amendment A2, w-2026-09-03-dave-021).
//
// Covers the three behaviours the spec ratified:
//   - REMOVE: dropping the named resolutions[] entry writes the
//     manifest and leaves every other section untouched.
//   - IDEMPOTENT: re-running with the same well-formed ADR id that
//     still names a project ADR on the tree returns
//     `{ removed: false, alreadyAbsent: true }` and does not touch the
//     manifest.
//   - REFUSE: a malformed id, or a well-formed id that names no ADR
//     on the tree and is not on resolutions[], returns a `usage`
//     rcfError (the CLI edge maps that to exit 2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject, walkTree } from '#core/store';
import { removeResolution } from '../../src/blueprint/remove-resolution.js';

async function scaffoldProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-remove-resolution-'));
  const init = await initProject({ projectRoot: root, projectName: 'RemoveResolutionTest' });
  assert.equal(init.kind, undefined, `initProject failed: ${JSON.stringify(init)}`);
  return root;
}

async function writeManifestWithResolution(root, { resolvedByAdrId, topic = 'healthProbes', resolutionId = 'res-2026-09-04-001' }) {
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.resolutions = [
    {
      id: resolutionId,
      createdAt: '2026-09-04T00:00:00Z',
      kind: 'globalAdrTopic',
      topic,
      resolvedByAdrId,
      supersedes: [
        { slug: 'observability-essentials', adrId: 'ADR-801-observability-essentials' },
        { slug: 'observability-probe-endpoints', adrId: 'ADR-1501-observability-probe-endpoints' },
      ],
    },
  ];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

async function writeAdrOnDisk(root, adrId) {
  const adrDir = join(root, 'rcf', 'adrs');
  await mkdir(adrDir, { recursive: true });
  const path = join(adrDir, `${adrId.toLowerCase()}.json`);
  const body = {
    adrId,
    prdId: 'PRD-001',
    tadId: 'TAD-001',
    version: '1.0.0',
    status: 'accepted',
    title: `Project ruling on healthProbes`,
    context: 'Two blueprints previously collided on healthProbes; this ADR was the ruling.',
    decision: 'Adopt probe-endpoints as the sole owner after v2.0.0 alignment.',
    consequences: 'The historical resolution is now redundant; operator may drop it.',
    createdAt: '2026-09-04T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
  };
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return path;
}

test('remove-resolution: drops the named resolutions[] entry and leaves every other manifest section untouched', async () => {
  const root = await scaffoldProject();
  const adrId = 'ADR-011-health-probes';
  await writeAdrOnDisk(root, adrId);
  const manifestPath = await writeManifestWithResolution(root, { resolvedByAdrId: adrId });
  const before = JSON.parse(await readFile(manifestPath, 'utf8'));

  const { tree } = await walkTree({ projectRoot: root });
  const result = await removeResolution({ projectRoot: root, tree, resolvedByAdrId: adrId });
  assert.equal(result.removed, true, `unexpected result: ${JSON.stringify(result)}`);
  assert.equal(result.resolvedByAdrId, adrId);
  assert.equal(result.topic, 'healthProbes');
  assert.equal(result.resolutionId, 'res-2026-09-04-001');

  const after = JSON.parse(await readFile(manifestPath, 'utf8'));
  // resolutions[] fully dropped (was the only entry).
  assert.equal(Array.isArray(after.resolutions) ? after.resolutions.length : 0, 0);
  // Every other section is byte-identical.
  const stripResolutions = (m) => { const c = { ...m }; delete c.resolutions; return c; };
  assert.deepEqual(stripResolutions(after), stripResolutions(before));
  // The ruling ADR file is NOT deleted (operator keeps historical context on request).
  const adrStat = await stat(join(root, 'rcf', 'adrs', `${adrId.toLowerCase()}.json`));
  assert.ok(adrStat.isFile());
});

test('remove-resolution: idempotent on re-run when the ADR still exists on the tree but the resolution is gone', async () => {
  const root = await scaffoldProject();
  const adrId = 'ADR-011-health-probes';
  await writeAdrOnDisk(root, adrId);
  await writeManifestWithResolution(root, { resolvedByAdrId: adrId });

  const walk1 = await walkTree({ projectRoot: root });
  const first = await removeResolution({ projectRoot: root, tree: walk1.tree, resolvedByAdrId: adrId });
  assert.equal(first.removed, true);

  // Second pass: same id, ADR file still on disk. Idempotent no-op.
  const walk2 = await walkTree({ projectRoot: root });
  const second = await removeResolution({ projectRoot: root, tree: walk2.tree, resolvedByAdrId: adrId });
  assert.equal(second.removed, false);
  assert.equal(second.alreadyAbsent, true);
  assert.equal(second.resolvedByAdrId, adrId);
});

test('remove-resolution: refuses with a usage error when the ADR id is malformed', async () => {
  const root = await scaffoldProject();
  const { tree } = await walkTree({ projectRoot: root });
  const bad = await removeResolution({ projectRoot: root, tree, resolvedByAdrId: 'not-an-adr' });
  assert.equal(bad.kind, 'usage');
  assert.match(bad.message, /is not a well-formed ADR id/);
});

test('remove-resolution: refuses with a usage error when the ADR id is well-formed but names no ADR on the tree and no resolutions[] entry', async () => {
  const root = await scaffoldProject();
  // No resolutions on the manifest, no ADR by that id on disk.
  const { tree } = await walkTree({ projectRoot: root });
  const bad = await removeResolution({ projectRoot: root, tree, resolvedByAdrId: 'ADR-999-nowhere' });
  assert.equal(bad.kind, 'usage');
  assert.match(bad.message, /is not a resolution entry on this manifest/);
});

test('remove-resolution: an empty ADR id argument is a usage error', async () => {
  const root = await scaffoldProject();
  const { tree } = await walkTree({ projectRoot: root });
  const bad = await removeResolution({ projectRoot: root, tree, resolvedByAdrId: '' });
  assert.equal(bad.kind, 'usage');
  assert.match(bad.message, /<adr-id> is required/);
});
