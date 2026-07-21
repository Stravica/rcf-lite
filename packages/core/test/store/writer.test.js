// Phase 4 writer module tests. Exercises the four public functions
// under `src/store/writer.js` end-to-end against a scaffolded tmpdir
// tree, then re-walks the tree after each mutation to prove the tree
// stays schema-valid and the computed inversion maps see the change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { walkTree } from '../../src/store/walker.js';
import {
  createDocument, deleteDocument, deriveSlug, nextIdForKind, updateDocument,
} from '../../src/store/writer.js';

async function scaffold() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'rcf-writer-'));
  await initProject({ projectRoot, projectName: 'WriterTest' });
  const { tree } = await walkTree({ projectRoot });
  return { projectRoot, tree };
}

async function reload(projectRoot) {
  const { tree, errors } = await walkTree({ projectRoot });
  return { tree, errors };
}

// ---- nextIdForKind ---------------------------------------------------------

test('nextIdForKind req allocates max+1 zero-padded 3 digits', async () => {
  const { tree } = await scaffold();
  assert.equal(nextIdForKind(tree, 'req'), 'REQ-002');
});

test('nextIdForKind us uses REQ suffix as first digit', async () => {
  const { tree } = await scaffold();
  // Scaffold: REQ-001, US-101. Next US under REQ-001 is US-102.
  assert.equal(nextIdForKind(tree, 'us', { parentId: 'REQ-001' }), 'US-102');
});

test('nextIdForKind us on a fresh REQ starts at N01', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({ projectRoot, tree, kind: 'req', body: { title: 'Second REQ' }, options: { parentId: 'PRD-001' } });
  assert.equal(res.id, 'REQ-002');
  const reloaded = await reload(projectRoot);
  assert.equal(nextIdForKind(reloaded.tree, 'us', { parentId: 'REQ-002' }), 'US-201');
});

test('nextIdForKind ac uses US suffix and appends -<n>', async () => {
  const { tree } = await scaffold();
  assert.equal(nextIdForKind(tree, 'ac', { parentId: 'US-101' }), 'AC-101-2');
});

test('nextIdForKind ts is sequential across the whole tree (Phase 3.7 D9)', async () => {
  const { tree } = await scaffold();
  assert.equal(nextIdForKind(tree, 'ts'), 'TS-001');
});

test('nextIdForKind tc requires opts.slug and formats TC-<TS-suffix>-<slug>', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({
    projectRoot, tree, kind: 'ts',
    body: { title: 'T', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101' },
  });
  assert.equal(res.id, 'TS-001');
  const reloaded = await reload(projectRoot);
  assert.equal(nextIdForKind(reloaded.tree, 'tc', { parentId: 'TS-001', slug: 'happy-path' }), 'TC-001-happy-path');
});

test('nextIdForKind throws on missing parentId for us/ac/tc', async () => {
  const { tree } = await scaffold();
  assert.throws(() => nextIdForKind(tree, 'us', {}), /parentId/);
  assert.throws(() => nextIdForKind(tree, 'ac', {}), /parentId/);
  assert.throws(() => nextIdForKind(tree, 'tc', {}), /parentId/);
});

// ---- createDocument -------------------------------------------------------

test('createDocument req writes a schema-valid child file', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({
    projectRoot, tree, kind: 'req',
    body: { title: 'New REQ' },
    options: { parentId: 'PRD-001' },
  });
  assert.equal(res.id, 'REQ-002');
  assert.equal(res.filePath, 'rcf/requirements/req-002.json');
  const written = JSON.parse(await readFile(join(projectRoot, res.filePath), 'utf8'));
  assert.equal(written.reqId, 'REQ-002');
  assert.equal(written.prdId, 'PRD-001');
  const { errors } = await reload(projectRoot);
  assert.equal(errors.length, 0);
});

test('createDocument does NOT mutate the parent PRD file (Phase 3.7 §D2)', async () => {
  const { projectRoot, tree } = await scaffold();
  const prdBefore = await readFile(join(projectRoot, 'rcf/prd.json'), 'utf8');
  await createDocument({
    projectRoot, tree, kind: 'req',
    body: { title: 'New REQ' },
    options: { parentId: 'PRD-001' },
  });
  const prdAfter = await readFile(join(projectRoot, 'rcf/prd.json'), 'utf8');
  assert.equal(prdAfter, prdBefore);
});

