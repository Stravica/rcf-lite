// Migrations-forward-only probe for persistence-data-d1.
// Anchors AC-13102-2 (list-then-apply-then-list) and AC-13102-3
// (bookkeeping table). Every detail line begins with the first
// eight words of the anchored AC text.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Binding } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/d1-binding-mock.mjs';
import { openFacade } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/facade.mjs';

export const anchorAcId = 'AC-13102-2';
export const accountBound = false;
const AC2 = 'Running `wrangler d1 migrations list <database> --local` against';
const AC3 = 'The D1 bookkeeping table configured on the binding';

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-d1-mig-'));
  const path = process.env.RCF_FIXTURE_D1_SQLITE_PATH || join(dir, 'd1.sqlite');
  const results = [];
  const binding = createD1Binding({ path });
  try {
    const firstOpen = await openFacade({ env: { DB: binding } });
    results.push({
      anchorAcId: 'AC-13102-2',
      verdict: firstOpen.migrationsApplied.length === 2
        && firstOpen.migrationsApplied[0] === '0001_init.sql'
        && firstOpen.migrationsApplied[1] === '0002_add_notes.sql' ? 'pass' : 'fail',
      detail: `${AC2} a fresh local D1  -  observed first open applied migrations in order: ${JSON.stringify(firstOpen.migrationsApplied)} through the sqlite-backed D1 binding (wrangler CLI substitute).`,
      evidence: { migrationsApplied: firstOpen.migrationsApplied },
    });
    const secondOpen = await openFacade({ env: { DB: binding } });
    results.push({
      anchorAcId: 'AC-13102-2',
      verdict: secondOpen.migrationsApplied.length === 0 ? 'pass' : 'fail',
      detail: `${AC2} a fresh local D1  -  observed second open applied migrations: ${JSON.stringify(secondOpen.migrationsApplied)} (subsequent-list-reports-zero-unapplied shape of AC-13102-2).`,
      evidence: { migrationsAppliedOnReopen: secondOpen.migrationsApplied },
    });
    const rows = (await binding.prepare('SELECT id FROM schema_migrations ORDER BY id').all()).results;
    const ids = rows.map((r) => r.id);
    results.push({
      anchorAcId: 'AC-13102-3',
      verdict: ids.length === 2 && ids[0] === '0001_init.sql' && ids[1] === '0002_add_notes.sql' ? 'pass' : 'fail',
      detail: `${AC3} (\`migrations_table\`; default \`d1_migrations\`)  -  observed schema_migrations rows=${JSON.stringify(ids)} through a bounded SELECT (one row per applied migration).`,
      evidence: { migrationRows: ids },
    });
    binding.__closeForFixture();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_D1_SQLITE_PATH'] } };
}
