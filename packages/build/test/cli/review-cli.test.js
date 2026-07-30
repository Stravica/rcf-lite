// `rcf review <fbs-id>` CLI integration tests
// (verification-integrity-cluster-spec §5.5, §6).
//
// The mutation runner is injected via `deps.mutationRunner`; when
// omitted (from the child_process path), the CLI's default runner
// records a valid schema record and a `notes` explaining that no
// runner was wired. Exit codes: 0 pass, 4 warn/block, 3 validation,
// 2 usage, 1 unexpected IO.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';

import { main as review } from '../../src/cli/review.js';

function sink() {
  return { data: '', write(s) { this.data += s; } };
}

async function scaffoldWithFbs({ dependsOnServices, tsProfile } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-review-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'ReviewTest' });
  if (dependsOnServices) {
    const fbsPath = join(tmp, 'rcf/fbs/fbs-001.json');
    const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
    fbs.dependsOnServices = dependsOnServices;
    await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  }
  const ts = {
    id: 'TS-001',
    usId: 'US-101',
    status: 'draft',
    title: 'US-101 coverage',
    purpose: 'Cover AC-101-1',
    testLevel: 'integration',
    acIds: ['AC-101-1'],
    testCases: [{
      id: 'TC-001-happy', acId: 'AC-101-1', description: 'happy', status: 'pending',
      testPointer: 'test/happy.test.js::happy path',
      ...(tsProfile ? { runtimeProvenance: { profile: tsProfile } } : {}),
    }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/test-suites/ts-001.json'), `${JSON.stringify(ts, null, 2)}\n`, 'utf8');
  await mkdir(join(tmp, 'test'), { recursive: true });
  await writeFile(join(tmp, 'test/happy.test.js'), "test('happy path', () => {});\n", 'utf8');
  return tmp;
}

test('review with no findings exits 0 and writes a reviewAudit record with pass verdict', async () => {
  const tmp = await scaffoldWithFbs();
  const stdout = sink();
  const stderr = sink();
  const code = await review(['FBS-001', '--skip-mutation'], { stdout, stderr, cwd: tmp });
  assert.equal(code, 0, `stderr=${stderr.data}`);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  assert.equal(manifest.reviewAudit.length, 1);
  assert.equal(manifest.reviewAudit[0].verdict, 'pass');
  assert.equal(manifest.reviewAudit[0].mutationSampling.mode, 'skipped');
});

test('review detects mockOnlyIntegrationClaim -> block, exit 4', async () => {
  const tmp = await scaffoldWithFbs({
    dependsOnServices: [{ id: 'resend', displayName: 'r', purpose: 'x', attestationMode: 'live', acIds: ['AC-101-1'] }],
    tsProfile: 'mock',
  });
  const stdout = sink();
  const stderr = sink();
  const code = await review(['FBS-001', '--skip-mutation'], { stdout, stderr, cwd: tmp });
  assert.equal(code, 4);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  const rec = manifest.reviewAudit[0];
  assert.equal(rec.verdict, 'block');
  const finding = rec.testTheatreFindings.find((f) => f.kind === 'mockOnlyIntegrationClaim');
  assert.notEqual(finding, undefined);
  assert.equal(finding.severity, 'block');
});

test('review --dry-run does NOT write the record', async () => {
  const tmp = await scaffoldWithFbs();
  const stdout = sink();
  const stderr = sink();
  const code = await review(['FBS-001', '--dry-run', '--skip-mutation'], { stdout, stderr, cwd: tmp });
  assert.equal(code, 0);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  assert.equal(Array.isArray(manifest.reviewAudit) ? manifest.reviewAudit.length : 0, 0);
});

test('review with injected mutationRunner records the survivor and blocks', async () => {
  const tmp = await scaffoldWithFbs();
  const stdout = sink();
  const stderr = sink();
  const injected = async (input) => ({
    record: {
      mode: 'agent-v1',
      mutantsGenerated: 15,
      mutantsRun: 15,
      killed: 14,
      survived: 1,
      durationMs: 42000,
      survivors: [{
        mutationId: 'mut-001-1',
        targetFile: 'src/dispatcher.js',
        targetSymbol: 'shouldSend',
        mutationSummary: 'flip guard condition',
        acIds: input.acIds,
        tsIdsShouldHaveCaught: ['TS-001'],
        tcIdsShouldHaveCaught: ['TC-001-happy'],
      }],
    },
  });
  const code = await review(['FBS-001'], { stdout, stderr, cwd: tmp, mutationRunner: injected });
  assert.equal(code, 4);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  const rec = manifest.reviewAudit[0];
  assert.equal(rec.verdict, 'block');
  assert.equal(rec.mutationSampling.mode, 'agent-v1');
  assert.equal(rec.mutationSampling.survivors[0].mutationId, 'mut-001-1');
});

test('review refuses on a non-FBS id (exit 2)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-review-badid-'));
  await initProject({ projectRoot: tmp, projectName: 'BadId' });
  const stdout = sink();
  const stderr = sink();
  const code = await review(['TS-001'], { stdout, stderr, cwd: tmp });
  assert.equal(code, 2);
  assert.match(stderr.data, /expected an FBS id/);
});
