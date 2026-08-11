// w-2026-07-28-005: test-pointer resolution unit tests. Mirrors the
// cn-resolve suite's shape: clean resolution, each failure mode, the
// honest limitations, and the per-file read cache path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveTestPointers, splitTestPointer, testCaseKey } from '../../../src/core/store/tp-resolve.js';

async function makeRoot(name) {
  return mkdtemp(join(tmpdir(), `rcf-tp-resolve-${name}-`));
}

function ts(testCases, overrides = {}) {
  return {
    id: 'TS-001',
    usId: 'US-101',
    title: 'suite',
    purpose: 'p',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    testCases,
    status: 'draft',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function tc(overrides) {
  return {
    id: 'TC-001-happy',
    acId: 'AC-101-1',
    description: 'happy path',
    status: 'pending',
    ...overrides,
  };
}

async function resolveOne(root, testCase) {
  const tree = { testSuites: [ts([testCase])] };
  const results = await resolveTestPointers({ projectRoot: root, tree });
  return results.get(testCaseKey('TS-001', testCase.id));
}

test('splitTestPointer separates file and test-name on the FIRST ::', () => {
  assert.deepEqual(
    splitTestPointer('test/a.test.js::does the thing'),
    { file: 'test/a.test.js', testName: 'does the thing' },
  );
  // Test names may themselves contain '::'.
  assert.deepEqual(
    splitTestPointer('test/a.test.js::name :: with separator'),
    { file: 'test/a.test.js', testName: 'name :: with separator' },
  );
  assert.deepEqual(splitTestPointer('test/a.test.js'), { file: 'test/a.test.js', testName: null });
  assert.deepEqual(splitTestPointer('test/a.test.js::'), { file: 'test/a.test.js', testName: null });
});

test('resolves a real test declared with single quotes (the repo corpus form)', async () => {
  const root = await makeRoot('clean');
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'save.test.js'), [
    "import { test } from 'node:test';",
    "test('saving a recipe succeeds', () => {});",
    '',
  ].join('\n'), 'utf8');
  const r = await resolveOne(root, tc({ testPointer: 'test/save.test.js::saving a recipe succeeds' }));
  assert.equal(r.resolved, true);
  assert.equal(r.reason, 'ok');
});

test('quoting variants: double quotes, backticks, and modifier chains all anchor', async () => {
  const root = await makeRoot('quotes');
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'quotes.test.js'), [
    'test("double quoted name", () => {});',
    'it(`backtick name`, () => {});',
    "describe('described block', () => {});",
    "test.skip('skipped but declared', () => {});",
    "it.only('focused declaration', () => {});",
    '',
  ].join('\n'), 'utf8');
  for (const name of [
    'double quoted name',
    'backtick name',
    'described block',
    'skipped but declared',
    'focused declaration',
  ]) {
    const r = await resolveOne(root, tc({ testPointer: `test/quotes.test.js::${name}` }));
    assert.equal(r.resolved, true, `expected '${name}' to resolve, got ${r.reason}`);
  }
});

test('test names carrying regex metacharacters resolve (escaping)', async () => {
  const root = await makeRoot('meta');
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'meta.test.js'), [
    "test('handles a[0].b (edge? yes*) $end', () => {});",
    '',
  ].join('\n'), 'utf8');
  const r = await resolveOne(root, tc({ testPointer: 'test/meta.test.js::handles a[0].b (edge? yes*) $end' }));
  assert.equal(r.resolved, true);
});

test('file-missing: pointer into a file that does not exist', async () => {
  const root = await makeRoot('no-file');
  const r = await resolveOne(root, tc({ testPointer: 'test/gone.test.js::anything' }));
  assert.equal(r.resolved, false);
  assert.equal(r.reason, 'file-missing');
});

test('test-missing: file exists but no declaration carries the name (renamed test caught)', async () => {
  const root = await makeRoot('no-test');
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'renamed.test.js'), "test('the new name', () => {});\n", 'utf8');
  const r = await resolveOne(root, tc({ testPointer: 'test/renamed.test.js::the old name' }));
  assert.equal(r.resolved, false);
  assert.equal(r.reason, 'test-missing');
});

test('missing-pointer: a TC without testPointer is unresolved, never assumed covered', async () => {
  const root = await makeRoot('no-pointer');
  const r = await resolveOne(root, tc({}));
  assert.equal(r.resolved, false);
  assert.equal(r.reason, 'missing-pointer');
  assert.equal(r.testPointer, null);
});

test('malformed-pointer: no :: separator, or an empty part', async () => {
  const root = await makeRoot('malformed');
  for (const pointer of ['test/a.test.js', 'test/a.test.js::', '::some name']) {
    const r = await resolveOne(root, tc({ testPointer: pointer }));
    assert.equal(r.resolved, false, `expected ${pointer} to be unresolved`);
    assert.equal(r.reason, 'malformed-pointer');
  }
});

test('unsupported-file-type: a language outside the anchor table reports unresolved, not covered', async () => {
  const root = await makeRoot('lang');
  await writeFile(join(root, 'test_app.py'), "def test_thing():\n    pass\n", 'utf8');
  const r = await resolveOne(root, tc({ testPointer: 'test_app.py::test_thing' }));
  assert.equal(r.resolved, false);
  assert.equal(r.reason, 'unsupported-file-type');
});

test('honest limit: a gutted test body with an intact name resolves clean (semantic drift invisible)', async () => {
  const root = await makeRoot('gutted');
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'gutted.test.js'), [
    "test('asserts the invariant', () => {",
    '  // assertion deleted in a refactor; the name survived',
    '});',
    '',
  ].join('\n'), 'utf8');
  const r = await resolveOne(root, tc({ testPointer: 'test/gutted.test.js::asserts the invariant' }));
  assert.equal(r.resolved, true, 'documented honest limitation: same-named gutted test false-cleans');
});

test('every TC gets an entry; multiple TCs against one file share the read cache', async () => {
  const root = await makeRoot('multi');
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'shared.test.js'), [
    "test('alpha', () => {});",
    "test('beta', () => {});",
    '',
  ].join('\n'), 'utf8');
  const suite = ts([
    tc({ id: 'TC-001-alpha', testPointer: 'test/shared.test.js::alpha' }),
    tc({ id: 'TC-001-beta', testPointer: 'test/shared.test.js::beta' }),
    tc({ id: 'TC-001-gamma', testPointer: 'test/shared.test.js::gamma' }),
    tc({ id: 'TC-001-nofile', testPointer: 'test/absent.test.js::alpha' }),
  ]);
  const results = await resolveTestPointers({ projectRoot: root, tree: { testSuites: [suite] } });
  assert.equal(results.size, 4);
  assert.equal(results.get(testCaseKey('TS-001', 'TC-001-alpha')).resolved, true);
  assert.equal(results.get(testCaseKey('TS-001', 'TC-001-beta')).resolved, true);
  assert.equal(results.get(testCaseKey('TS-001', 'TC-001-gamma')).reason, 'test-missing');
  assert.equal(results.get(testCaseKey('TS-001', 'TC-001-nofile')).reason, 'file-missing');
});

test('empty testSuites (or no testSuites at all) returns an empty map', async () => {
  const root = await makeRoot('empty');
  assert.equal((await resolveTestPointers({ projectRoot: root, tree: {} })).size, 0);
  assert.equal((await resolveTestPointers({ projectRoot: root, tree: { testSuites: [] } })).size, 0);
});
