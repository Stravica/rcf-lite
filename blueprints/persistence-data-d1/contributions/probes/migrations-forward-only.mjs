// Migrations-forward-only probe for persistence-data-d1 v1.1.2.
// Opens the facade against a fresh binding: asserts both fixture
// migrations were applied in sorted order. Then reopens against
// the same binding and asserts no further migrations applied
// (idempotent-boot shape); reads the schema_migrations table via
// a bounded verb, asserts the row set equals the ids of the two
// fixture files.
//
// Positive evidence: the real applied-migration ids from the
// schema_migrations table (a real inventory shape).
// anchorAcId: AC-13102-1. accountBound: false.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Binding } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/d1-binding-mock.mjs';
import { openFacade } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/facade.mjs';

export const anchorAcId = 'AC-13102-1';
export const accountBound = false;

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-d1-mig-'));
  const path = process.env.RCF_FIXTURE_D1_SQLITE_PATH || join(dir, 'd1.sqlite');
  const results = [];
  const binding = createD1Binding({ path });
  try {
    const firstOpen = await openFacade({ env: { DB: binding } });
    results.push({
      anchorAcId: 'AC-13102-1',
      verdict: firstOpen.migrationsApplied.length === 2
        && firstOpen.migrationsApplied[0] === '0001_init.sql'
        && firstOpen.migrationsApplied[1] === '0002_add_notes.sql' ? 'pass' : 'fail',
      detail: `first open applied migrations in order: ${JSON.stringify(firstOpen.migrationsApplied)}`,
      evidence: { migrationsApplied: firstOpen.migrationsApplied },
    });
    const secondOpen = await openFacade({ env: { DB: binding } });
    results.push({
      anchorAcId: 'AC-13102-2',
      verdict: secondOpen.migrationsApplied.length === 0 ? 'pass' : 'fail',
      detail: `second open applied migrations: ${JSON.stringify(secondOpen.migrationsApplied)} (idempotent boot)`,
      evidence: { migrationsAppliedOnReopen: secondOpen.migrationsApplied },
    });
    const rows = (await binding.prepare('SELECT id FROM schema_migrations ORDER BY id').all()).results;
    const ids = rows.map((r) => r.id);
    results.push({
      anchorAcId: 'AC-13102-3',
      verdict: ids.length === 2 && ids[0] === '0001_init.sql' && ids[1] === '0002_add_notes.sql' ? 'pass' : 'fail',
      detail: `schema_migrations rows=${JSON.stringify(ids)}`,
      evidence: { migrationRows: ids },
    });
    binding.__closeForFixture();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_D1_SQLITE_PATH'] } };
}
