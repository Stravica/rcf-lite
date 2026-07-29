// globallyUniqueIds (w-2026-07-28-017).
//
// Before this rule the walker had NO duplicate detection anywhere:
// `tree.byId` was last-write-wins, `collectAllAcIds()` folded colliding
// acceptance criteria into one Set entry, and a tree carrying two things
// at one address validated perfectly clean. The allocator then compounded
// it by handing out ids that were already taken.
//
// Scope of the rule is GLOBAL, not per parent: `tree.byId` is one flat
// map, `pathForId()` resolves any id from its prefix alone, and every
// read/trace surface takes a bare id. An id is an address; two things at
// one address is a bug whatever their parents.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normaliseId, sameId } from '@stravica-ai/rcf-lite-core/store/ids.js';
import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';
import { walkTree } from '@stravica-ai/rcf-lite-core/store/walker.js';
import { nextIdForKind } from '@stravica-ai/rcf-lite-core/store/writer.js';

async function scaffold(tag) {
  const root = await mkdtemp(join(tmpdir(), `rcf-dupid-${tag}-`));
  await initProject({ projectRoot: root });
  return root;
}

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const writeJson = (p, body) => writeFile(p, `${JSON.stringify(body, null, 2)}\n`, 'utf8');

const dupErrors = (errors) => errors.filter((e) => e.kind === 'duplicateId');

