// Unit tests for the standards-derived-blueprint loader validation
// (core-companions spec 3.2/3.3 + amendment A2).
//
// Covers TS-044: loader accepts standardsTrace[] and per-ADR
// recommendedDefault / elicited / standardsTraceClause, refuses missing
// standardsTraceClause on any ADR contribution when standardsTrace is
// declared, and does NOT cross-check MUST-to-kind mapping (amendment A2
// Baz 2026-09-04T12:20:31Z).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadBlueprint } from '../../src/blueprint/loader.js';

async function writeBlueprint(meta, bodies = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-loader-standards-'));
  await mkdir(join(dir, 'contributions', 'adrs'), { recursive: true });
  await writeFile(join(dir, 'blueprint.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  for (const [rel, body] of Object.entries(bodies)) {
    const abs = join(dir, 'contributions', rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body, 'utf8');
  }
  return dir;
}

test('loader accepts standardsTrace and recommendedDefault/elicited/standardsTraceClause (AC-1501-1)', async () => {
  const dir = await writeBlueprint({
    slug: 'scratch-with-standards', version: '1.0.0', category: 'observability',
    standardsTrace: [{ id: 'WSD-001', version: '2026-05' }],
    contributions: [
      {
        id: 'ADR-9001-scratch-with-standards-shape', kind: 'adr', path: 'adrs/adr-9001.json',
        recommendedDefault: true, elicited: false, standardsTraceClause: 'WSD-001 clause 3.1',
      },
    ],
  }, { 'adrs/adr-9001.json': '{}' });
  const r = await loadBlueprint(dir);
  assert.equal(r.kind, undefined, JSON.stringify(r));
  assert.deepEqual(r.standardsTrace, [{ id: 'WSD-001', version: '2026-05' }]);
  const adr = r.contributions.find((c) => c.id === 'ADR-9001-scratch-with-standards-shape');
  assert.equal(adr.recommendedDefault, true);
  assert.equal(adr.elicited, false);
  assert.equal(adr.standardsTraceClause, 'WSD-001 clause 3.1');
});

test('loader refuses missing standardsTraceClause when standardsTrace is declared (AC-1501-2)', async () => {
  const dir = await writeBlueprint({
    slug: 'scratch-missing-clause', version: '1.0.0', category: 'observability',
    standardsTrace: [{ id: 'WSD-001', version: '2026-05' }],
    contributions: [
      { id: 'ADR-9001-scratch-missing-clause-shape', kind: 'adr', path: 'adrs/adr-9001.json' },
    ],
  }, { 'adrs/adr-9001.json': '{}' });
  const r = await loadBlueprint(dir);
  assert.equal(r.kind, 'validation');
  assert.match(r.message, /blueprint 'scratch-missing-clause' declares standardsTrace but ADR contribution 'ADR-9001-scratch-missing-clause-shape' has no standardsTraceClause; every ADR must reference a standard clause or the sentinel 'generic enterprise practice'\./);
});

test("no cross-check on severity; sentinel and no-standardsTrace baseline both load clean (AC-1501-3)", async () => {
  // Sentinel: every ADR carries 'generic enterprise practice' and
  // standardsTrace is declared.
  const sentinelDir = await writeBlueprint({
    slug: 'scratch-sentinel', version: '1.0.0', category: 'observability',
    standardsTrace: [{ id: 'GENERIC', version: 'na' }],
    contributions: [
      { id: 'ADR-9001-scratch-sentinel-shape', kind: 'adr', path: 'adrs/adr-9001.json', standardsTraceClause: 'generic enterprise practice' },
    ],
  }, { 'adrs/adr-9001.json': '{}' });
  const s = await loadBlueprint(sentinelDir);
  assert.equal(s.kind, undefined, JSON.stringify(s));

  // Baseline: no standardsTrace declared; ADR carries no clause; still clean.
  const baseDir = await writeBlueprint({
    slug: 'scratch-baseline', version: '1.0.0', category: 'observability',
    contributions: [
      { id: 'ADR-9001-scratch-baseline-shape', kind: 'adr', path: 'adrs/adr-9001.json' },
    ],
  }, { 'adrs/adr-9001.json': '{}' });
  const b = await loadBlueprint(baseDir);
  assert.equal(b.kind, undefined, JSON.stringify(b));

  // No cross-check: MUST clause allowed on an ADR (per amendment A2).
  // The loader does not refuse an ADR carrying standardsTraceClause
  // even if its title implies a MUST; the discipline is prose.
  const mustAdrDir = await writeBlueprint({
    slug: 'scratch-must-on-adr', version: '1.0.0', category: 'observability',
    standardsTrace: [{ id: 'WSD-001', version: '2026-05' }],
    contributions: [
      { id: 'ADR-9002-scratch-must-on-adr-shape', kind: 'adr', path: 'adrs/adr-9002.json', recommendedDefault: true, standardsTraceClause: 'WSD-001 MUST clause 2.1' },
    ],
  }, { 'adrs/adr-9002.json': '{}' });
  const m = await loadBlueprint(mustAdrDir);
  assert.equal(m.kind, undefined, JSON.stringify(m));
});
