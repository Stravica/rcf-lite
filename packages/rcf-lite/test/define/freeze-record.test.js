// Unit tests for the freeze record loader / writer / validator
// (REQ-172; proposal 2026-09-22 §2.1 v3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FREEZE_RECORD_REL_PATH,
  FreezeRecordError,
  freezeRecordPath,
  loadFreezeRecord,
  saveFreezeRecord,
  validateFreezeRecord,
} from '../../src/define/freeze-record.js';

async function scratch(prefix = 'freeze-') {
  return mkdtemp(join(tmpdir(), prefix));
}

const validRecord = {
  frozenAt: '2026-09-20T14:02:11Z',
  treeHash: `sha256:${'a'.repeat(64)}`,
  docHashes: {
    'PRD-001': `sha256:${'b'.repeat(64)}`,
    'REQ-001': `sha256:${'c'.repeat(64)}`,
  },
  briefStatements: 3,
  override: null,
};

test('freeze-record: loading a missing file returns null', async () => {
  const root = await scratch();
  const result = await loadFreezeRecord({ projectRoot: root });
  assert.equal(result, null);
});

test('freeze-record: saving then loading round-trips the record', async () => {
  const root = await scratch();
  const { filePath } = await saveFreezeRecord({ projectRoot: root, record: validRecord });
  assert.equal(filePath, freezeRecordPath(root));
  const loaded = await loadFreezeRecord({ projectRoot: root });
  assert.deepEqual(loaded, validRecord);
});

test('freeze-record: FREEZE_RECORD_REL_PATH is the proposal-mandated path', () => {
  assert.equal(FREEZE_RECORD_REL_PATH, 'rcf/define/freeze.json');
});

test('freeze-record: a malformed JSON body raises FreezeRecordError with parseFailure code', async () => {
  const root = await scratch();
  const path = freezeRecordPath(root);
  await mkdir(join(root, 'rcf', 'define'), { recursive: true });
  await writeFile(path, '{not json', 'utf8');
  await assert.rejects(
    () => loadFreezeRecord({ projectRoot: root }),
    (err) => err instanceof FreezeRecordError && err.code === 'parseFailure',
  );
});

test('freeze-record: a body missing docHashes fails schema validation with a clear field name', async () => {
  await assert.throws(
    () => validateFreezeRecord({ ...validRecord, docHashes: undefined }),
    (err) => err instanceof FreezeRecordError && err.field === 'docHashes',
  );
});

test('freeze-record: docHashes with a non-sha256 value is refused', async () => {
  await assert.throws(
    () => validateFreezeRecord({
      ...validRecord,
      docHashes: { 'REQ-001': 'sha1:short' },
    }),
    (err) => err instanceof FreezeRecordError && err.field === 'docHashes.REQ-001',
  );
});

test('freeze-record: briefStatements must be a non-negative integer', () => {
  assert.throws(
    () => validateFreezeRecord({ ...validRecord, briefStatements: -1 }),
    (err) => err instanceof FreezeRecordError && err.field === 'briefStatements',
  );
  assert.throws(
    () => validateFreezeRecord({ ...validRecord, briefStatements: 3.5 }),
    (err) => err instanceof FreezeRecordError && err.field === 'briefStatements',
  );
});

test('freeze-record: unknown top-level fields survive a save/load round trip', async () => {
  const root = await scratch();
  const enriched = {
    ...validRecord,
    counts: { req: 30, us: 41 },
    litmus: { attestedAt: ['D3', 'D6'], readers: 0 },
    versions: { rcfLite: '0.29.0', ruleset: 3, schemas: '0.6.3' },
    note: 'Slice 1 baseline',
  };
  await saveFreezeRecord({ projectRoot: root, record: enriched });
  const loaded = await loadFreezeRecord({ projectRoot: root });
  assert.deepEqual(loaded, enriched);
});

test('freeze-record: saveFreezeRecord refuses to write an invalid record', async () => {
  const root = await scratch();
  await assert.rejects(
    () => saveFreezeRecord({
      projectRoot: root,
      record: /** @type {any} */ ({ ...validRecord, treeHash: 'not-a-hash' }),
    }),
    (err) => err instanceof FreezeRecordError && err.field === 'treeHash',
  );
  const contents = await readFile(freezeRecordPath(root), 'utf8').catch(() => null);
  assert.equal(contents, null);
});

// AC-17601-7: override is a required-nullable field. The validator
// throws when the key is missing; loadFreezeRecord defaults missing
// keys to null so pre-slice-3 records survive; saveFreezeRecord
// refuses to write a body that omits override.
test('freeze-record: override is required (nullable) and the loader defaults missing keys to null', async () => {
  // Validator: missing override key throws with field 'override'.
  const { override: _omit, ...withoutOverride } = validRecord;
  assert.throws(
    () => validateFreezeRecord(withoutOverride),
    (err) => err instanceof FreezeRecordError && err.field === 'override',
  );

  // Validator: override === null is legal (the fresh-freeze default).
  const legal = validateFreezeRecord({ ...validRecord, override: null });
  assert.equal(legal.override, null);

  // Validator: override === { reason, by, at } is legal.
  const withOverride = validateFreezeRecord({
    ...validRecord,
    override: { reason: 'Baz override for X', by: 'baz', at: '2026-09-24T10:00:00Z' },
  });
  assert.equal(withOverride.override.reason, 'Baz override for X');

  // Loader: an older on-disk record without the key loads with override defaulted to null.
  const root = await scratch();
  await mkdir(join(root, 'rcf', 'define'), { recursive: true });
  await writeFile(
    freezeRecordPath(root),
    `${JSON.stringify(withoutOverride, null, 2)}\n`,
    'utf8',
  );
  const loaded = await loadFreezeRecord({ projectRoot: root });
  assert.ok(loaded);
  assert.equal(loaded.override, null);

  // Writer: saving a body that omits override is refused before it lands on disk.
  const root2 = await scratch();
  await assert.rejects(
    () => saveFreezeRecord({
      projectRoot: root2,
      record: /** @type {any} */ (withoutOverride),
    }),
    (err) => err instanceof FreezeRecordError && err.field === 'override',
  );
  const contents = await readFile(freezeRecordPath(root2), 'utf8').catch(() => null);
  assert.equal(contents, null);
});
