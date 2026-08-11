// End-to-end CLI coverage for the `rcf build --mark complete` browser-
// verification gate on uiBearing FBSes (Track B, spec section 8.5, 8.6).
//
// Track B review B-1 (2026-07-31): the `--accept-block --reason "..."`
// escape hatch previously left no durable trace when NO
// browserVerification record existed on the manifest - stderr got the
// reason, exit code was 0, and the FBS marched to complete. This suite
// pins the refuse-cleanly posture (exit 4, message names the
// two-command dance, no state mutation) and the honest happy path
// (existing block record + accept-block writes
// operatorShipDespiteBlockReason to the manifest).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const bin = resolve(repoRoot, 'bin', 'rcf.js');

async function runBin(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// Scaffold a project whose FBS-001 is uiBearing, has a complete
// designStage (satisfying the design-gate and the contrast-before-
// palette gate), has an existing uiBaseline that agrees with the FBS's
// designStage, and declares --no-code-nodes so the CN gate is bypassed.
// The ONLY remaining gate at --mark complete is the browser-verification
// gate; the tests below exercise each of its arms.
async function scaffoldUiBearingProject() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-bv-gate-'));
  await initProject({ projectRoot: tmp, projectName: 'BVGateTest' });

  // Turn FBS-001 into a uiBearing FBS with a complete designStage.
  const fbsPath = join(tmp, 'rcf', 'fbs', 'fbs-001.json');
  const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
  fbs.uiBearing = true;
  fbs.noCodeNodes = true;
  fbs.designStageComplete = true;
  fbs.designStage = {
    journeys: [{
      id: 'signed-in-owner',
      actor: 'signed-in owner',
      goal: 'see monitor status',
      steps: ['lands on /', 'sees tiles', 'clicks a monitor'],
    }],
    navModel: {
      shape: 'shared-persistent',
      routes: [{ path: '/', label: 'Home', authRequired: true }],
    },
    themeAndA11y: {
      themeMode: 'light-default-with-toggle',
      themeTokensModule: 'src/ui/tokens.ts',
      contrastTargets: 'WCAG AA',
      contrastTestPath: 'test/ui/contrast.test.ts',
      contrastTestAuthoredBeforePalette: true,
    },
  };
  await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');

  // Add a matching uiBaseline record so the belt-and-braces baseline-vs-
  // designStage disagreement refusal does not fire.
  const manifestPath = join(tmp, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.uiBaseline = {
    id: 'uib-2026-07-31-001',
    createdAt: '2026-07-31T10:00:00Z',
    prdId: 'PRD-001',
    defaults: { themeMode: 'light-default-with-toggle' },
    operatorAckAt: '2026-07-31T10:00:00Z',
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return tmp;
}

async function readManifest(tmp) {
  return JSON.parse(await readFile(join(tmp, 'rcf', 'manifest.json'), 'utf8'));
}

async function readFbs(tmp) {
  return JSON.parse(await readFile(join(tmp, 'rcf', 'fbs', 'fbs-001.json'), 'utf8'));
}

// B-1 blocker: no bvRecord + --accept-block + --reason previously wrote
// stderr only and let the FBS march to complete. Now it must refuse
// cleanly (exit 4, no state mutation, no invented record) and name the
// two-command dance.
test('B-1: --mark complete --accept-block --reason with NO browserVerification record refuses cleanly (exit 4, no state mutation)', async () => {
  const tmp = await scaffoldUiBearingProject();
  const manifestBefore = await readManifest(tmp);
  const fbsBefore = await readFbs(tmp);
  assert.equal(manifestBefore.browserVerification, undefined, 'precondition: no bvRecord');

  const { code, stderr } = await runBin(tmp, [
    'build', 'FBS-001',
    '--mark', 'complete',
    '--accept-block',
    '--reason', 'twenty-plus-character-reason-here-shipping-anyway',
  ]);

  // Exit code is the durable contract; must be 4 (mark-refusal family).
  assert.equal(code, 4, `expected exit 4, got ${code}. stderr:\n${stderr}`);
  assert.match(stderr, /refused build/);
  assert.match(stderr, /no browserVerification record exists/);
  // The message must name the two-command dance so the operator has a
  // clear path forward.
  assert.match(stderr, /rcf browser-verify FBS-001/);
  assert.match(stderr, /--accept-block/);

  // State-mutation guard (the manifest and FBS are byte-identical):
  // no synthetic bvRecord invented, no shipWithoutVerified entry, no
  // status change, no updatedAt bump.
  const manifestAfter = await readManifest(tmp);
  assert.deepEqual(manifestAfter, manifestBefore, 'manifest must be untouched');
  const fbsAfter = await readFbs(tmp);
  assert.deepEqual(fbsAfter, fbsBefore, 'FBS must be untouched (executionStatus, updatedAt included)');
  assert.equal(fbsAfter.executionStatus, 'notStarted', 'FBS must not advance to complete');
});

// B-1 negative: without --accept-block the pre-existing refusal already
// works (that path was covered by the pre-Track-B design). Pin it here
// so a future regression on the ordering of the branches is caught.
test('B-1 (context): --mark complete with NO browserVerification record and NO --accept-block also refuses cleanly (exit 4)', async () => {
  const tmp = await scaffoldUiBearingProject();
  const { code, stderr } = await runBin(tmp, [
    'build', 'FBS-001', '--mark', 'complete',
  ]);
  assert.equal(code, 4, `expected exit 4, got ${code}. stderr:\n${stderr}`);
  assert.match(stderr, /no browserVerification record exists/);
  const fbsAfter = await readFbs(tmp);
  assert.equal(fbsAfter.executionStatus, 'notStarted');
});

// B-1 happy path: with an existing block-verdict bvRecord, --accept-block
// + --reason lands on the manifest as the durable ack (spec section 8.6:
// the reason lands on browserVerification.operatorShipDespiteBlockReason).
test('B-1 (positive): --mark complete --accept-block --reason with an existing block-verdict bvRecord persists the reason on the manifest', async () => {
  const tmp = await scaffoldUiBearingProject();

  // Author an existing browserVerification record with verdict block.
  const manifestPath = join(tmp, 'rcf', 'manifest.json');
  const manifest = await readManifest(tmp);
  manifest.browserVerification = [{
    id: 'bv-FBS-001-1',
    fbsId: 'FBS-001',
    createdAt: '2026-07-31T10:30:00Z',
    mode: 'agentScreenshotCritique',
    runtimeProfile: 'local-dev',
    runtimeUrl: 'http://localhost:3000',
    routesChecked: [{ path: '/', screenshotPath: '.rcf/artefacts/root-light.png', themeApplied: 'light' }],
    invariantChecks: [{ invariant: 'sharedLayoutModule', verdict: 'fail' }],
    verdict: 'block',
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const { code, stderr } = await runBin(tmp, [
    'build', 'FBS-001',
    '--mark', 'complete',
    '--accept-block',
    '--reason', 'twenty-plus-character-reason-here-shipping-anyway',
  ]);
  assert.equal(code, 0, `expected exit 0, got ${code}. stderr:\n${stderr}`);

  const manifestAfter = await readManifest(tmp);
  const bvRecord = manifestAfter.browserVerification[0];
  assert.equal(bvRecord.id, 'bv-FBS-001-1');
  assert.equal(
    bvRecord.operatorShipDespiteBlockReason,
    'twenty-plus-character-reason-here-shipping-anyway',
    'the operator reason must land on the manifest as the durable ack',
  );
  assert.ok(bvRecord.operatorAckAt, 'operatorAckAt must be stamped on the record');

  const fbsAfter = await readFbs(tmp);
  assert.equal(fbsAfter.executionStatus, 'complete');
});

// B-1 (warn context): with an existing warn-verdict bvRecord AND
// operatorAckAt (the sanctioned `rcf browser-verify --ack` clearance),
// --mark complete passes without --accept-block. --accept-block on a
// warn record no longer touches the record's operatorShipDespiteBlockReason
// because the N-3 dead disjunct is gone; the sanctioned warn clear is
// --ack, not --accept-block.
test('B-1 (context): warn-verdict bvRecord cleared via --ack permits --mark complete without --accept-block', async () => {
  const tmp = await scaffoldUiBearingProject();
  const manifestPath = join(tmp, 'rcf', 'manifest.json');
  const manifest = await readManifest(tmp);
  manifest.browserVerification = [{
    id: 'bv-FBS-001-1',
    fbsId: 'FBS-001',
    createdAt: '2026-07-31T10:30:00Z',
    mode: 'agentScreenshotCritique',
    runtimeProfile: 'local-dev',
    runtimeUrl: 'http://localhost:3000',
    routesChecked: [{ path: '/', screenshotPath: '.rcf/artefacts/root-light.png', themeApplied: 'light' }],
    invariantChecks: [{ invariant: 'agentDriverWired', verdict: 'fail' }],
    verdict: 'warn',
    operatorAckAt: '2026-07-31T11:00:00Z',
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const { code, stderr } = await runBin(tmp, [
    'build', 'FBS-001', '--mark', 'complete',
  ]);
  assert.equal(code, 0, `expected exit 0 on ack'd warn, got ${code}. stderr:\n${stderr}`);
  const fbsAfter = await readFbs(tmp);
  assert.equal(fbsAfter.executionStatus, 'complete');
  // No operatorShipDespiteBlockReason should have been written; the
  // warn clear was --ack, not --accept-block.
  const manifestAfter = await readManifest(tmp);
  assert.equal(manifestAfter.browserVerification[0].operatorShipDespiteBlockReason, undefined);
});
