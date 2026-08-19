// End-to-end tests for src/blueprint/apply.js against a real filesystem
// tree scaffolded via rcf init. Covers AC-1001-1 (add writes to
// manifest.blueprints[]), AC-1001-4 (idempotent re-apply), plus the
// namespaced-contribution write path from AC-1002-1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject, walkTree } from '#core/store';
import { applyBlueprint } from '../../src/blueprint/apply.js';

async function scaffoldProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-blueprint-apply-'));
  const init = await initProject({ projectRoot: root, projectName: 'BlueprintTest' });
  assert.equal(init.kind, undefined, `initProject failed: ${JSON.stringify(init)}`);
  return root;
}

async function writeBlueprint(root, { slug = 'demo', version = '1.0.0', contributions = [] } = {}) {
  const dir = join(root, 'blueprint-src');
  await mkdir(join(dir, 'contributions'), { recursive: true });
  const meta = { slug, version, contributions };
  await writeFile(join(dir, 'blueprint.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  for (const c of contributions) {
    const abs = join(dir, 'contributions', c.path);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, JSON.stringify(c.body, null, 2), 'utf8');
  }
  return dir;
}

const now = new Date('2026-08-19T10:00:00Z');

test('applyBlueprint: writes an entry to manifest.blueprints[] and copies namespaced contributions (AC-1001-1)', async () => {
  const root = await scaffoldProject();
  const req = {
    reqId: 'spa-REQ-001', prdId: 'PRD-001',
    title: 'Every route ships loading + empty + error + success states',
    description: 'Blueprint-owned req.', category: 'functional', priority: 'must', domain: 'ui',
    version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  const source = await writeBlueprint(root, {
    slug: 'spa', version: '1.0.0',
    contributions: [
      { kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json', body: req },
    ],
  });
  const { tree } = await walkTree({ projectRoot: root });
  const result = await applyBlueprint({ projectRoot: root, tree, source, now });
  assert.equal(result.applied, true, `unexpected: ${JSON.stringify(result)}`);
  assert.equal(result.slug, 'spa');
  assert.equal(result.version, '1.0.0');
  assert.equal(result.contributions.length, 1);
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.blueprints.length, 1);
  assert.equal(manifest.blueprints[0].slug, 'spa');
  assert.equal(manifest.blueprints[0].version, '1.0.0');
  assert.equal(manifest.blueprints[0].appliedAt, now.toISOString());
  // The namespaced REQ landed under rcf/requirements/spa-req-001.json.
  const written = JSON.parse(await readFile(join(root, 'rcf', 'requirements', 'spa-req-001.json'), 'utf8'));
  assert.equal(written.reqId, 'spa-REQ-001');
});

test('applyBlueprint: idempotent re-apply of the same slug + version returns alreadyApplied and does not rewrite the manifest (AC-1001-4)', async () => {
  const root = await scaffoldProject();
  const req = {
    reqId: 'spa-REQ-001', prdId: 'PRD-001', title: 'x', description: 'y',
    category: 'functional', priority: 'must', domain: 'ui', version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  const source = await writeBlueprint(root, {
    slug: 'spa', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json', body: req }],
  });
  const first = await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source, now });
  assert.equal(first.applied, true);
  const manifestAfterFirst = await readFile(join(root, 'rcf', 'manifest.json'), 'utf8');
  const second = await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source, now });
  assert.equal(second.applied, false);
  assert.equal(second.alreadyApplied, true);
  const manifestAfterSecond = await readFile(join(root, 'rcf', 'manifest.json'), 'utf8');
  assert.equal(manifestAfterFirst, manifestAfterSecond, 'manifest should not be rewritten on idempotent re-apply');
});

test('applyBlueprint: scope:global ADR conflict across two applied blueprints refuses the second add (AC-1002-2)', async () => {
  const root = await scaffoldProject();
  const adrAlpha = {
    adrId: 'ADR-004-alpha', tadId: 'TAD-001', title: 'Version scheme',
    context: 'x', decision: 'y', consequences: 'z',
    version: '0.1.0', status: 'accepted',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  const adrBeta = { ...adrAlpha, adrId: 'ADR-005-beta', title: 'Different scheme' };
  const alphaSrc = await writeBlueprint(root, {
    slug: 'alpha', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-004-alpha', path: 'adr-004-alpha.json', body: adrAlpha, scope: 'global', topic: 'versioning' },
    ],
  });
  const betaSrc = join(root, 'blueprint-beta');
  await mkdir(join(betaSrc, 'contributions'), { recursive: true });
  await writeFile(join(betaSrc, 'blueprint.json'), JSON.stringify({
    slug: 'beta', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-005-beta', path: 'adr-005-beta.json', scope: 'global', topic: 'versioning' },
    ],
  }, null, 2), 'utf8');
  await writeFile(join(betaSrc, 'contributions', 'adr-005-beta.json'), JSON.stringify(adrBeta, null, 2), 'utf8');

  const first = await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source: alphaSrc, now });
  assert.equal(first.applied, true);
  const second = await applyBlueprint({ projectRoot: root, tree: (await walkTree({ projectRoot: root })).tree, source: betaSrc, now });
  assert.equal(second.applied, false);
  assert.ok(second.conflicts && second.conflicts.length === 1);
  assert.equal(second.conflicts[0].topic, 'versioning');
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.blueprints.length, 1, 'refused apply must not add a manifest entry');
});

