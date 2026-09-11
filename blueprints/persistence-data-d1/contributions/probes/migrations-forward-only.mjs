// Migrations-forward-only probe for persistence-data-d1.
//
// AC-13102-2 requires the wrangler `list -> apply -> list` sequence
// against a fresh local D1. This probe uses the fixture's openFacade
// (which drives a sqlite-backed D1 binding), not a wrangler CLI. Row
// de-claimed (conformanceOnly, anchorAcId=null) with the limitation
// naming AC-13102-2.
//
// AC-13102-3 requires reading the configured bookkeeping table
// (`migrations_table`; default `d1_migrations`). This probe queries
// `schema_migrations`, the fixture's internal table name, not the
// configured `d1_migrations`. Row de-claimed with the limitation
// naming AC-13102-3.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Binding } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/d1-binding-mock.mjs';
import { openFacade } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/facade.mjs';

export const anchorAcId = 'AC-13102-2';
export const accountBound = false;
const AC2_LIM = `AC-13102-2: requires the wrangler 'list -> apply -> list' sequence against a fresh local D1 (wrangler CLI observed). openFacade is the fixture-embedded migration runner; a wrangler CLI is not spawned.`;
const AC3_LIM = `AC-13102-3: requires reading the configured bookkeeping table (migrations_table; default d1_migrations). The fixture's internal table is schema_migrations, not the configured d1_migrations.`;

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-d1-mig-'));
  const path = process.env.RCF_FIXTURE_D1_SQLITE_PATH || join(dir, 'd1.sqlite');
  const results = [];
  const binding = createD1Binding({ path });
  try {
    const firstOpen = await openFacade({ env: { DB: binding } });
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC2_LIM,
      verdict: firstOpen.migrationsApplied.length === 2
        && firstOpen.migrationsApplied[0] === '0001_init.sql'
        && firstOpen.migrationsApplied[1] === '0002_add_notes.sql' ? 'pass' : 'fail',
      detail: `observed first open applied migrations in order: ${JSON.stringify(firstOpen.migrationsApplied)} through the sqlite-backed D1 binding (fixture-embedded migration runner; not wrangler CLI).`,
      evidence: { migrationsApplied: firstOpen.migrationsApplied, bodyExcerpt: `applied=${JSON.stringify(firstOpen.migrationsApplied)}` },
    });
    const secondOpen = await openFacade({ env: { DB: binding } });
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC2_LIM,
      verdict: secondOpen.migrationsApplied.length === 0 ? 'pass' : 'fail',
      detail: `observed second open applied migrations: ${JSON.stringify(secondOpen.migrationsApplied)} (subsequent-list-reports-zero-unapplied shape; via fixture-embedded runner, not wrangler CLI).`,
      evidence: { migrationsAppliedOnReopen: secondOpen.migrationsApplied.length > 0 ? secondOpen.migrationsApplied : ['<none-applied-on-reopen>'], bodyExcerpt: `reopenApplied=${JSON.stringify(secondOpen.migrationsApplied)}` },
    });
    const rows = (await binding.prepare('SELECT id FROM schema_migrations ORDER BY id').all()).results;
    const ids = rows.map((r) => r.id);
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC3_LIM,
      verdict: ids.length === 2 && ids[0] === '0001_init.sql' && ids[1] === '0002_add_notes.sql' ? 'pass' : 'fail',
      detail: `observed fixture schema_migrations rows=${JSON.stringify(ids)} through a bounded SELECT (fixture internal table name schema_migrations, not the configured d1_migrations).`,
      evidence: { migrationRows: ids, bodyExcerpt: `schema_migrations=${JSON.stringify(ids)}` },
    });
    binding.__closeForFixture();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_D1_SQLITE_PATH'] } };
}
