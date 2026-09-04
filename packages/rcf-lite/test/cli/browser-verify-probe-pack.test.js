// browser-verify CLI --probe-pack tests (visual round T-0, US-1701 AC-1701-5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { main as browserVerifyMain } from '../../src/cli/browser-verify.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..', '..');

function makeStream() {
  const chunks = [];
  return {
    write(chunk) { chunks.push(String(chunk)); return true; },
    toString() { return chunks.join(''); },
  };
}

// Scaffold a project that:
//  - initialises the rcf tree (init.js);
//  - promotes FBS-001 to uiBearing with a real navModel.routes[0];
//  - carries a matching uiBaseline (defaults to themeMode single);
//  - has one applied blueprint (`application-datatable`) declared on
//    manifest.blueprints[] whose absPath is under the project's own
//    blueprints/ directory, with a single US contribution declaring
//    AC-17101-1 and one probe pack whose check id matches.
async function scaffoldProbePackProject({ writePack } = { writePack: true }) {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-bv-probe-pack-'));
  await initProject({ projectRoot: tmp, projectName: 'ProbePackTest' });

  const fbsPath = join(tmp, 'rcf', 'fbs', 'fbs-001.json');
  const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
  fbs.uiBearing = true;
  fbs.noCodeNodes = true;
  fbs.designStageComplete = true;
  fbs.designStage = {
    journeys: [{ id: 'j', actor: 'signed-in user', goal: 'sort rows', steps: ['/dt renders', 'click column header'] }],
    navModel: { shape: 'shared-persistent', routes: [{ path: '/dt', label: 'Data table', authRequired: false }] },
    themeAndA11y: {
      themeMode: 'light-default-with-toggle',
      themeTokensModule: 'src/ui/tokens.ts',
      contrastTargets: 'WCAG AA',
      contrastTestPath: 'test/ui/contrast.test.ts',
      contrastTestAuthoredBeforePalette: true,
    },
  };
  await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');

  const manifestPath = join(tmp, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.uiBaseline = {
    id: 'uib-2026-09-04-001',
    createdAt: '2026-09-04T10:00:00Z',
    prdId: 'PRD-001',
    defaults: { themeMode: 'single-theme-declared' },
    operatorAckAt: '2026-09-04T10:00:00Z',
  };
  const bpAbsPath = join(tmp, 'blueprints', 'application-datatable');
  manifest.blueprints = [{
    slug: 'application-datatable',
    version: '1.0.0',
    appliedAt: '2026-09-04T10:00:00Z',
    source: bpAbsPath,
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  await mkdir(join(bpAbsPath, 'contributions', 'user-stories'), { recursive: true });
  const usFile = join('contributions', 'user-stories', 'application-datatable-us-1101.json');
  await writeFile(join(bpAbsPath, usFile), JSON.stringify({
    usId: 'application-datatable-US-1101',
    prdId: 'PRD-001',
    reqId: 'application-datatable-REQ-001',
    title: 'Grid shell',
    acceptanceCriteria: [
      { id: 'AC-17101-1', description: 'Sort click reorders rows to match server order', testable: true },
    ],
  }, null, 2));
  await writeFile(join(bpAbsPath, 'blueprint.json'), JSON.stringify({
    slug: 'application-datatable',
    version: '1.0.0',
    category: 'application',
    contributions: [
      { id: 'application-datatable-US-1101', kind: 'us', path: usFile.replace(/\\/g, '/') },
    ],
  }, null, 2));

  if (writePack) {
    await mkdir(join(bpAbsPath, 'probe-packs'), { recursive: true });
    await writeFile(join(bpAbsPath, 'probe-packs', 'grid.pack.js'), `
export default {
  packName: 'application-datatable-grid-shell',
  version: '1.0.0',
  blueprintSlug: 'application-datatable',
  appliesTo: ({ fbs }) => Array.isArray(fbs?.designStage?.navModel?.routes) && fbs.designStage.navModel.routes.some((r) => r.path === '/dt'),
  checks: [
    { id: 'AC-17101-1', severity: 'block', description: 'Sort click', run: async ({ browser }) => ({ verdict: browser === 'pw-stub' ? 'pass' : 'fail' }) },
  ],
};
`);
  }

  return { projectRoot: tmp, blueprintAbsPath: bpAbsPath };
}

test('rcf verify browser --probe-pack restricts to one pack and exits 2 on unknown pack name', async () => {
  const { projectRoot } = await scaffoldProbePackProject();
  const stdout = makeStream();
  const stderr = makeStream();

  const code = await browserVerifyMain(
    ['FBS-001', '--probe-pack', 'application-datatable-does-not-exist', '--dry-run', '--json'],
    { cwd: projectRoot, stdout, stderr, fetch: async () => ({ status: 200, headers: { get: () => null } }) },
  );
  assert.equal(code, 2, `expected exit 2, got ${code}. stderr:\n${stderr.toString()}`);
  assert.match(stderr.toString(), /--probe-pack 'application-datatable-does-not-exist' resolves to no discovered pack/);
  assert.match(stderr.toString(), /application-datatable-grid-shell/);
});

test('rcf verify browser with --probe-pack matching a discovered pack runs the pack and folds it into the record', async () => {
  const { projectRoot } = await scaffoldProbePackProject();
  const stdout = makeStream();
  const stderr = makeStream();
  const code = await browserVerifyMain(
    ['FBS-001', '--probe-pack', 'application-datatable-grid-shell', '--dry-run', '--json', '--quiet'],
    {
      cwd: projectRoot,
      stdout, stderr,
      fetch: async () => ({ status: 200, headers: { get: () => null } }),
      packBrowser: 'pw-stub',
    },
  );
  // dry-run returns 0 on pass, 4 on warn/block. The stub browser returns
  // 'pass' so aggregate verdict is derived from invariants (stub driver
  // records agentDriverWired warn), yielding 4.
  const output = stdout.toString();
  assert.match(output, /"probePacks"/);
  const record = JSON.parse(output);
  const packRec = record.probePacks.find((p) => p.packName === 'application-datatable-grid-shell');
  assert.ok(packRec, 'expected pack record');
  assert.equal(packRec.applicable, true);
  assert.equal(packRec.checks[0].id, 'AC-17101-1');
  assert.equal(packRec.checks[0].verdict, 'pass');
  assert.notEqual(code, 2, `did not expect a usage refusal here (got ${code})`);
});

test('rcf verify browser without --probe-pack loads discovered packs and refuses cleanly on a broken pack module', async () => {
  const { projectRoot, blueprintAbsPath } = await scaffoldProbePackProject({ writePack: false });
  await mkdir(join(blueprintAbsPath, 'probe-packs'), { recursive: true });
  await writeFile(join(blueprintAbsPath, 'probe-packs', 'broken.pack.js'), 'this is not valid js');
  const stdout = makeStream();
  const stderr = makeStream();
  const code = await browserVerifyMain(
    ['FBS-001', '--dry-run', '--json'],
    { cwd: projectRoot, stdout, stderr, fetch: async () => ({ status: 200, headers: { get: () => null } }) },
  );
  assert.equal(code, 2, `expected loader refusal exit 2, got ${code}. stderr:\n${stderr.toString()}`);
  assert.match(stderr.toString(), /probe-pack loader refused/);
});