/** A schema-valid Test Suite over the scaffold's US-101 / AC-101-1. */
function testSuiteFixture(testCases) {
  return {
    id: 'TS-001',
    usId: 'US-101',
    title: 'Suite',
    purpose: 'Exercise the acceptance criterion.',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    testCases,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const testCase = (id, description) => ({
  id,
  acId: 'AC-101-1',
  description,
  status: 'pending',
  // w-2026-07-28-005: testPointer is schema-required on every TC.
  testPointer: 'test/example.test.js::example',
});

// ---- normalisation --------------------------------------------------------

test('normaliseId folds leading zeros in every all-digit segment', () => {
  assert.equal(normaliseId('REQ-001'), 'REQ-1');
  assert.equal(normaliseId('REQ-0001'), 'REQ-1');
  assert.equal(normaliseId('US-0101'), 'US-101');
  assert.equal(normaliseId('AC-101-01'), 'AC-101-1');
  assert.equal(normaliseId('AC-0101-001'), 'AC-101-1');
});

test('normaliseId leaves non-numeric segments alone (TC slugs are words, not numbers)', () => {
  assert.equal(normaliseId('TC-001-step02'), 'TC-1-step02');
  assert.notEqual(normaliseId('TC-001-step02'), normaliseId('TC-001-step2'));
  assert.equal(normaliseId('TC-001-alpha-beta'), 'TC-1-alpha-beta');
});

test('normaliseId is precision-safe for long numeric segments', () => {
  const long = `REQ-${'0'.repeat(4)}${'9'.repeat(25)}`;
  assert.equal(normaliseId(long), `REQ-${'9'.repeat(25)}`);
});

test('normaliseId returns the empty string for non-strings, and sameId never matches on it', () => {
  assert.equal(normaliseId(undefined), '');
  assert.equal(normaliseId(null), '');
  assert.equal(sameId(undefined, undefined), false);
  assert.equal(sameId('REQ-001', 'REQ-0001'), true);
  assert.equal(sameId('REQ-001', 'REQ-002'), false);
});

// ---- detection: no false positives ----------------------------------------

test('a clean scaffold carries no duplicateId errors', async () => {
  const root = await scaffold('clean');
  const { errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(dupErrors(errors), [], JSON.stringify(errors, null, 2));
});

test('two ACs with adjacent local numbers under one US are not duplicates', async () => {
  const root = await scaffold('adjacent');
  const p = join(root, 'rcf', 'user-stories', 'us-101.json');
  const us = await readJson(p);
  const first = us.acceptanceCriteria[0];
  us.acceptanceCriteria = [first, { ...first, id: 'AC-101-2' }];
  await writeJson(p, us);
  const { errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(dupErrors(errors), []);
});

// ---- detection: inline acceptance criteria --------------------------------

test('two ACs sharing an id INSIDE ONE US file are a duplicateId error', async () => {
  const root = await scaffold('ac-same-us');
  const p = join(root, 'rcf', 'user-stories', 'us-101.json');
  const us = await readJson(p);
  const first = us.acceptanceCriteria[0];
  us.acceptanceCriteria = [first, { ...first, description: 'a second AC wearing the same id' }];
  await writeJson(p, us);

  const { errors } = await walkTree({ projectRoot: root });
  const dups = dupErrors(errors);
  // One error per claiming location, so CI names every site of the collision.
  assert.equal(dups.length, 2, JSON.stringify(errors, null, 2));
  for (const e of dups) {
    assert.equal(e.rule, 'globallyUniqueIds');
    assert.equal(e.documentId, 'US-101');
    assert.equal(e.filePath, 'rcf/user-stories/us-101.json');
    assert.match(e.message, /Duplicate id AC-101-1/);
    // The message names BOTH offending locations, not just "duplicate found".
    assert.match(e.message, /acceptanceCriteria\[0\]\.id/);
    assert.match(e.message, /acceptanceCriteria\[1\]\.id/);
  }
  assert.deepEqual(dups.map((e) => e.field), ['acceptanceCriteria[0].id', 'acceptanceCriteria[1].id']);
});

test('one AC id claimed by TWO different US files is a duplicateId error naming both files', async () => {
  const root = await scaffold('ac-two-us');
  const p = join(root, 'rcf', 'user-stories', 'us-101.json');
  const us = await readJson(p);
  // A second US in the same REQ group, reusing the first US's AC id.
  const us2 = { ...JSON.parse(JSON.stringify(us)), usId: 'US-102', title: 'Second story' };
  us2.acceptanceCriteria = [{ ...us.acceptanceCriteria[0] }];
  await writeJson(join(root, 'rcf', 'user-stories', 'us-102.json'), us2);

  const { errors } = await walkTree({ projectRoot: root });
  const dups = dupErrors(errors).filter((e) => e.message.includes('AC-101-1'));
  assert.equal(dups.length, 2, JSON.stringify(errors, null, 2));
  const files = new Set(dups.map((e) => e.filePath));
  assert.deepEqual([...files].sort(), ['rcf/user-stories/us-101.json', 'rcf/user-stories/us-102.json']);
  assert.match(dups[0].message, /us-101\.json/);
  assert.match(dups[0].message, /us-102\.json/);
});

// ---- detection: inline test cases -----------------------------------------

test('two TCs sharing an id inside one TS are a duplicateId error', async () => {
  const root = await scaffold('tc-same-ts');
  await writeJson(
    join(root, 'rcf', 'test-suites', 'ts-001.json'),
    testSuiteFixture([testCase('TC-001-alpha', 'first'), testCase('TC-001-alpha', 'second')]),
  );
  const { errors } = await walkTree({ projectRoot: root });
  const dups = dupErrors(errors);
  assert.equal(dups.length, 2, JSON.stringify(errors, null, 2));
  assert.equal(dups[0].documentId, 'TS-001');
  assert.match(dups[0].message, /Duplicate id TC-001-alpha/);
  assert.deepEqual(dups.map((e) => e.field), ['testCases[0].id', 'testCases[1].id']);
});

test('TC slugs differing by a zero inside a word are NOT duplicates', async () => {
  const root = await scaffold('tc-slug');
  await writeJson(
    join(root, 'rcf', 'test-suites', 'ts-001.json'),
    testSuiteFixture([testCase('TC-001-step2', 'first'), testCase('TC-001-step02', 'second')]),
  );
  const { errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(dupErrors(errors), [], JSON.stringify(errors, null, 2));
});

// ---- detection: leading zeros on standalone documents ---------------------

test('REQ-001 and REQ-0001 are one id and collide after normalisation', async () => {
  const root = await scaffold('leading-zero');
  const req = await readJson(join(root, 'rcf', 'requirements', 'req-001.json'));
  await writeJson(join(root, 'rcf', 'requirements', 'req-0001.json'), { ...req, reqId: 'REQ-0001' });

  const { errors } = await walkTree({ projectRoot: root });
  const dups = dupErrors(errors);
  assert.equal(dups.length, 2, JSON.stringify(errors, null, 2));
  // The message has to explain WHY two different-looking ids collide.
  assert.match(dups[0].message, /differ only by leading zeros/);
  assert.match(dups[0].message, /req-001\.json/);
  assert.match(dups[0].message, /req-0001\.json/);
  assert.deepEqual(dups.map((e) => e.documentId).sort(), ['REQ-0001', 'REQ-001']);
});

test('a document filed under one id while declaring another occupies BOTH ids', async () => {
  const root = await scaffold('diverge');
  const req = await readJson(join(root, 'rcf', 'requirements', 'req-001.json'));
  // req-002.json declares reqId REQ-001: two files, one declared identity.
  await writeJson(join(root, 'rcf', 'requirements', 'req-002.json'), { ...req, title: 'Impostor' });

  const { errors } = await walkTree({ projectRoot: root });
  const dups = dupErrors(errors);
  assert.equal(dups.length, 2, JSON.stringify(errors, null, 2));
  assert.match(dups[0].message, /Duplicate id REQ-001/);
  assert.match(dups[0].message, /req-001\.json/);
  assert.match(dups[0].message, /req-002\.json/);
});

test('a case-only filename collision is refused rather than silently collapsed', async (t) => {
  const probe = await mkdtemp(join(tmpdir(), 'rcf-dupid-casecheck-'));
  await writeFile(join(probe, 'AAA'), 'x', 'utf8');
  let caseSensitive = true;
  try {
    await readFile(join(probe, 'aaa'), 'utf8');
    caseSensitive = false;
  } catch { /* distinct paths: the filesystem is case-sensitive */ }
  await rm(probe, { recursive: true, force: true });
  if (!caseSensitive) {
    // macOS APFS folds case, so the two files cannot coexist to be tested.
    // Linux CI is case-sensitive and does run this.
    t.skip('filesystem is case-insensitive; the collision is unrepresentable here');
    return;
  }

  const root = await scaffold('case');
  const req = await readJson(join(root, 'rcf', 'requirements', 'req-001.json'));
  await writeJson(join(root, 'rcf', 'requirements', 'REQ-001.json'), req);
  const { tree, errors } = await walkTree({ projectRoot: root });
  const dups = dupErrors(errors);
  assert.equal(dups.length, 1, JSON.stringify(errors, null, 2));
  assert.equal(dups[0].field, 'filename');
  assert.equal(dups[0].documentId, 'REQ-001');
  // The first file on disk wins; the second is reported, not absorbed.
  assert.equal(tree.requirements.length, 1);
});

// ---- allocation -----------------------------------------------------------

test('US allocation groups by REQ NUMBER, so a leading-zero REQ cannot re-issue a taken US id', async () => {
  const root = await scaffold('alloc-us');
  const req = await readJson(join(root, 'rcf', 'requirements', 'req-001.json'));
  await writeJson(join(root, 'rcf', 'requirements', 'req-0001.json'), { ...req, reqId: 'REQ-0001' });
  const { tree } = await walkTree({ projectRoot: root });

  // The scaffold already holds US-101 under REQ-001. Allocating for the
  // leading-zero spelling used to hand back US-101 a second time.
  assert.equal(nextIdForKind(tree, 'us', { parentId: 'REQ-001' }), 'US-102');
  assert.equal(nextIdForKind(tree, 'us', { parentId: 'REQ-0001' }), 'US-102');
});

test('flat allocation respects an id occupied only by a filename', async () => {
  const root = await scaffold('alloc-flat');
  const req = await readJson(join(root, 'rcf', 'requirements', 'req-001.json'));
  // req-002.json exists on disk but declares REQ-001; REQ-002 is taken.
  await writeJson(join(root, 'rcf', 'requirements', 'req-002.json'), { ...req, title: 'Impostor' });
  const { tree } = await walkTree({ projectRoot: root });
  assert.equal(nextIdForKind(tree, 'req'), 'REQ-003');
});

test('AC allocation counts a leading-zero local number against the same US', async () => {
  const root = await scaffold('alloc-ac');
  const p = join(root, 'rcf', 'user-stories', 'us-101.json');
  const us = await readJson(p);
  us.acceptanceCriteria = [{ ...us.acceptanceCriteria[0], id: 'AC-101-01' }];
  await writeJson(p, us);
  const { tree } = await walkTree({ projectRoot: root });
  // AC-101-01 is local number 1, so the next free local number is 2.
  assert.equal(nextIdForKind(tree, 'ac', { parentId: 'US-101' }), 'AC-101-2');
});

test('flat allocation still respects a leading-zero spelling of the high-water mark', async () => {
  const root = await scaffold('alloc-zero');
  const req = await readJson(join(root, 'rcf', 'requirements', 'req-001.json'));
  await writeJson(join(root, 'rcf', 'requirements', 'req-0009.json'), { ...req, reqId: 'REQ-0009' });
  const { tree } = await walkTree({ projectRoot: root });
  assert.equal(nextIdForKind(tree, 'req'), 'REQ-010');
});
