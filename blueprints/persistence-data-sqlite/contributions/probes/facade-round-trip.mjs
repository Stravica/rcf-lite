// Facade round-trip probe for persistence-data-sqlite.
//
// The CRUD rows (put/get/delete via the fixture's store facade) do
// NOT observe AC-5107-1's sole-importer property (an import-graph
// scan over the project's source modules) and do not exhaustively
// verify AC-5107-2's absence of a general-purpose query method
// across the facade's public surface. Rows are de-claimed
// (conformanceOnly, anchorAcId=null) with the limitation naming
// AC-5107-2 (nearest shipped AC on the CRUD verb surface).
//
// The event row observes entryPut / entryRead / entryDeleted which
// are NOT among the four defined lifecycle events on AC-5106-1
// (opened, migrated, backupCheckpoint, closed). Row de-claimed
// with the limitation naming AC-5106-1.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'AC-5107-2';
export const accountBound = false;

const LIM_5107_2 = `AC-5107-2: requires the store facade to expose named verbs for every persistence operation the domain requires AND not to expose a general-purpose query method accepting raw engine-native queries. Runtime CRUD round-trips through the facade demonstrate that the facade's put/get/delete verbs WORK; a probe would still need an exhaustive scan of the facade's public surface to prove absence of a general-purpose query method. Row observes only the narrow-verb round-trip.`;
const LIM_5106_1 = `AC-5106-1: defines the four lifecycle events (opened, migrated, backupCheckpoint, closed) the store facade must emit. The fixture-extended entryPut/entryRead/entryDeleted events are fixture-added observations, not any of the four defined events.`;

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
      limitation: LIM_5107_2,
      verdict: Number.isInteger(rowId) && rowId > 0 && putResult.changes === 1 ? 'pass' : 'fail',
      detail: `observed put returned real integer rowId=${rowId} changes=${putResult.changes} through the facade's narrow put verb (no raw SQL).`,
      evidence: { rowId, changes: putResult.changes, bodyExcerpt: `put rowId=${rowId} changes=${putResult.changes}` },
    });
    const got = store.get('probe/key');
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_5107_2,
      verdict: got && got.value === value && got.rowId === rowId ? 'pass' : 'fail',
      detail: `observed get returned rowId=${got?.rowId} valueBytes=${got?.value?.length} match=${got?.value === value} through the facade's narrow get verb.`,
      evidence: { rowIdOnRead: got?.rowId, valueExcerpt: got?.value?.slice(0, 32), bodyExcerpt: `get rowId=${got?.rowId}` },
    });
    const del = store.delete('probe/key');
    const missed = store.get('probe/key');
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_5107_2,
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
      limitation: LIM_5106_1,
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
