// WAL checkpoint probe for persistence-data-sqlite.
//
// The FIRST row (AC-5105-3 anchor) observes the complete durability
// posture the AC names: write-ahead log AND synchronous commit floor
// AND the absence of consumer configuration. Concretely the row
// asserts:
//   - PRAGMA journal_mode returns 'wal' (facade-set at open)
//   - PRAGMA synchronous returns >= NORMAL (facade-set at open)
//   - a grep of consumer code (every probe file plus every fixture
//     src file except the facade store.mjs itself) finds no direct
//     PRAGMA journal_mode / PRAGMA synchronous statement.
// A seed put through the facade provides a real integer rowId as the
// row's resource identifier.
//
// The SECOND (wal_checkpoint TRUNCATE size transition) and THIRD
// (walCheckpoint event) rows observe checkpoint mechanics and a
// fixture-added event. Neither is one of the four defined lifecycle
// events on AC-5106-1 {opened, migrated, backupCheckpoint, closed}
// and neither observes crash recovery (AC-5105-1). Rows de-claimed
// (conformanceOnly, anchorAcId=null) with limitations naming the
// nearest shipped ACs.
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'AC-5105-3';
export const accountBound = false;
const AC_PREFIX = "The store's durability posture (write-ahead log";

const LIM_5105_1 = `AC-5105-1: requires a write committed before SIGKILL to be present when a fresh process reopens the same store. Observing wal_checkpoint TRUNCATE size mechanics is engine housekeeping, not a crash-recovery observation.`;
const LIM_5106_1 = `AC-5106-1: defines the four lifecycle events (opened, migrated, backupCheckpoint, closed). The fixture-extended 'walCheckpoint' event is a fixture-added observation, not one of the four defined events.`;

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBES_DIR = HERE;
const FIXTURE_SRC_DIR = join(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-persistence-data-sqlite', 'src');
const FACADE_BASENAME = 'store.mjs';
const PRAGMA_RE = /['"\`]PRAGMA\s+(journal_mode|synchronous)\b/i;

async function safeSize(p) { try { return Number((await stat(p)).size); } catch { return null; } }

async function listMjs(dir) {
  const out = [];
  async function walk(d) {
    let entries = [];
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && p.endsWith('.mjs')) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

// Consumer grep: every probe file + every fixture src file except the
// facade store.mjs. A hit is a direct PRAGMA journal_mode / synchronous
// statement outside the facade — which AC-5105-3 forbids.
async function greppConsumerFilesForPragmaLeaks() {
  const probeFiles = (await listMjs(PROBES_DIR)).filter((p) => !p.endsWith('probe-utils.mjs'));
  const fixtureFilesAll = await listMjs(FIXTURE_SRC_DIR);
  const fixtureFiles = fixtureFilesAll.filter((p) => !p.endsWith('/' + FACADE_BASENAME));
  const consumerFiles = [...probeFiles, ...fixtureFiles];
  const offenders = [];
  for (const p of consumerFiles) {
    let text = '';
    try { text = await readFile(p, 'utf8'); } catch { continue; }
    if (PRAGMA_RE.test(text)) offenders.push(p);
  }
  return { consumerFilesScanned: consumerFiles.map((p) => p.slice(p.indexOf('/rcf-lite') === -1 ? 0 : p.indexOf('/rcf-lite'))), consumerFilesWithPragma: offenders };
}

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-sqlite-wal-'));
  const path = process.env.RCF_FIXTURE_SQLITE_PATH || join(dir, 'store.sqlite');
  const events = [];
  const results = [];
  let checkpoint, mode, walBefore, walAfter, syncLevel, grep, seedRowId;
  try {
    const store = openStore({ path, eventSink: (r) => events.push(r) });
    mode = store.journalModeNow();
    syncLevel = store.synchronousNow();
    grep = await greppConsumerFilesForPragmaLeaks();
    // Seed put through the facade so the row carries a real integer
    // rowId as its resource identifier.
    const seed = store.put('probe-durability-posture', String(Date.now()));
    seedRowId = seed.rowId;
    const modeOk = mode === 'wal';
    // NORMAL = 1, FULL = 2, EXTRA = 3. The AC names a floor, not a
    // specific level; require >= NORMAL.
    const syncOk = Number.isInteger(syncLevel) && syncLevel >= 1;
    const noConsumerPragma = Array.isArray(grep.consumerFilesWithPragma) && grep.consumerFilesWithPragma.length === 0;
    results.push({
      anchorAcId: 'AC-5105-3',
      verdict: modeOk && syncOk && noConsumerPragma && Number.isInteger(seedRowId) && seedRowId > 0 ? 'pass' : 'fail',
      detail: `${AC_PREFIX} and synchronous commit floor)  -  observed the facade's PRAGMA journal_mode='${mode}' AND PRAGMA synchronous=${syncLevel} (>=1 required); consumer-source grep across ${grep.consumerFilesScanned.length} .mjs files finds ${grep.consumerFilesWithPragma.length} direct PRAGMA journal_mode/synchronous statements outside the facade store.mjs. Seed put returned rowId=${seedRowId} through the facade.`,
      evidence: {
        rowId: seedRowId,
        pragmaJournalMode: mode,
        pragmaSynchronous: `level=${syncLevel}`,
        consumerFilesScannedCount: grep.consumerFilesScanned.length,
        consumerFilesWithPragma: grep.consumerFilesWithPragma,
        consumerConfiguresPragmas: !noConsumerPragma,
        bodyExcerpt: `journal_mode=${mode} synchronous=${syncLevel} consumerPragmaHits=${grep.consumerFilesWithPragma.length} seedRowId=${seedRowId}`,
      },
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
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SQLITE_PATH'], writtenRows: 200, journalMode: mode, synchronousLevel: syncLevel, seedRowId, checkpoint, walSize: { before: walBefore, after: walAfter }, consumerGrep: grep } };
}

function walPath(base) { return base + '-wal'; }
