// Phase 4 writer module tests. Exercises the four public functions
// under `src/store/writer.js` end-to-end against a scaffolded tmpdir
// tree, then re-walks the tree after each mutation to prove the tree
// stays schema-valid and the computed inversion maps see the change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../../src/core/store/init.js';
import { walkTree } from '../../../src/core/store/walker.js';
import {
  createDocument, deleteDocument, deriveSlug, nextIdForKind, updateDocument,
} from '../../../src/core/store/writer.js';

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

// ---- nextIdForKind us: flat / encoded / mixed trees (issue #256) ---------

/**
 * Write a raw REQ file at `req-<n zero-padded>.json` without going
 * through the writer, so tests can construct trees that carry legacy
 * shapes the writer would never mint fresh.
 */
async function writeRawReq(projectRoot, n) {
  const padded = String(n).padStart(3, '0');
  const doc = {
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    reqId: `REQ-${padded}`,
    prdId: 'PRD-001',
    title: `REQ ${padded}`,
    description: 'legacy-shape probe REQ',
    category: 'functional',
    domain: 'application',
    priority: 'must',
    version: '0.1.0',
    status: 'draft',
  };
  await writeFile(join(projectRoot, 'rcf/requirements', `req-${padded}.json`), JSON.stringify(doc, null, 2));
}

/**
 * Write a raw US file with an arbitrary numeric id, declared reqId and
 * one placeholder AC. Bypasses the writer so tests can model a flat
 * legacy tree (US-161 filed under REQ-053 etc.).
 */
