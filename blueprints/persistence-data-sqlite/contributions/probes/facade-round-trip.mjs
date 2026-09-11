// Facade round-trip probe for persistence-data-sqlite.
// Anchors REQ-007-persistence-data-sqlite (facade CRUD) and
// REQ-006-persistence-data-sqlite (event log). Every detail line
// begins with the first eight words of the anchored REQ title.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'REQ-007-persistence-data-sqlite';
export const accountBound = false;
const REQ7 = 'The store facade is the only module that';
const REQ6 = 'A structured event log records store lifecycle events';

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
      anchorAcId: 'REQ-007-persistence-data-sqlite',
      verdict: Number.isInteger(rowId) && rowId > 0 && putResult.changes === 1 ? 'pass' : 'fail',
      detail: `${REQ7} talks to the underlying engine  -  observed put returned real integer rowId=${rowId} changes=${putResult.changes} through the facade's narrow put verb (no raw SQL).`,
      evidence: { rowId, changes: putResult.changes },
    });
    const got = store.get('probe/key');
    results.push({
      anchorAcId: 'REQ-007-persistence-data-sqlite',
      verdict: got && got.value === value && got.rowId === rowId ? 'pass' : 'fail',
      detail: `${REQ7} talks to the underlying engine  -  observed get returned rowId=${got?.rowId} valueBytes=${got?.value?.length} match=${got?.value === value} through the facade's narrow get verb.`,
      evidence: { rowIdOnRead: got?.rowId, valueExcerpt: got?.value?.slice(0, 32) },
    });
    const del = store.delete('probe/key');
    const missed = store.get('probe/key');
    results.push({
      anchorAcId: 'REQ-007-persistence-data-sqlite',
      verdict: del.changes === 1 && missed === null ? 'pass' : 'fail',
      detail: `${REQ7} talks to the underlying engine  -  observed delete changes=${del.changes}; re-read after delete=${missed === null ? 'absent' : 'present'} through the facade's narrow delete then get verbs.`,
      evidence: { rowIdCreatedThenDeleted: rowId, deleteChanges: del.changes, presentAfterDelete: missed !== null },
    });
    const evPut = events.filter((e) => e.event === 'entryPut');
    const evRead = events.filter((e) => e.event === 'entryRead');
    const evDel = events.filter((e) => e.event === 'entryDeleted');
    const eventOk = evPut.length === 1 && evRead.length === 2 && evDel.length === 1;
    const allowedKeys = new Set(['event', 'key', 'size', 'hit', 'timestamp']);
    const extraKeys = [...evPut, ...evRead, ...evDel].flatMap((e) => Object.keys(e)).filter((k) => !allowedKeys.has(k));
    results.push({
      anchorAcId: 'REQ-006-persistence-data-sqlite',
      verdict: eventOk && extraKeys.length === 0 ? 'pass' : 'fail',
      detail: `${REQ6} with defined fields  -  observed event counts put=${evPut.length} read=${evRead.length} delete=${evDel.length}; extraFields=${JSON.stringify(extraKeys)} on the eventSink; the fixture-extended entry* events carry only metadata fields per REQ-006 discipline.`,
      evidence: { entryPut: evPut[0], entryReadHit: evRead[0], entryReadMiss: evRead[1], entryDeleted: evDel[0] },
    });
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SQLITE_PATH'], rowIdCreatedThenDeleted: rowId, valueBytes: value.length } };
}