test('createDocument refuses on unknown parent (brokenReference, exit 3)', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({
    projectRoot, tree, kind: 'req',
    body: { title: 'oops' },
    options: { parentId: 'PRD-999' },
  });
  assert.equal(res.kind, 'brokenReference');
});

test('createDocument refuses on id collision (exit 2)', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({
    projectRoot, tree, kind: 'req',
    body: { title: 'REQ-001 collision' },
    options: { parentId: 'PRD-001', id: 'REQ-001' },
  });
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /already taken/);
});

test('createDocument fbs default --build-order is max+1 (empty siblings -> 1)', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({
    projectRoot, tree, kind: 'fbs',
    body: { title: 'first', acIds: ['AC-101-1'] },
    options: { parentId: 'BS-001', id: 'FBS-101' },
  });
  // Scaffold ships FBS-001 with buildOrder=1, so max+1=2.
  assert.equal(res.body.buildOrder, 2);
});

test('createDocument fbs --build-order collision refused with exit 2 (§D6 amendment)', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({
    projectRoot, tree, kind: 'fbs',
    body: { title: 'collide', acIds: ['AC-101-1'] },
    options: { parentId: 'BS-001', buildOrder: 1 },
  });
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /collides with FBS-001/);
});

test('createDocument fbs acId not in tree -> brokenReference', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({
    projectRoot, tree, kind: 'fbs',
    body: { title: 't', acIds: ['AC-999-1'] },
    options: { parentId: 'BS-001', buildOrder: 2 },
  });
  assert.equal(res.kind, 'brokenReference');
});

test('createDocument ac mutates the parent US and adds inline entry', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({
    projectRoot, tree, kind: 'ac',
    body: { description: 'second AC' },
    options: { parentId: 'US-101' },
  });
  assert.equal(res.id, 'AC-101-2');
  const us = JSON.parse(await readFile(join(projectRoot, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(us.acceptanceCriteria.length, 2);
  assert.equal(us.acceptanceCriteria[1].id, 'AC-101-2');
});

test('createDocument tc mutates the parent TS with derived slug', async () => {
  const { projectRoot, tree } = await scaffold();
  await createDocument({
    projectRoot, tree, kind: 'ts',
    body: { title: 't', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101' },
  });
  const reloaded = await reload(projectRoot);
  const res = await createDocument({
    projectRoot, tree: reloaded.tree, kind: 'tc',
    body: { description: 'The Happy Path!', acId: 'AC-101-1' },
    options: { parentId: 'TS-001', slug: deriveSlug('The Happy Path!') },
  });
  assert.equal(res.id, 'TC-001-the-happy-path');
});

test('createDocument tc slug collision refused (OQ-P4-R-1)', async () => {
  const { projectRoot, tree } = await scaffold();
  await createDocument({
    projectRoot, tree, kind: 'ts',
    body: { title: 't', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101' },
  });
  const reloaded = await reload(projectRoot);
  await createDocument({
    projectRoot, tree: reloaded.tree, kind: 'tc',
    body: { description: 'same', acId: 'AC-101-1' },
    options: { parentId: 'TS-001', slug: 'same' },
  });
  const rw2 = await reload(projectRoot);
  const res = await createDocument({
    projectRoot, tree: rw2.tree, kind: 'tc',
    body: { description: 'same', acId: 'AC-101-1' },
    options: { parentId: 'TS-001', slug: 'same' },
  });
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /slug collision/);
});

test('createDocument dry-run does not write to disk', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await createDocument({
    projectRoot, tree, kind: 'req',
    body: { title: 'dry' },
    options: { parentId: 'PRD-001', dryRun: true },
  });
  assert.equal(res.dryRun, true);
  await assert.rejects(stat(join(projectRoot, res.filePath)), { code: 'ENOENT' });
});

// ---- updateDocument -------------------------------------------------------

test('updateDocument bumps updatedAt on a child doc', async () => {
  const { projectRoot, tree } = await scaffold();
  const original = tree.byId.get('REQ-001');
  const res = await updateDocument({
    projectRoot, tree, id: 'REQ-001',
    sets: [{ path: 'title', value: 'Renamed REQ' }],
  });
  assert.equal(res.id, 'REQ-001');
  const reloaded = await reload(projectRoot);
  assert.equal(reloaded.tree.byId.get('REQ-001').title, 'Renamed REQ');
  assert.notEqual(reloaded.tree.byId.get('REQ-001').updatedAt, original.updatedAt);
});

test('updateDocument refuses to modify id / createdAt / schemaVersion', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await updateDocument({
    projectRoot, tree, id: 'REQ-001',
    sets: [{ path: 'createdAt', value: '2000-01-01T00:00:00Z' }],
  });
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /createdAt/);
});