async function writeRawUs(projectRoot, num, reqId) {
  const doc = {
    usId: `US-${num}`,
    prdId: 'PRD-001',
    reqId,
    version: '0.1.0',
    status: 'draft',
    title: `Legacy US ${num}`,
    asA: 'operator',
    iWant: 'a legacy-shape story',
    soThat: 'the mint path is exercised on a flat tree',
    acceptanceCriteria: [
      { id: `AC-${num}-1`, description: 'legacy placeholder AC', testable: true },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf/user-stories', `us-${num}.json`), JSON.stringify(doc, null, 2));
}

test('nextIdForKind us on an all-flat tree extends the flat sequence (#256)', async () => {
  const { projectRoot } = await scaffold();
  // Drop the scaffolded encoded US-101 so the tree carries only flat USes.
  await unlink(join(projectRoot, 'rcf/user-stories/us-101.json'));
  await writeRawReq(projectRoot, 53);
  await writeRawUs(projectRoot, 161, 'REQ-053');
  await writeRawUs(projectRoot, 162, 'REQ-053');
  await writeRawUs(projectRoot, 163, 'REQ-053');
  const { tree } = await reload(projectRoot);
  // Before the fix this returned US-5301 (reqNum*100 + 01).
  assert.equal(nextIdForKind(tree, 'us', { parentId: 'REQ-053' }), 'US-164');
});

test('nextIdForKind us on an all-flat tree extends past every REQ, not just the parent (#256)', async () => {
  const { projectRoot } = await scaffold();
  await unlink(join(projectRoot, 'rcf/user-stories/us-101.json'));
  await writeRawReq(projectRoot, 53);
  await writeRawReq(projectRoot, 90);
  await writeRawUs(projectRoot, 1, 'REQ-001');
  await writeRawUs(projectRoot, 42, 'REQ-053');
  await writeRawUs(projectRoot, 200, 'REQ-090');
  const { tree } = await reload(projectRoot);
  // The flat sequence spans the whole tree, so a mint under any REQ
  // extends past the tree-wide high-water mark.
  assert.equal(nextIdForKind(tree, 'us', { parentId: 'REQ-053' }), 'US-201');
  assert.equal(nextIdForKind(tree, 'us', { parentId: 'REQ-090' }), 'US-201');
});

test('nextIdForKind us on a mixed tree refuses with a message naming both schemes (#256)', async () => {
  const { projectRoot } = await scaffold();
  // Scaffold ships US-101 under REQ-001 (encoded). Add a flat US-500
  // under REQ-001 (declared reqId REQ-001 but the id decomposes as
  // parent=5/local=00, which is flat).
  await writeRawUs(projectRoot, 500, 'REQ-001');
  const { tree } = await reload(projectRoot);
  assert.throws(
    () => nextIdForKind(tree, 'us', { parentId: 'REQ-001' }),
    (err) => (
      err instanceof TypeError
      && /refusing to mint/i.test(err.message)
      && /encoded/i.test(err.message)
      && /flat/i.test(err.message)
      && err.message.includes('US-101')
      && err.message.includes('US-500')
    ),
  );
});

test('nextIdForKind us on an all-encoded tree preserves today\'s behaviour (#256)', async () => {
  const { projectRoot } = await scaffold();
  // Scaffold gives REQ-001 + US-101. Add a second REQ and a second US
  // under REQ-001 via the writer so every id is encoded.
  const t0 = await reload(projectRoot);
  await createDocument({
    projectRoot, tree: t0.tree, kind: 'req',
    body: { title: 'Second REQ' }, options: { parentId: 'PRD-001' },
  });
  const t1 = await reload(projectRoot);
  const secondUs = await createDocument({
    projectRoot, tree: t1.tree, kind: 'us',
    body: { title: 'Second US under REQ-001' },
    options: { parentId: 'REQ-001' },
  });
  assert.equal(secondUs.id, 'US-102');
  const { tree } = await reload(projectRoot);
  // Under REQ-001 the next id is US-103; under REQ-002 the encoded scheme
  // opens with US-201 - unchanged from the pre-fix contract.
  assert.equal(nextIdForKind(tree, 'us', { parentId: 'REQ-001' }), 'US-103');
  assert.equal(nextIdForKind(tree, 'us', { parentId: 'REQ-002' }), 'US-201');
});

test('nextIdForKind us on an empty US tree opens the encoded sequence (#256)', async () => {
  const { projectRoot } = await scaffold();
  await unlink(join(projectRoot, 'rcf/user-stories/us-101.json'));
  const { tree } = await reload(projectRoot);
  // No USes on disk; encoded rule is the default, so REQ-001 opens
  // with US-101 exactly as a fresh project would.
  assert.equal(nextIdForKind(tree, 'us', { parentId: 'REQ-001' }), 'US-101');
});

test('nextIdForKind ac on a flat US tree is unaffected by the US-mint rule (#256)', async () => {
  const { projectRoot } = await scaffold();
  await unlink(join(projectRoot, 'rcf/user-stories/us-101.json'));
  await writeRawReq(projectRoot, 53);
  // A flat US-163 under REQ-053 with two ACs already on the story.
  const doc = {
    usId: 'US-163',
    prdId: 'PRD-001',
    reqId: 'REQ-053',
    version: '0.1.0',
    status: 'draft',
    title: 'Legacy US 163',
    asA: 'operator',
    iWant: 'flat',
    soThat: 'ac minting is exercised on the flat US',
    acceptanceCriteria: [
      { id: 'AC-163-1', description: 'first', testable: true },
      { id: 'AC-163-2', description: 'second', testable: true },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf/user-stories/us-163.json'), JSON.stringify(doc, null, 2));
  const { tree } = await reload(projectRoot);
  // AC minting keeps the US suffix and increments the local counter.
  assert.equal(nextIdForKind(tree, 'ac', { parentId: 'US-163' }), 'AC-163-3');
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

test('createDocument refuses on id collision with different content (exit 3 conflict) and writes nothing (AC-302-2 / R1 extension 2026-10-05)', async () => {
  const { projectRoot, tree } = await scaffold();
  const filesBefore = await readdir(join(projectRoot, 'rcf/requirements'));
  const existingBefore = await readFile(join(projectRoot, 'rcf/requirements/req-001.json'), 'utf8');
  const res = await createDocument({
    projectRoot, tree, kind: 'req',
    body: { title: 'REQ-001 collision' },
    options: { parentId: 'PRD-001', id: 'REQ-001' },
  });
  // Ruling R1 extension 2026-10-05 (PR 292 follow-up): a same-id
  // override with different content refuses with kind: 'conflict'
  // (CLI maps to exit 3) and names the differing field keys. Pre-
  // follow-up this was kind: 'usage' with "already taken".
  assert.equal(res.kind, 'conflict');
  assert.match(res.message, /REQ-001/);
  assert.match(res.message, /differing fields/);
  // No file is written: the directory holds the same set of files and the
  // colliding document's file is byte-identical.
  const filesAfter = await readdir(join(projectRoot, 'rcf/requirements'));
  assert.deepEqual(filesAfter.sort(), filesBefore.sort());
  const existingAfter = await readFile(join(projectRoot, 'rcf/requirements/req-001.json'), 'utf8');
  assert.equal(existingAfter, existingBefore);
});

test('createDocument returns status unchanged on a byte-identical same-id replay (R1 extension 2026-10-05)', async () => {
  const { projectRoot, tree } = await scaffold();
  // Build a request whose would-be body equals the on-disk REQ-001
  // modulo writer-owned timestamps (createdAt/updatedAt). The seeded
  // tree carries REQ-001 with title "First requirement" from
  // src/core/store/init.js; replay with the same shape.
  const existing = JSON.parse(await readFile(join(projectRoot, 'rcf/requirements/req-001.json'), 'utf8'));
  const existingBefore = await readFile(join(projectRoot, 'rcf/requirements/req-001.json'), 'utf8');
  const res = await createDocument({
    projectRoot, tree, kind: 'req',
    body: {
      title: existing.title,
      description: existing.description,
      category: existing.category,
      domain: existing.domain,
      priority: existing.priority,
      version: existing.version,
      status: existing.status,
    },
    options: { parentId: 'PRD-001', id: 'REQ-001' },
  });
  // Writer returns the unchanged result: no error.
  assert.equal(typeof res.kind, 'undefined', `expected no error kind; got ${JSON.stringify(res)}`);
  assert.equal(res.status, 'unchanged');
  assert.equal(res.id, 'REQ-001');
  // File is byte-identical.
  const existingAfter = await readFile(join(projectRoot, 'rcf/requirements/req-001.json'), 'utf8');
  assert.equal(existingAfter, existingBefore);
});

test('createDocument with a schema-invalid body writes nothing and returns the validation error (AC-302-3)', async () => {
  const { projectRoot, tree } = await scaffold();
  const filesBefore = await readdir(join(projectRoot, 'rcf/requirements'));
  // `category` is an enum; an out-of-enum value fails schema validation
  // of the assembled body before anything touches disk.
  const res = await createDocument({
    projectRoot, tree, kind: 'req',
    body: { title: 'valid title', category: 'nonsense' },
    options: { parentId: 'PRD-001' },
  });
  // The validation error is returned...
  assert.equal(res.kind, 'validation');
  assert.match(res.message, /category/);
  // ...and nothing is written: no new file appeared in the target dir.
  const filesAfter = await readdir(join(projectRoot, 'rcf/requirements'));
  assert.deepEqual(filesAfter.sort(), filesBefore.sort());
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

test('createDocument ac replaces the seeded phantom on first call, appends on the next', async () => {
  const { projectRoot, tree } = await scaffold();
  // First call: US-101 has only the seeded placeholder AC, so the new AC
  // REPLACES it in place at AC-101-1 (0.13.0 phantom-AC fix, G5).
  const res = await createDocument({
    projectRoot, tree, kind: 'ac',
    body: { description: 'first real AC' },
    options: { parentId: 'US-101' },
  });
  assert.equal(res.id, 'AC-101-1');
  const us = JSON.parse(await readFile(join(projectRoot, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(us.acceptanceCriteria.length, 1);
  assert.equal(us.acceptanceCriteria[0].id, 'AC-101-1');
  assert.equal(us.acceptanceCriteria[0].description, 'first real AC');

  // Reload and add a second AC: the seed is gone, so the append path runs
  // and lands at AC-101-2.
  const reloaded = await reload(projectRoot);
  const res2 = await createDocument({
    projectRoot, tree: reloaded.tree, kind: 'ac',
    body: { description: 'second AC' },
    options: { parentId: 'US-101' },
  });
  assert.equal(res2.id, 'AC-101-2');
  const us2 = JSON.parse(await readFile(join(projectRoot, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(us2.acceptanceCriteria.length, 2);
  assert.equal(us2.acceptanceCriteria[1].id, 'AC-101-2');
});

test('createDocument ac appends (does not replace) when the parent US already carries an operator-edited AC', async () => {
  // If the operator has edited the seed (custom given/when/then, changed
  // the description, changed testable, etc.), the phantom detector no
  // longer recognises it and the new AC appends normally at -2. Locks the
  // strict-match rule so we never overwrite operator content.
  const { projectRoot, tree } = await scaffold();
  const parentUs = tree.byId.get('US-101');
  parentUs.acceptanceCriteria = [{
    id: 'AC-101-1',
    description: 'Operator has written a real AC here already',
    testable: true,
  }];
  const { writeFile: fsWrite } = await import('node:fs/promises');
  await fsWrite(join(projectRoot, 'rcf/user-stories/us-101.json'), JSON.stringify(parentUs, null, 2), 'utf8');
  const reloaded = await reload(projectRoot);
  const res = await createDocument({
    projectRoot, tree: reloaded.tree, kind: 'ac',
    body: { description: 'a second AC on an operator-edited US' },
    options: { parentId: 'US-101' },
  });
  assert.equal(res.id, 'AC-101-2');
  const us = JSON.parse(await readFile(join(projectRoot, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(us.acceptanceCriteria.length, 2);
  assert.equal(us.acceptanceCriteria[0].description, 'Operator has written a real AC here already');
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
    options: { parentId: 'TS-001', slug: deriveSlug('The Happy Path!'), testPointer: 'test/happy.test.js::the happy path' },
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
    options: { parentId: 'TS-001', slug: 'same', testPointer: 'test/same.test.js::same' },
  });
  const rw2 = await reload(projectRoot);
  const res = await createDocument({
    projectRoot, tree: rw2.tree, kind: 'tc',
    body: { description: 'same', acId: 'AC-101-1' },
    options: { parentId: 'TS-001', slug: 'same', testPointer: 'test/same.test.js::same' },
  });
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /slug collision/);
});

// w-2026-07-28-005: a TC is a coverage claim; without a pointer there is
// nothing behind the claim, so creation refuses up front.
test('createDocument tc without testPointer is refused with a usage error', async () => {
  const { projectRoot, tree } = await scaffold();
  await createDocument({
    projectRoot, tree, kind: 'ts',
    body: { title: 't', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101' },
  });
  const reloaded = await reload(projectRoot);
  const res = await createDocument({
    projectRoot, tree: reloaded.tree, kind: 'tc',
    body: { description: 'no pointer', acId: 'AC-101-1' },
    options: { parentId: 'TS-001', slug: 'no-pointer' },
  });
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /--test-pointer is required/);
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
  // 0.8.0 slug-train (w-2026-07-28-012 landmine 4): deriveSlug returns ''
  // on empty derivation now rather than the TC-specific literal 'tc'. TC
  // callers apply `|| 'tc'` locally; every non-TC caller decides its own
  // fallback (or refuses). The pre-0.8.0 shape leaked 'tc' into any
  // kind whose title derived to empty (e.g. FBS-004-tc), which is wrong.
  assert.equal(deriveSlug('!!!'), '');
});

test('0.8.0 slug-train (landmine 4): deriveSlug returns empty string, not the "tc" literal', () => {
  // Regression guard for w-2026-07-28-012 landmine 4. If a caller regresses
  // this to `slug.length > 0 ? slug : 'tc'`, non-TC callers (FBS, CN, ADR,
  // TAC) that derive to an empty slug would silently produce an id ending
  // in `-tc` -- wrong kind label baked in as a slug. The bare deriveSlug
  // contract is now purely: derive OR empty.
  assert.equal(deriveSlug(''), '');
  assert.equal(deriveSlug('   '), '');
  assert.equal(deriveSlug('---'), '');
  assert.notEqual(deriveSlug('!!!'), 'tc');
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

// ---------------------------------------------------------------------------
// 0.8.0 slug-train (w-2026-07-28-012 landmine 2): nextFlatId used to be
// slug-blind. Its regex `^${prefix}-(\d+)$` matched only numeric-only ids;
// a slugged id (rcf-schemas 0.4.3 admits FBS-003-user-login) was invisible
// to the high-water mark and the allocator reset to 001 and re-issued
// taken numbers. The fix uses the shared idNumber(id, prefix) helper
// (ids.js) which parses both shapes.
// ---------------------------------------------------------------------------
test('nextIdForKind sees slugged ids in the occupancy set (0.8.0 landmine 2)', async () => {
  const { projectRoot } = await scaffold();
  // Author a slugged FBS with number 4. Without the landmine 2 fix,
  // nextIdForKind('fbs') would re-issue FBS-001 (because the allocator's
  // regex `^FBS-(\d+)$` fails against `FBS-004-user-login`, so the
  // high-water mark stays at 0 for FBS on a fresh scaffold that carries
  // only the slugged one).
  const { writeFile } = await import('node:fs/promises');
  const slugFbs = {
    fbsId: 'FBS-004-user-login',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    title: 'User login (slugged)',
    summary: 'Regression fixture for landmine 2: allocator must see FBS-004 through the slug tail.',
    approach: 'The allocator parses id numbers via ids.js idNumber(), not a local slug-blind regex.',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    buildOrder: 2,
    executionStatus: 'notStarted',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'fbs', 'fbs-004-user-login.json'), JSON.stringify(slugFbs), 'utf8');
  const reloaded = await reload(projectRoot);
  const nextId = nextIdForKind(reloaded.tree, 'fbs');
  // Without the fix this would be FBS-002 (only the scaffold's FBS-001
  // was visible to the regex). With the fix the slugged FBS-004 is
  // visible and nextIdForKind returns FBS-005.
  assert.equal(nextId, 'FBS-005', 'allocator must see slugged FBS-004 in the high-water mark');
});

test('nextIdForKind never re-issues a slugged FBS number even without a companion numeric-only FBS at the same slot (0.8.0 landmine 2)', async () => {
  const { projectRoot } = await scaffold();
  const { writeFile, unlink } = await import('node:fs/promises');
  // Remove the scaffold's FBS-001 and replace with a slugged FBS-007 only:
  // the fix must still resolve nextId to FBS-008, not FBS-001 (fresh reset).
  await unlink(join(projectRoot, 'rcf', 'fbs', 'fbs-001.json'));
  const slugFbs = {
    fbsId: 'FBS-007-lonely-slug',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    title: 'Lonely slug',
    summary: 'Fixture proving the high-water mark is set from a slugged id alone.',
    approach: 'When the only FBS on disk is slugged, the allocator still sees its number.',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    buildOrder: 1,
    executionStatus: 'notStarted',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'fbs', 'fbs-007-lonely-slug.json'), JSON.stringify(slugFbs), 'utf8');
  const reloaded = await reload(projectRoot);
  assert.equal(nextIdForKind(reloaded.tree, 'fbs'), 'FBS-008');
});

// ---------------------------------------------------------------------------
// 0.8.0 slug-train (w-2026-07-28-012 landmine 3): the writer's TC-slot
// allocator used a hardcoded `\d{3}` TS-suffix match. The moment a TS
// crosses 999 (rcf-schemas 0.4.3 admits TS-1000), the allocator refused
// with "unrecognised TS id" even though the schema admitted the parent.
// ---------------------------------------------------------------------------
test('nextIdForKind tc admits a TS beyond 999 (0.8.0 landmine 3)', async () => {
  const { projectRoot } = await scaffold();
  const { writeFile } = await import('node:fs/promises');
  const bigTs = {
    id: 'TS-1000',
    usId: 'US-101',
    status: 'draft',
    title: 'TS beyond the 999 wall',
    purpose: 'Regression fixture for landmine 3: allocator must parse a four-digit TS suffix.',
    acIds: ['AC-101-1'],
    testLevel: 'unit',
    testCases: [],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'test-suites', 'ts-1000.json'), JSON.stringify(bigTs), 'utf8');
  const reloaded = await reload(projectRoot);
  // Without the widening this throws "nextIdForKind tc: unrecognised TS id".
  const tcId = nextIdForKind(reloaded.tree, 'tc', { parentId: 'TS-1000', slug: 'first-case' });
  assert.equal(tcId, 'TC-1000-first-case');
});

test('walker inline-TC prefix-match rule fires for TS beyond 999 (0.8.0 landmine 3, walker.js:851)', async () => {
  // The dual of the writer widening: the walker's inline-TC prefix-mismatch
  // check used the same hardcoded \d{3}. On a TS-1000 the tsSuffix match
  // failed, the check silently skipped every inline TC under that TS, and a
  // mismatched TC prefix would ship un-flagged. This test asserts the
  // check now fires (a TC-999-x under TS-1000 must surface as a
  // brokenReference / idPrefixMatchesParent).
  const { projectRoot } = await scaffold();
  const { writeFile } = await import('node:fs/promises');
  const badTs = {
    id: 'TS-1000',
    usId: 'US-101',
    status: 'draft',
    title: 'TS with a mismatched TC prefix',
    purpose: 'Landmine 3 walker guard: prove the prefix-match check fires beyond 999.',
    acIds: ['AC-101-1'],
    testLevel: 'unit',
    // TC prefix says 999 while the parent TS is 1000 -- must be flagged.
    testCases: [{ id: 'TC-999-wrong-prefix', acId: 'AC-101-1', description: 'x', status: 'pending', testPointer: 'test/x.test.js::x' }],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'test-suites', 'ts-1000.json'), JSON.stringify(badTs), 'utf8');
  const reloaded = await reload(projectRoot);
  const mismatch = reloaded.errors.find((e) => e.rule === 'idPrefixMatchesParent' && e.documentId === 'TS-1000');
  assert.ok(mismatch, `expected an idPrefixMatchesParent error for TS-1000; got ${JSON.stringify(reloaded.errors, null, 2)}`);
});
