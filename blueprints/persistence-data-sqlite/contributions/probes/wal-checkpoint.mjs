// WAL checkpoint probe for persistence-data-sqlite v1.1.1.
//
// Opens the store, asserts PRAGMA journal_mode reports 'wal' (real
// sqlite engine response, not a mock), writes rows into the WAL and
// runs a TRUNCATE checkpoint via the facade. The positive evidence
// captured is: the pragma-reported journal mode string returned by
// the real handle, the wal_checkpoint counters (busy, pagesLog,
// pagesCheckpointed) and the presence-then-truncation of the .sqlite-
// wal sidecar file after the TRUNCATE checkpoint.
//
// anchorAcId: AC-5103-1 (WAL journaling engaged, checkpoint clears
// pages). accountBound: false.

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'AC-5103-1';
export const accountBound = false;

async function safeSize(p) {
  try { return Number((await stat(p)).size); } catch { return null; }
}

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-sqlite-wal-'));
  const path = process.env.RCF_FIXTURE_SQLITE_PATH || join(dir, 'store.sqlite');
  const walPath = path + '-wal';
  const events = [];
  const results = [];
  let checkpoint, mode, walBefore, walAfter;
  try {
    const store = openStore({ path, eventSink: (r) => events.push(r) });
    mode = store.journalModeNow();
    results.push({
      anchorAcId: 'AC-5103-1',
      verdict: mode === 'wal' ? 'pass' : 'fail',
      detail: `PRAGMA journal_mode returned '${mode}' from the real sqlite handle (expect 'wal')`,
      evidence: { pragmaJournalMode: mode },
    });
    for (let i = 0; i < 200; i++) store.put(`k/${i}`, `v-${i}-${Date.now()}`);
    walBefore = await safeSize(walPath);
    checkpoint = store.walCheckpoint('TRUNCATE');
    walAfter = await safeSize(walPath);
    results.push({
      anchorAcId: 'AC-5103-1',
      verdict: checkpoint.busy === 0 && Number.isInteger(checkpoint.pagesLog) && Number.isInteger(checkpoint.pagesCheckpointed) && typeof walBefore === 'number' && walBefore > 0 && walAfter === 0 ? 'pass' : 'fail',
      detail: `wal_checkpoint(TRUNCATE) busy=${checkpoint.busy} pagesLog=${checkpoint.pagesLog} pagesCheckpointed=${checkpoint.pagesCheckpointed}; walSizeBytes before=${walBefore} after=${walAfter}`,
      evidence: { checkpoint, walSizeBefore: walBefore, walSizeAfter: walAfter },
    });
    const ev = events.find((e) => e.event === 'walCheckpoint');
    results.push({
      anchorAcId: 'AC-5103-1',
      verdict: ev && ev.mode === 'TRUNCATE' ? 'pass' : 'fail',
      detail: `walCheckpoint event mode=${ev?.mode} timestamp=${ev?.timestamp}`,
      evidence: ev,
    });
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return {
    results,
    extra: {
      envDeclared: ['RCF_FIXTURE_SQLITE_PATH'],
      writtenRows: 200,
      journalMode: mode,
      checkpoint,
      walSize: { before: walBefore, after: walAfter },
    },
  };
}