test('updateDocument on an inline AC-<us>-<n> id mutates the parent US', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await updateDocument({
    projectRoot, tree, id: 'AC-101-1',
    sets: [{ path: 'description', value: 'Sharper AC' }],
  });
  assert.equal(res.parentId, 'US-101');
  const us = JSON.parse(await readFile(join(projectRoot, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(us.acceptanceCriteria[0].description, 'Sharper AC');
});

test('updateDocument on the PRD root singleton works (§D8 root-singleton amendment)', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await updateDocument({
    projectRoot, tree, id: 'PRD-001',
    sets: [{ path: 'problemStatement', value: 'Sharper wedge on X.' }],
  });
  assert.equal(res.id, 'PRD-001');
  const prd = JSON.parse(await readFile(join(projectRoot, 'rcf/prd.json'), 'utf8'));
  assert.equal(prd.problemStatement, 'Sharper wedge on X.');
});

test('updateDocument on the TAD root singleton works (§D8 root-singleton amendment)', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await updateDocument({
    projectRoot, tree, id: 'TAD-001',
    patch: { systemOverview: {
      executiveSummary: 'Refined summary.',
      systemPurpose: 'Refined purpose.',
      architecturalApproach: 'Refined approach.',
      keyCapabilities: ['Refined capability.'],
    } },
  });
  assert.equal(res.id, 'TAD-001');
});

test('updateDocument arrays replace not merge on --from-file', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await updateDocument({
    projectRoot, tree, id: 'PRD-001',
    patch: { objectives: ['only this one'] },
  });
  assert.equal(res.body.objectives.length, 1);
  assert.equal(res.body.objectives[0], 'only this one');
});

test('updateDocument refuses on schema-invalid patch (exit 3)', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await updateDocument({
    projectRoot, tree, id: 'REQ-001',
    sets: [{ path: 'priority', value: 'irresistible' }],
  });
  assert.equal(res.kind, 'validation');
});

// ---- deleteDocument -------------------------------------------------------

test('deleteDocument leaf ADR removes the file', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await deleteDocument({ projectRoot, tree, id: 'ADR-001' });
  assert.deepEqual(res.deleted, ['ADR-001']);
  await assert.rejects(stat(join(projectRoot, 'rcf/adrs/adr-001.json')), { code: 'ENOENT' });
});

test('deleteDocument REQ without --cascade refuses with dependents (exit 4)', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await deleteDocument({ projectRoot, tree, id: 'REQ-001' });
  assert.equal(res.kind, 'usage');
  assert.equal(res.rule, 'dependents');
});

test('deleteDocument REQ --cascade removes REQ + descendant USes + TSs', async () => {
  const { projectRoot, tree } = await scaffold();
  // Build an isolated REQ-002 + US-201 with an AC no FBS references.
  // Direct-delete of the scaffold's REQ-001 would orphan FBS-001.acIds
  // (which references AC-101-1); that path is covered by the amendment
  // test below.
  await createDocument({
    projectRoot, tree, kind: 'req',
    body: { title: 'Second REQ' },
    options: { parentId: 'PRD-001' },
  });
  let reloaded = await reload(projectRoot);
  await createDocument({
    projectRoot, tree: reloaded.tree, kind: 'us',
    body: { title: 'Second US' },
    options: { parentId: 'REQ-002' },
  });
  reloaded = await reload(projectRoot);
  const res = await deleteDocument({
    projectRoot, tree: reloaded.tree, id: 'REQ-002',
    options: { cascade: true },
  });
  assert.ok(res.deleted.includes('REQ-002'));
  assert.ok(res.deleted.includes('US-201'));
  await assert.rejects(stat(join(projectRoot, 'rcf/requirements/req-002.json')), { code: 'ENOENT' });
  await assert.rejects(stat(join(projectRoot, 'rcf/user-stories/us-201.json')), { code: 'ENOENT' });
});

