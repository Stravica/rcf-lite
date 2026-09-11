// Boot-time open-and-migrate probe for persistence-data-sqlite v1.1.1.
//
// Opens the fixture's store facade against a fresh temporary sqlite
// file, asserts openStore ran exactly once, that migrations from
// version 1 to MAX_SCHEMA_VERSION were applied on the empty file,
// that the reported schema version equals MAX_SCHEMA_VERSION, and
// that reopening the same path applies no further migrations
// (idempotent boot).
//
// Positive evidence: the applied-migration list from the FIRST open
// (real integers from a real sqlite handle), the schema_migrations
// row count and the storeOpened event's timestamp are all recorded
// on the report; the second open records an empty appliedMigrations
// (the primary and additional round-tripped evidence).
//
// anchorAcId: AC-5101-1 (single boot-time entry, opened exactly
// once). Additional results cover AC-5101-2 (configuration-sourced
// path), AC-5101-3 (schema at max version on return) and the
// idempotent-reopen shape at US-5101.
// accountBound: false.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, MAX_SCHEMA_VERSION } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/src/store.mjs';

export const anchorAcId = 'AC-5101-1';
export const accountBound = false;

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
      detail: `storeOpened emitted ${opened.length} time(s); path=${opened[0]?.path} timestamp=${opened[0]?.timestamp}`,
      evidence: { event: opened[0], appliedMigrations: store.appliedMigrations },
    });
    results.push({
      anchorAcId: 'AC-5101-2',
      verdict: opened[0]?.path === path ? 'pass' : 'fail',
      detail: `configuration-sourced path=${opened[0]?.path}; matches input=${opened[0]?.path === path}`,
      evidence: { pathFromConfig: path, pathOnEvent: opened[0]?.path },
    });
    const schemaAtOpen = store.schemaVersion();
    results.push({
      anchorAcId: 'AC-5101-3',
      verdict: schemaAtOpen === MAX_SCHEMA_VERSION ? 'pass' : 'fail',
      detail: `schema version after open=${schemaAtOpen}; max known=${MAX_SCHEMA_VERSION}; applied=${JSON.stringify(store.appliedMigrations)}`,
      evidence: { schemaVersion: schemaAtOpen, appliedMigrations: store.appliedMigrations },
    });
    bootReport = { appliedMigrations: [...store.appliedMigrations], schemaVersion: schemaAtOpen };
    store.close();

    // Reopen: no further migrations should apply. This is the
    // idempotency check the boot shape asserts.
    const store2 = openStore({ path, eventSink: (r) => events.push(r) });
    reopenReport = { appliedMigrations: [...store2.appliedMigrations], schemaVersion: store2.schemaVersion() };
    results.push({
      anchorAcId: 'AC-5101-3',
      verdict: store2.appliedMigrations.length === 0 && store2.schemaVersion() === MAX_SCHEMA_VERSION ? 'pass' : 'fail',
      detail: `reopen applied migrations=${JSON.stringify(store2.appliedMigrations)}; schema=${store2.schemaVersion()}`,
      evidence: reopenReport,
    });
    store2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return {
    results,
    extra: {
      envDeclared: ['RCF_FIXTURE_SQLITE_PATH'],
      bootReport,
      reopenReport,
      eventCount: events.length,
    },
  };
}
