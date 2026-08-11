// `rcf fbs <fbs-id> depends-on` CLI integration tests
// (verification-integrity-cluster-spec §3.1, §5.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

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

async function scaffoldFbs() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-fbs-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'FbsTest' });
  const fbs = {
    fbsId: 'FBS-001',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    title: 'Email dispatcher',
    summary: 'Ship recovery email dispatch',
    buildOrder: 1,
    executionStatus: 'notStarted',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/fbs/fbs-001.json'), `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  return tmp;
}

test('fbs depends-on writes a dependsOnServices entry', async () => {
  const tmp = await scaffoldFbs();
  const { code, stderr } = await runBin(tmp, [
    'fbs', 'FBS-001', 'depends-on', '--service', 'resend', '--mode', 'live', '--acs', 'AC-101-1',
    '--display', 'Resend email API', '--purpose', 'transactional email',
  ]);
  assert.equal(code, 0, `stderr=${stderr}`);
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  assert.equal(fbs.dependsOnServices.length, 1);
  assert.equal(fbs.dependsOnServices[0].id, 'resend');
  assert.equal(fbs.dependsOnServices[0].attestationMode, 'live');
  assert.deepEqual(fbs.dependsOnServices[0].acIds, ['AC-101-1']);
});

test('fbs depends-on idempotent by service id: second call replaces the entry', async () => {
  const tmp = await scaffoldFbs();
  await runBin(tmp, ['fbs', 'FBS-001', 'depends-on', '--service', 'resend', '--mode', 'mocked', '--acs', 'AC-101-1']);
  await runBin(tmp, ['fbs', 'FBS-001', 'depends-on', '--service', 'resend', '--mode', 'live', '--acs', 'AC-101-1']);
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  assert.equal(fbs.dependsOnServices.length, 1);
  assert.equal(fbs.dependsOnServices[0].attestationMode, 'live');
});

test('fbs depends-on refuses --acs referencing an AC not on the FBS', async () => {
  const tmp = await scaffoldFbs();
  const { code, stderr } = await runBin(tmp, [
    'fbs', 'FBS-001', 'depends-on', '--service', 'resend', '--mode', 'live', '--acs', 'AC-999-9',
  ]);
  assert.equal(code, 4);
  assert.match(stderr, /does not bind AC/);
});

test('fbs depends-on refuses unknown --mode', async () => {
  const tmp = await scaffoldFbs();
  const { code, stderr } = await runBin(tmp, [
    'fbs', 'FBS-001', 'depends-on', '--service', 'resend', '--mode', 'whatever', '--acs', 'AC-101-1',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /unknown --mode/);
});

test('fbs depends-on refuses non-camelCase --service id', async () => {
  const tmp = await scaffoldFbs();
  const { code, stderr } = await runBin(tmp, [
    'fbs', 'FBS-001', 'depends-on', '--service', 'Resend-Email', '--mode', 'live', '--acs', 'AC-101-1',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /must be camelCase/);
});

test('fbs depends-on --preflight expands a bare pfc id to the composite ref', async () => {
  const tmp = await scaffoldFbs();
  const { code } = await runBin(tmp, [
    'fbs', 'FBS-001', 'depends-on', '--service', 'resend', '--mode', 'live', '--acs', 'AC-101-1',
    '--preflight', 'pfc-2026-07-30-001',
  ]);
  assert.equal(code, 0);
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  assert.equal(fbs.dependsOnServices[0].preFlightRef, 'pfc-2026-07-30-001#services.resend');
});
