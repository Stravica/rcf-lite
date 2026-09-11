// WAL checkpoint probe for persistence-data-sqlite.
//
// The FIRST row (journal_mode=wal at open) observes AC-5105-3
// ("store's durability posture set at open time by the facade").
// Observing PRAGMA journal_mode = wal at open is direct evidence of
// the durability posture the AC names. Anchored AC-5105-3.
//
// The SECOND (wal_checkpoint TRUNCATE size transition) and THIRD
// (walCheckpoint event) rows observe checkpoint mechanics and a
// fixture-added event. Neither is one of the four defined lifecycle
// events on AC-5106-1 {opened, migrated, backupCheckpoint, closed}
// and neither observes crash recovery (AC-5105-1). Rows de-claimed
// (conformanceOnly, anchorAcId=null) with limitations naming the
// nearest shipped ACs (AC-5105-1 for the size row, AC-5106-1 for the
// event row).
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'AC-5105-3';
export const accountBound = false;
const AC_PREFIX = "The store's durability posture (write-ahead log";

const LIM_5105_1 = `AC-5105-1: requires a write committed before SIGKILL to be present when a fresh process reopens the same store. Observing wal_checkpoint TRUNCATE size mechanics is engine housekeeping, not a crash-recovery observation.`;
const LIM_5106_1 = `AC-5106-1: defines the four lifecycle events (opened, migrated, backupCheckpoint, closed). The fixture-extended 'walCheckpoint' event is a fixture-added observation, not one of the four defined events.`;

async function safeSize(p) { try { return Number((await stat(p)).size); } catch { return null; } }

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-sqlite-wal-'));
  const path = process.env.RCF_FIXTURE_SQLITE_PATH || join(dir, 'store.sqlite');
  const events = [];
  const results = [];
  let checkpoint, mode, walBefore, walAfter;
  try {
    const store = openStore({ path, eventSink: (r) => events.push(r) });
    mode = store.journalModeNow();
    results.push({
      anchorAcId: 'AC-5105-3',
      verdict: mode === 'wal' ? 'pass' : 'fail',
      detail: `${AC_PREFIX} and synchronous commit floor)  -  observed the real sqlite handle's PRAGMA journal_mode returned '${mode}' (expect 'wal', the durability posture the AC names as set at open time by the facade).`,
      evidence: { pragmaJournalMode: mode, bodyExcerpt: `journal_mode=${mode}` },
    });
    for (let i = 0; i < 200; i++) store.put(`k/${i}`, `v-${i}-${Date.now()}`);
    walBefore = await safeSize(walPath(path));
    checkpoint = store.walCheckpoint('TRUNCATE');
    walAfter = await safeSize(walPath(path));
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_5105_1,
      verdict: checkpoint.busy === 0 && Number.isInteger(checkpoint.pagesLog) && Number.isInteger(checkpoint.pagesCheckpointed) && typeof walBefore === 'number' && walBefore > 0 && walAfter === 0 ? 'pass' : 'fail',
      detail: `observed wal_checkpoint(TRUNCATE) busy=${checkpoint.busy} pagesLog=${checkpoint.pagesLog} pagesCheckpointed=${checkpoint.pagesCheckpointed}; walSizeBytes before=${walBefore} after=${walAfter}.`,
      evidence: { checkpoint, walSizeBefore: walBefore, walSizeAfter: walAfter, bodyExcerpt: `walSize ${walBefore} -> ${walAfter}` },
    });
    const ev = events.find((e) => e.event === 'walCheckpoint');
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_5106_1,
      verdict: ev && ev.mode === 'TRUNCATE' ? 'pass' : 'fail',
      detail: `observed the fixture-added walCheckpoint event mode=${ev?.mode} timestamp=${ev?.timestamp} on the eventSink after the TRUNCATE checkpoint (not one of the four defined events on AC-5106-1).`,
      evidence: { event: ev ? { event: ev.event, mode: ev.mode, timestamp: ev.timestamp } : null, bodyExcerpt: `event=${ev?.event}` },
    });
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SQLITE_PATH'], writtenRows: 200, journalMode: mode, checkpoint, walSize: { before: walBefore, after: walAfter } } };
}

function walPath(base) { return base + '-wal'; }