// ---------------------------------------------------------------------------
// w-2026-08-19-004 item 3: apply atomicity. A partial write on failure
// must leave no orphan contribution files in the tree and no partial
// manifest entry. The write phase stages every contribution into a
// per-batch sidecar (`<name>.rcf-tmp-<slug>-<epoch>`) and only renames
// the sidecars into place after ALL copies succeed; a failure during
// the copy loop unlinks every already-staged sidecar and returns an
// ioFailure with a "rolled back N staged file(s)" preamble.
// ---------------------------------------------------------------------------

test('applyBlueprint: a mid-batch copy failure rolls back every already-staged sidecar and writes nothing to the tree or manifest (w-2026-08-19-004)', async () => {
  const root = await scaffoldProject();
  const reqA = {
    reqId: 'spa-REQ-001', prdId: 'PRD-001',
    title: 'First requirement', description: 'x', category: 'functional',
    priority: 'must', domain: 'ui', version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  const reqB = { ...reqA, reqId: 'spa-REQ-002', title: 'Second requirement' };
  const source = await writeBlueprint(root, {
    slug: 'spa', version: '1.0.0',
    contributions: [
      { kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json', body: reqA },
      { kind: 'req', id: 'spa-REQ-002', path: 'spa-req-002.json', body: reqB },
    ],
  });

  // Inject a copyFile that succeeds on the first call and throws on the
  // second. This proves the loop unlinks the first sidecar when the
  // second copy fails.
  const { copyFile: realCopy } = await import('node:fs/promises');
  let calls = 0;
  const copyFileForTest = async (src, dest) => {
    calls += 1;
    if (calls === 2) throw new Error('injected mid-apply copy failure');
    return realCopy(src, dest);
  };
  const manifestBefore = await readFile(join(root, 'rcf', 'manifest.json'), 'utf8');
  const { tree } = await walkTree({ projectRoot: root });
  const result = await applyBlueprint({
    projectRoot: root, tree, source, now, _copyFileForTest: copyFileForTest,
  });
  assert.equal(result.kind, 'ioFailure', `expected ioFailure, got ${JSON.stringify(result)}`);
  assert.match(result.message, /rolled back 1 staged file/);
  assert.match(result.message, /injected mid-apply copy failure/);

  // No orphan contribution files in requirements/.
  const files = await readdir(join(root, 'rcf', 'requirements'));
  const spaLeftover = files.filter((f) => f.startsWith('spa-req-') || f.includes('rcf-tmp-'));
  assert.deepEqual(spaLeftover, [], `expected no spa-req or sidecar files left in tree, saw: ${JSON.stringify(files)}`);

  // Manifest byte-identical to pre-call state.
  const manifestAfter = await readFile(join(root, 'rcf', 'manifest.json'), 'utf8');
  assert.equal(manifestAfter, manifestBefore, 'manifest must not be written when the write phase rolled back');
});

test('applyBlueprint: rolls back on failure of the very first copy (no partial sidecars survive)', async () => {
  const root = await scaffoldProject();
  const reqA = {
    reqId: 'spa-REQ-001', prdId: 'PRD-001',
    title: 'First requirement', description: 'x', category: 'functional',
    priority: 'must', domain: 'ui', version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  const source = await writeBlueprint(root, {
    slug: 'spa', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json', body: reqA }],
  });
  const copyFileForTest = async () => { throw new Error('injected first-copy failure'); };
  const { tree } = await walkTree({ projectRoot: root });
  const result = await applyBlueprint({
    projectRoot: root, tree, source, now, _copyFileForTest: copyFileForTest,
  });
  assert.equal(result.kind, 'ioFailure');
  assert.match(result.message, /rolled back 0 staged file/);
  const files = await readdir(join(root, 'rcf', 'requirements'));
  const spaLeftover = files.filter((f) => f.startsWith('spa-req-') || f.includes('rcf-tmp-'));
  assert.deepEqual(spaLeftover, []);
});
