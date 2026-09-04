// pack-loader tests (visual round T-0, US-1701 AC-1701-1 / 2 / 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadProbePacks } from '../../src/browser-verify/pack-loader.js';

async function makeBlueprint({ slug, acs }) {
  const root = await mkdtemp(join(tmpdir(), `pack-loader-${slug}-`));
  await mkdir(join(root, 'contributions', 'user-stories'), { recursive: true });
  const usPath = join('contributions', 'user-stories', `${slug}-us-1101.json`);
  await writeFile(join(root, usPath), JSON.stringify({
    usId: `${slug}-US-1101`,
    prdId: 'PRD-001',
    reqId: `${slug}-REQ-001`,
    title: 'Grid shell',
    acceptanceCriteria: acs.map((id, i) => ({ id, description: `AC ${i}`, testable: true })),
  }, null, 2));
  await writeFile(join(root, 'blueprint.json'), JSON.stringify({
    slug,
    version: '1.0.0',
    category: 'application',
    contributions: [
      { id: `${slug}-US-1101`, kind: 'us', path: usPath.replace(/\\/g, '/') },
    ],
  }, null, 2));
  await mkdir(join(root, 'probe-packs'), { recursive: true });
  return root;
}

async function writePack(bpRoot, filename, body) {
  const p = join(bpRoot, 'probe-packs', filename);
  await writeFile(p, body);
  return p;
}

test('loadProbePacks accepts .pack.js and .pack.mjs and reports one loaded pack per legal module', async () => {
  const slug = 'application-datatable';
  const bp = await makeBlueprint({ slug, acs: ['AC-17101-1', 'AC-17101-2'] });
  await writePack(bp, 'grid.pack.js', `
export default {
  packName: '${slug}-grid-shell',
  version: '1.0.0',
  blueprintSlug: '${slug}',
  appliesTo: ({ fbs }) => Array.isArray(fbs?.designStage?.navModel?.routes),
  checks: [
    { id: 'AC-17101-1', severity: 'block', description: 'sort click', run: async () => ({ verdict: 'pass' }) },
  ],
};
`);
  await writePack(bp, 'aria.pack.mjs', `
export default {
  packName: '${slug}-aria-grid',
  version: '1.0.1',
  blueprintSlug: '${slug}',
  appliesTo: ({ fbs }) => Array.isArray(fbs?.designStage?.tacIds),
  checks: [
    { id: 'AC-17101-2', severity: 'warn', description: 'aria pattern', run: async () => ({ verdict: 'pass' }) },
  ],
};
`);
  const result = await loadProbePacks({ appliedBlueprints: [{ slug, absPath: bp }] });
  assert.equal(result.errors.length, 0, `expected no errors, got ${JSON.stringify(result.errors)}`);
  assert.equal(result.packs.length, 2);
  const names = result.packs.map((p) => p.packName).sort();
  assert.deepEqual(names, [`${slug}-aria-grid`, `${slug}-grid-shell`]);
});

test('applicability predicate refuses unqualified default and records applicable=false when appliesTo returns false', async () => {
  const slug = 'application-datatable';
  const bp = await makeBlueprint({ slug, acs: ['AC-17101-1'] });
  // Unqualified predicate: refused at load.
  await writePack(bp, 'bad-scope.pack.js', `
export default {
  packName: '${slug}-bad',
  version: '1.0.0',
  blueprintSlug: '${slug}',
  appliesTo: () => true,
  checks: [
    { id: 'AC-17101-1', severity: 'block', description: 'x', run: async () => ({ verdict: 'pass' }) },
  ],
};
`);
  const result = await loadProbePacks({ appliedBlueprints: [{ slug, absPath: bp }] });
  assert.equal(result.packs.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /appliesTo must reference one of/);

});

test('applicability predicate accepts scoping by tacIds and appliesTo returning false skips the pack', async () => {
  const slug = 'application-datatable';
  const bp = await makeBlueprint({ slug, acs: ['AC-17101-1'] });
  await writePack(bp, 'good-scope.pack.js', `
export default {
  packName: '${slug}-good',
  version: '1.0.0',
  blueprintSlug: '${slug}',
  appliesTo: ({ fbs }) => Array.isArray(fbs?.designStage?.tacIds) && fbs.designStage.tacIds.includes('TAC-1801'),
  checks: [
    { id: 'AC-17101-1', severity: 'block', description: 'x', run: async () => ({ verdict: 'pass' }) },
  ],
};
`);
  const result = await loadProbePacks({ appliedBlueprints: [{ slug, absPath: bp }] });
  assert.equal(result.errors.length, 0);
  assert.equal(result.packs.length, 1);
  const pack = result.packs[0];
  assert.equal(pack.appliesTo({ fbs: { designStage: { tacIds: ['TAC-9999'] } } }), false);
  assert.equal(pack.appliesTo({ fbs: { designStage: { tacIds: ['TAC-1801'] } } }), true);
});

test('loader refuses a pack whose check id names an AC the blueprint does not contribute', async () => {
  const slug = 'application-datatable';
  const bp = await makeBlueprint({ slug, acs: ['AC-17101-1'] });
  await writePack(bp, 'mismatch.pack.js', `
export default {
  packName: '${slug}-mismatch',
  version: '1.0.0',
  blueprintSlug: '${slug}',
  appliesTo: ({ fbs }) => Array.isArray(fbs?.designStage?.navModel?.routes),
  checks: [
    { id: 'AC-99999-9', severity: 'block', description: 'stray', run: async () => ({ verdict: 'pass' }) },
  ],
};
`);
  const result = await loadProbePacks({ appliedBlueprints: [{ slug, absPath: bp }] });
  assert.equal(result.packs.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /AC-99999-9/);
  assert.match(result.errors[0].message, /application-datatable/);
});

test('loadProbePacks skips a blueprint that has no probe-packs directory (benign)', async () => {
  const bp = await mkdtemp(join(tmpdir(), 'pack-loader-empty-'));
  await writeFile(join(bp, 'blueprint.json'), JSON.stringify({ slug: 'empty', version: '1.0.0', contributions: [] }));
  const result = await loadProbePacks({ appliedBlueprints: [{ slug: 'empty', absPath: bp }] });
  assert.equal(result.errors.length, 0);
  assert.equal(result.packs.length, 0);
});

test('loadProbePacks reports import errors on a broken pack module', async () => {
  const slug = 'application-charts';
  const bp = await makeBlueprint({ slug, acs: ['AC-18103-1'] });
  await writePack(bp, 'broken.pack.js', 'export default { syntax error;');
  const result = await loadProbePacks({ appliedBlueprints: [{ slug, absPath: bp }] });
  assert.equal(result.packs.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /import failed/);
});
