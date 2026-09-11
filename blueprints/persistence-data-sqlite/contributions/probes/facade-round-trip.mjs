// Facade round-trip probe for persistence-data-sqlite.
//
// The CRUD rows (put/get/delete via the fixture's store facade) do
// NOT observe REQ-007's SOLE-IMPORTER property (the facade is the
// only module importing the engine binding). REQ-007's property is
// a repo-scan of source modules, not a runtime call trace. Per
// closure-3 §(2) those rows are de-claimed (anchorAcId=null,
// conformanceOnly true) and retained as conformance signal.
//
// The event row observes entryPut / entryRead / entryDeleted which
// are NOT among REQ-006's four defined lifecycle events {opened,
// migrated, backupCheckpoint, closed}. That row is de-claimed too.
//
// Every detail line begins with what was actually observed.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'REQ-007-persistence-data-sqlite';
export const accountBound = false;
const REQ7_LIM = `REQ-007 requires the store facade to be the SOLE importer of the engine binding across the project's source modules (a repo-scan property). Runtime call round-trips through the facade demonstrate the facade WORKS, not that it is the sole importer.`;
const REQ6_LIM = `REQ-006 defines exactly four lifecycle events: opened, migrated, backupCheckpoint, closed. The fixture-extended entryPut / entryRead / entryDeleted events are fixture-added observations, not any of the four defined events.`;

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
      anchorAcId: null,
      conformanceOnly: true,
      limitation: REQ7_LIM,
      verdict: Number.isInteger(rowId) && rowId > 0 && putResult.changes === 1 ? 'pass' : 'fail',
      detail: `observed put returned real integer rowId=${rowId} changes=${putResult.changes} through the facade's narrow put verb (no raw SQL). Facade routes to engine at runtime; sole-importer is a repo-scan property this row does not observe.`,
      evidence: { rowId, changes: putResult.changes, bodyExcerpt: `put rowId=${rowId} changes=${putResult.changes}` },
    });
    const got = store.get('probe/key');
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: REQ7_LIM,
      verdict: got && got.value === value && got.rowId === rowId ? 'pass' : 'fail',
      detail: `observed get returned rowId=${got?.rowId} valueBytes=${got?.value?.length} match=${got?.value === value} through the facade's narrow get verb.`,
      evidence: { rowIdOnRead: got?.rowId, valueExcerpt: got?.value?.slice(0, 32), bodyExcerpt: `get rowId=${got?.rowId}` },
    });
    const del = store.delete('probe/key');
    const missed = store.get('probe/key');
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: REQ7_LIM,
      verdict: del.changes === 1 && missed === null ? 'pass' : 'fail',
      detail: `observed delete changes=${del.changes}; re-read after delete=${missed === null ? 'absent' : 'present'} through the facade's narrow delete then get verbs.`,
      evidence: { rowIdCreatedThenDeleted: rowId, deleteChanges: del.changes, presentAfterDelete: missed !== null, bodyExcerpt: `delete changes=${del.changes} presentAfterDelete=${missed !== null}` },
    });
    const evPut = events.filter((e) => e.event === 'entryPut');
    const evRead = events.filter((e) => e.event === 'entryRead');
    const evDel = events.filter((e) => e.event === 'entryDeleted');
    const eventOk = evPut.length === 1 && evRead.length === 2 && evDel.length === 1;
    const allowedKeys = new Set(['event', 'key', 'size', 'hit', 'timestamp']);
    const extraKeys = [...evPut, ...evRead, ...evDel].flatMap((e) => Object.keys(e)).filter((k) => !allowedKeys.has(k));
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: REQ6_LIM,
      verdict: eventOk && extraKeys.length === 0 ? 'pass' : 'fail',
      detail: `observed event counts put=${evPut.length} read=${evRead.length} delete=${evDel.length}; extraFields=${JSON.stringify(extraKeys)} on the eventSink; the fixture-extended entry* events carry only metadata fields.`,
      evidence: { entryPut: evPut[0], entryReadHit: evRead[0], entryReadMiss: evRead[1], entryDeleted: evDel[0], bodyExcerpt: `entryPut=${evPut.length} entryRead=${evRead.length} entryDeleted=${evDel.length}` },
    });
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SQLITE_PATH'], rowIdCreatedThenDeleted: rowId, valueBytes: value.length } };
}
