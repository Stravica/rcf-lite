// Facade round-trip probe for persistence-data-sqlite v1.1.1.
//
// Opens the store facade, drives put -> get -> delete -> get on a
// fixture key, and asserts a real integer row id was returned by
// the underlying sqlite handle, that the read after put returns the
// same value bytes, that the second read after delete returns null,
// and that the entryPut / entryRead / entryDeleted lifecycle events
// fire once each with metadata-only payloads.
//
// Positive evidence: the real integer row id sqlite assigned
// (created-then-deleted resource id shape), the exact stored value
// bytes on the get record, and the delete's changes counter.
//
// anchorAcId: AC-5102-1 (facade round-trip returns the same value).
// Additional results cover the delete-then-miss shape and event
// integrity.
// accountBound: false.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'AC-5102-1';
export const accountBound = false;

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-sqlite-round-'));
  const path = process.env.RCF_FIXTURE_SQLITE_PATH || join(dir, 'store.sqlite');
  const events = [];
  const results = [];
  let rowId, value = 'hello-world-' + Date.now();
  try {
    const store = openStore({ path, eventSink: (r) => events.push(r) });
    const putResult = store.put('probe/key', value);
    rowId = putResult.rowId;
    results.push({
      anchorAcId: 'AC-5102-1',
      verdict: Number.isInteger(rowId) && rowId > 0 ? 'pass' : 'fail',
      detail: `put returned real integer rowId=${rowId} changes=${putResult.changes}`,
      evidence: { rowId, changes: putResult.changes },
    });
    const got = store.get('probe/key');
    results.push({
      anchorAcId: 'AC-5102-1',
      verdict: got && got.value === value && got.rowId === rowId ? 'pass' : 'fail',
      detail: `get returned rowId=${got?.rowId} valueBytes=${got?.value?.length} match=${got?.value === value}`,
      evidence: { rowIdOnRead: got?.rowId, valueExcerpt: got?.value?.slice(0, 32) },
    });
    const del = store.delete('probe/key');
    const missed = store.get('probe/key');
    results.push({
      anchorAcId: 'AC-5102-2',
      verdict: del.changes === 1 && missed === null ? 'pass' : 'fail',
      detail: `delete changes=${del.changes}; re-read after delete=${missed === null ? 'absent' : 'present'}`,
      evidence: { deleteChanges: del.changes, presentAfterDelete: missed !== null },
    });
    const evPut = events.filter((e) => e.event === 'entryPut');
    const evRead = events.filter((e) => e.event === 'entryRead');
    const evDel = events.filter((e) => e.event === 'entryDeleted');
    const eventOk = evPut.length === 1 && evRead.length === 2 && evDel.length === 1;
    const allowedKeys = new Set(['event', 'key', 'size', 'hit', 'timestamp']);
    const extraKeys = [...evPut, ...evRead, ...evDel].flatMap((e) => Object.keys(e)).filter((k) => !allowedKeys.has(k));
    results.push({
      anchorAcId: 'AC-5102-3',
      verdict: eventOk && extraKeys.length === 0 ? 'pass' : 'fail',
      detail: `event counts put=${evPut.length} read=${evRead.length} delete=${evDel.length}; extraFields=${JSON.stringify(extraKeys)}`,
      evidence: { entryPut: evPut[0], entryReadHit: evRead[0], entryReadMiss: evRead[1], entryDeleted: evDel[0] },
    });
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return {
    results,
    extra: {
      envDeclared: ['RCF_FIXTURE_SQLITE_PATH'],
      rowIdCreatedThenDeleted: rowId,
      valueBytes: value.length,
    },
  };
}
