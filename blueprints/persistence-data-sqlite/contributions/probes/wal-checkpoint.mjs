// WAL checkpoint probe for persistence-data-sqlite.
// Anchor: REQ-005-persistence-data-sqlite (no shipped AC states WAL
// checkpoint mechanics; per Addendum rule 1 the requirement is the
// anchor). Every detail line begins with the first eight words of
// the anchored requirement text.
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'REQ-005-persistence-data-sqlite';
export const accountBound = false;
const REQ_PREFIX = 'The store survives ungraceful process termination without corrupting';

async function safeSize(p) { try { return Number((await stat(p)).size); } catch { return null; } }

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
      anchorAcId,
      verdict: mode === 'wal' ? 'pass' : 'fail',
      detail: `${REQ_PREFIX} on-disk state  -  observed the real sqlite handle's PRAGMA journal_mode returned '${mode}' (expect 'wal', the WAL durability posture the requirement names).`,
      evidence: { pragmaJournalMode: mode },
    });
    for (let i = 0; i < 200; i++) store.put(`k/${i}`, `v-${i}-${Date.now()}`);
    walBefore = await safeSize(walPath);
    checkpoint = store.walCheckpoint('TRUNCATE');
    walAfter = await safeSize(walPath);
    results.push({
      anchorAcId,
      verdict: checkpoint.busy === 0 && Number.isInteger(checkpoint.pagesLog) && Number.isInteger(checkpoint.pagesCheckpointed) && typeof walBefore === 'number' && walBefore > 0 && walAfter === 0 ? 'pass' : 'fail',
      detail: `${REQ_PREFIX} on-disk state  -  observed wal_checkpoint(TRUNCATE) busy=${checkpoint.busy} pagesLog=${checkpoint.pagesLog} pagesCheckpointed=${checkpoint.pagesCheckpointed}; walSizeBytes before=${walBefore} after=${walAfter}.`,
      evidence: { checkpoint, walSizeBefore: walBefore, walSizeAfter: walAfter },
    });
    const ev = events.find((e) => e.event === 'walCheckpoint');
    results.push({
      anchorAcId,
      verdict: ev && ev.mode === 'TRUNCATE' ? 'pass' : 'fail',
      detail: `${REQ_PREFIX} on-disk state  -  observed the walCheckpoint event mode=${ev?.mode} timestamp=${ev?.timestamp} on the eventSink after the TRUNCATE checkpoint.`,
      evidence: ev,
    });
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SQLITE_PATH'], writtenRows: 200, journalMode: mode, checkpoint, walSize: { before: walBefore, after: walAfter } } };
}
