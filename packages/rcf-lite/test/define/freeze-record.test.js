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