test('deleteDocument REQ --cascade orphan-refuse fires when a surviving FBS would empty its acIds (§D9 Gap 1)', async () => {
  const { projectRoot, tree } = await scaffold();
  // FBS-001 references AC-101-1 exclusively. Deleting REQ-001 --cascade
  // would delete US-101 (owner of AC-101-1) and leave FBS-001.acIds = [].
  const res = await deleteDocument({
    projectRoot, tree, id: 'REQ-001',
    options: { cascade: true },
  });
  assert.equal(res.kind, 'usage');
  assert.equal(res.rule, 'wouldOrphan');
  assert.match(res.message, /orphan/);
});

test('deleteDocument freed id is never reused (§D10 amendment)', async () => {
  const { projectRoot, tree } = await scaffold();
  // Create TS-001, TS-002, TS-003 (via three back-to-back creates).
  const r1 = await createDocument({
    projectRoot, tree, kind: 'ts',
    body: { title: 'a', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101' },
  });
  assert.equal(r1.id, 'TS-001');
  let reloaded = await reload(projectRoot);
  const r2 = await createDocument({
    projectRoot, tree: reloaded.tree, kind: 'ts',
    body: { title: 'b', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101' },
  });
  assert.equal(r2.id, 'TS-002');
  reloaded = await reload(projectRoot);
  const r3 = await createDocument({
    projectRoot, tree: reloaded.tree, kind: 'ts',
    body: { title: 'c', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101' },
  });
  assert.equal(r3.id, 'TS-003');
  reloaded = await reload(projectRoot);
  const del = await deleteDocument({
    projectRoot, tree: reloaded.tree, id: 'TS-002',
  });
  assert.deepEqual(del.deleted, ['TS-002']);
  reloaded = await reload(projectRoot);
  // Next allocation is TS-004, NOT TS-002.
  assert.equal(nextIdForKind(reloaded.tree, 'ts'), 'TS-004');
});

test('deleteDocument dry-run leaves the tree untouched', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await deleteDocument({
    projectRoot, tree, id: 'ADR-001',
    options: { dryRun: true },
  });
  assert.deepEqual(res.deleted, ['ADR-001']);
  const st = await stat(join(projectRoot, 'rcf/adrs/adr-001.json'));
  assert.ok(st.isFile());
});

test('deleteDocument PRD refused (root singleton)', async () => {
  const { projectRoot, tree } = await scaffold();
  const res = await deleteDocument({ projectRoot, tree, id: 'PRD-001' });
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /root singleton/);
});

test('deleteDocument inline AC without --cascade refuses if FBS depends on it (exit 4)', async () => {
  const { projectRoot, tree } = await scaffold();
  // Add a second AC so US-101 isn't left with 0.
  await createDocument({
    projectRoot, tree, kind: 'ac',
    body: { description: 'second' }, options: { parentId: 'US-101' },
  });
  const reloaded = await reload(projectRoot);
  // FBS-001 already references AC-101-1 in the scaffold. Try deleting.
  const res = await deleteDocument({
    projectRoot, tree: reloaded.tree, id: 'AC-101-1',
  });
  assert.equal(res.kind, 'usage');
  assert.equal(res.rule, 'dependents');
});

test('deleteDocument TS is a no-op cascade (no downstream references)', async () => {
  const { projectRoot, tree } = await scaffold();
  await createDocument({
    projectRoot, tree, kind: 'ts',
    body: { title: 't', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101' },
  });
  const reloaded = await reload(projectRoot);
  const res = await deleteDocument({
    projectRoot, tree: reloaded.tree, id: 'TS-001', options: { cascade: true },
  });
  assert.deepEqual(res.deleted, ['TS-001']);
});

test('deriveSlug lowercases and squashes non-alphanumeric runs', () => {
  assert.equal(deriveSlug('Happy Path!'), 'happy-path');
  assert.equal(deriveSlug('   Multi  Space   '), 'multi-space');
  assert.equal(deriveSlug('!!!'), 'tc');
});

// ---- B2 regression (E2E matrix 2026-07-06-003) -----------------------------

test('deriveSlug truncates at a word boundary, never mid-word (B2)', () => {
  // Untruncated slug: "with-several-snags-and-photos-saved-while-offline-on-site".
  // The old .slice(0, 40) produced "...-saved-whil" (chopped mid-word).
  const slug = deriveSlug('With several snags and photos saved while offline on site');
  assert.equal(slug, 'with-several-snags-and-photos-saved');
  assert.equal(slug.length <= 40, true);
  assert.doesNotMatch(slug, /-$/, 'no trailing hyphen');
});

test('deriveSlug keeps a word whose end coincides with the length limit (B2)', () => {
  // "twelve-chars" repeated: "abcdefghijkl-abcdefghijkl-abcdefghijkl" is
  // 38 chars; adding "-ab" ends a word exactly at char 40.
  const slug = deriveSlug('abcdefghijkl abcdefghijkl abcdefghijkl a xyz');
  assert.equal(slug, 'abcdefghijkl-abcdefghijkl-abcdefghijkl-a');
  assert.equal(slug.length, 40);
});

test('deriveSlug with a single over-long word keeps the 40-char prefix (B2)', () => {
  // No word boundary exists inside the limit; the prefix is the only option.
  assert.equal(deriveSlug('x'.repeat(50)), 'x'.repeat(40));
});

// ---- B1 regression (E2E matrix 2026-07-06-003) -----------------------------

test('create then update: updatedAt is a full timestamp never earlier than createdAt (B1)', async () => {
  const { projectRoot, tree } = await scaffold();
  const before = Date.now();
  const created = await createDocument({
    projectRoot, tree, kind: 'req', body: { title: 'Timestamp discipline' }, options: { parentId: 'PRD-001' },
  });
  assert.equal(created.id, 'REQ-002');
  const reloaded = await reload(projectRoot);
  const updated = await updateDocument({
    projectRoot, tree: reloaded.tree, id: 'REQ-002', sets: [{ path: 'title', value: 'Timestamp discipline, renamed' }],
  });
  const body = updated.body;
  const createdAtMs = Date.parse(body.createdAt);
  const updatedAtMs = Date.parse(body.updatedAt);
  assert.equal(Number.isNaN(createdAtMs), false);
  assert.equal(Number.isNaN(updatedAtMs), false);
  assert.equal(updatedAtMs >= createdAtMs, true,
    `updatedAt (${body.updatedAt}) must not precede createdAt (${body.createdAt})`);
  assert.equal(createdAtMs >= before, true, 'createdAt comes from the live writer clock');
  for (const value of [body.createdAt, body.updatedAt]) {
    assert.doesNotMatch(value, /T00:00:00(\.000)?Z$/, `${value} looks midnight-truncated (date-only)`);
  }
});

test('create ignores caller-supplied createdAt / updatedAt - the writer clock wins (B1)', async () => {
  const { projectRoot, tree } = await scaffold();
  // The E2E persona passed a date-only "today" through the MCP body
  // object; serialised as midnight UTC it overrode the writer clock and
  // produced updatedAt EARLIER than the same document's createdAt.
  const midnight = '2026-07-06T00:00:00Z';
  const res = await createDocument({
    projectRoot,
    tree,
    kind: 'req',
    body: { title: 'Clock ownership', createdAt: midnight, updatedAt: midnight },
    options: { parentId: 'PRD-001' },
  });
  assert.equal(res.id, 'REQ-002');
  assert.notEqual(res.body.updatedAt, midnight);
  assert.notEqual(res.body.createdAt, midnight);
  assert.equal(res.body.createdAt, res.body.updatedAt, 'both fields come from the same nowIso() call');
  const onDisk = JSON.parse(await readFile(join(projectRoot, 'rcf/requirements/req-002.json'), 'utf8'));
  assert.equal(onDisk.updatedAt, res.body.updatedAt);
});
