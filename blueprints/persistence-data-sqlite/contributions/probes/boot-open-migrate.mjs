// Boot-time open-and-migrate probe for persistence-data-sqlite.
// Anchors AC-5101-1/2/3. Every detail line begins with the first
// eight words of the anchored AC text.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, MAX_SCHEMA_VERSION } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'AC-5101-1';
export const accountBound = false;
const AC1 = 'The application exposes a single named function or';
const AC2 = 'The store opens with a path or connection';
const AC3 = 'The open entry point returns only after migrations';

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-sqlite-boot-'));
  const path = process.env.RCF_FIXTURE_SQLITE_PATH || join(dir, 'store.sqlite');
  const events = [];
  const results = [];
  let bootReport, reopenReport;
  try {
    const store = openStore({ path, eventSink: (r) => events.push(r) });
    const opened = events.filter((e) => e.event === 'storeOpened');
    results.push({
      anchorAcId: 'AC-5101-1',
      verdict: opened.length === 1 ? 'pass' : 'fail',
      detail: `${AC1} module export  -  observed storeOpened emitted ${opened.length} time(s) on the eventSink; path=${opened[0]?.path} timestamp=${opened[0]?.timestamp}.`,
      evidence: { event: opened[0], appliedMigrations: store.appliedMigrations },
    });
    results.push({
      anchorAcId: 'AC-5101-2',
      verdict: opened[0]?.path === path ? 'pass' : 'fail',
      detail: `${AC2} string sourced from application configuration  -  observed opened event path=${opened[0]?.path} matches the configuration input path=${path}.`,
      evidence: { pathFromConfig: path, pathOnEvent: opened[0]?.path },
    });
    const schemaAtOpen = store.schemaVersion();
    results.push({
      anchorAcId: 'AC-5101-3',
      verdict: schemaAtOpen === MAX_SCHEMA_VERSION ? 'pass' : 'fail',
      detail: `${AC3} have run  -  observed schema version after open=${schemaAtOpen} equals build max known=${MAX_SCHEMA_VERSION}; appliedMigrations=${JSON.stringify(store.appliedMigrations)}.`,
      evidence: { schemaVersion: schemaAtOpen, appliedMigrations: store.appliedMigrations },
    });
    bootReport = { appliedMigrations: [...store.appliedMigrations], schemaVersion: schemaAtOpen };
    store.close();

    const store2 = openStore({ path, eventSink: (r) => events.push(r) });
    reopenReport = { appliedMigrations: [...store2.appliedMigrations], schemaVersion: store2.schemaVersion() };
    results.push({
      anchorAcId: 'AC-5101-3',
      verdict: store2.appliedMigrations.length === 0 && store2.schemaVersion() === MAX_SCHEMA_VERSION ? 'pass' : 'fail',
      detail: `${AC3} have run  -  observed reopen applied migrations=${JSON.stringify(store2.appliedMigrations)}; schema=${store2.schemaVersion()} (idempotent reopen at max version).`,
      evidence: reopenReport,
    });
    store2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SQLITE_PATH'], bootReport, reopenReport, eventCount: events.length } };
}
