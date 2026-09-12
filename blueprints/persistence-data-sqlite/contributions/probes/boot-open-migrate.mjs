// Boot-time open-and-migrate probe for persistence-data-sqlite.
//
// AC-5101-1 requires ONE named module export invoked exactly ONCE
// before request handlers bind. A storeOpened event fired on the
// sink is not proof of "invoked exactly once before handlers bind"
// (there are no handlers). Row de-claimed (anchorAcId=null,
// conformanceOnly true) with the limitation naming AC-5101-1.
//
// AC-5101-2 requires (a) the store to open with a path sourced from
// application configuration AND (b) a grep of the source tree to
// find the identifier resolved from configuration rather than
// hard-coded. This row observes only clause (a) (path equality on
// the opened event); a shelf probe cannot cheaply prove absence of
// hard-coded paths across every consumer module in a downstream
// project. Row de-claimed with the limitation naming AC-5101-2.
//
// AC-5101-3 (open returns only after migrations have run) IS
// observable as schemaVersion === MAX_SCHEMA_VERSION after open and
// is kept as a real AC anchor.
//
// The reopen row (no migrations applied on second open) is not
// AC-5101-3 (that AC is about first open completing migrations); it
// belongs to REQ-002 (idempotent reopen). Row de-claimed with the
// limitation naming AC-5101-3.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, MAX_SCHEMA_VERSION } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'AC-5101-3';
export const accountBound = false;
const AC3 = 'The open entry point returns only after migrations';
const LIM_5101_1 = `AC-5101-1: requires a SINGLE named module export invoked exactly ONCE before request handlers bind on the running process. A storeOpened event on the fixture eventSink is not evidence of an application-level export invocation ordering against handler binding.`;
const LIM_5101_2 = `AC-5101-2: requires (a) the store to open with a path sourced from application configuration AND (b) a grep of the source tree to find the identifier resolved from configuration rather than hard-coded. This row observes only clause (a); the shelf cannot cheaply prove absence of hard-coded paths across every consumer module of a downstream project.`;
const LIM_5101_3_REOPEN = `AC-5101-3: asserts the open entry point returns only after migrations have RUN (first open). Reopen idempotency (a no-migration second open) is a related but distinct property not stated on AC-5101-3.`;

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
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_5101_1,
      verdict: opened.length === 1 ? 'pass' : 'fail',
      detail: `observed storeOpened emitted ${opened.length} time(s) on the eventSink; path=${opened[0]?.path} timestamp=${opened[0]?.timestamp}. Not evidence of a named export invocation ordering against handler binding.`,
      evidence: { event: opened[0], appliedMigrations: store.appliedMigrations, bodyExcerpt: `storeOpened count=${opened.length}` },
    });
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_5101_2,
      verdict: opened[0]?.path === path ? 'pass' : 'fail',
      detail: `observed opened event path=${opened[0]?.path} matches the configuration input path=${path}. Absence of hard-coded paths across every consumer module of a downstream project not observed.`,
      evidence: { pathFromConfig: path, pathOnEvent: opened[0]?.path, bodyExcerpt: `path=${opened[0]?.path}` },
    });
    const schemaAtOpen = store.schemaVersion();
    // Seed put through the facade so the row carries a real integer
    // rowId as its resource identifier (real returned engine row id).
    const seed = store.put('probe-boot-open-migrate', String(Date.now()));
    results.push({
      anchorAcId: 'AC-5101-3',
      verdict: schemaAtOpen === MAX_SCHEMA_VERSION && Number.isInteger(seed.rowId) && seed.rowId > 0 ? 'pass' : 'fail',
      detail: `${AC3} have run  -  observed schema version after open=${schemaAtOpen} equals build max known=${MAX_SCHEMA_VERSION}; appliedMigrations=${JSON.stringify(store.appliedMigrations)}; a seed put through the facade returned real integer rowId=${seed.rowId}.`,
      evidence: { rowId: seed.rowId, schemaVersion: schemaAtOpen, appliedMigrations: store.appliedMigrations, bodyExcerpt: `schema=${schemaAtOpen} applied=${JSON.stringify(store.appliedMigrations)} rowId=${seed.rowId}` },
    });
    bootReport = { appliedMigrations: [...store.appliedMigrations], schemaVersion: schemaAtOpen };
    store.close();

    const store2 = openStore({ path, eventSink: (r) => events.push(r) });
    reopenReport = { appliedMigrations: [...store2.appliedMigrations], schemaVersion: store2.schemaVersion() };
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_5101_3_REOPEN,
      verdict: store2.appliedMigrations.length === 0 && store2.schemaVersion() === MAX_SCHEMA_VERSION ? 'pass' : 'fail',
      detail: `observed reopen appliedMigrations=${JSON.stringify(store2.appliedMigrations)}; schema=${store2.schemaVersion()} (idempotent reopen at max version; distinct property from AC-5101-3 first-open-completes-migrations).`,
      evidence: { schemaVersion: reopenReport.schemaVersion, appliedMigrations: reopenReport.appliedMigrations, bodyExcerpt: `reopen applied=${JSON.stringify(reopenReport.appliedMigrations)}` },
    });
    store2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SQLITE_PATH'], bootReport, reopenReport, eventCount: events.length } };
}
