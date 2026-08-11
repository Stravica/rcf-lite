// `rcf coverage --strict` verification-integrity gate tests
// (verification-integrity-cluster-spec §5.1, §5.2, §7.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

async function scaffoldChain({ tsStatus = 'draft', tcProvenance, fbsServices } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cov-strict-'));
  await initProject({ projectRoot: tmp, projectName: 'CovStrictTest' });
  // Give FBS-001 (seeded) the service binding when supplied.
  if (fbsServices) {
    const fbsPath = join(tmp, 'rcf/fbs/fbs-001.json');
    const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
    fbs.dependsOnServices = fbsServices;
    await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  }
  // Give the seeded US-101/AC-101-1 a covering TS with real test file.
  const ts = {
    id: 'TS-001',
    usId: 'US-101',
    status: tsStatus,
    title: 'US-101 coverage',
    purpose: 'Cover AC-101-1',
    testLevel: 'integration',
    acIds: ['AC-101-1'],
    testCases: [{
      id: 'TC-001-happy',
      acId: 'AC-101-1',
      description: 'happy path',
      status: 'pending',
      testPointer: 'test/happy.test.js::happy path',
      ...(tcProvenance !== undefined ? { runtimeProvenance: tcProvenance } : {}),
    }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/test-suites/ts-001.json'), `${JSON.stringify(ts, null, 2)}\n`, 'utf8');
  await mkdir(join(tmp, 'test'), { recursive: true });
  await writeFile(join(tmp, 'test/happy.test.js'), "test('happy path', () => {});\n", 'utf8');
  return tmp;
}

test('coverage --strict passes when no dependsOnServices are declared (baseline behaviour)', async () => {
  const tmp = await scaffoldChain({ tcProvenance: undefined, fbsServices: null });
  const { code } = await runBin(tmp, ['coverage', '--strict']);
  assert.equal(code, 0);
});

test('coverage --strict refuses when TC lacks provenance and AC binds a service', async () => {
  const tmp = await scaffoldChain({
    tcProvenance: undefined,
    fbsServices: [{ id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'live', acIds: ['AC-101-1'] }],
  });
  const { code, stderr } = await runBin(tmp, ['coverage', '--strict']);
  assert.equal(code, 4);
  assert.match(stderr, /Runtime provenance missing/);
  assert.match(stderr, /TS-001\/TC-001-happy/);
});

test('coverage --strict refuses attestation drift: live × mock', async () => {
  const tmp = await scaffoldChain({
    tcProvenance: { profile: 'mock' },
    fbsServices: [{ id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'live', acIds: ['AC-101-1'] }],
  });
  const { code, stderr } = await runBin(tmp, ['coverage', '--strict']);
  assert.equal(code, 4);
  assert.match(stderr, /Attestation drift/);
  assert.match(stderr, /AC attests live; TC provenance is `mock`/);
});

test('coverage --strict passes on live × live', async () => {
  const tmp = await scaffoldChain({
    tcProvenance: { profile: 'live', envVarsRequired: ['RESEND_API_KEY'], externalHostsReached: ['api.resend.com'] },
    fbsServices: [{ id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'live', acIds: ['AC-101-1'] }],
  });
  const { code, stderr } = await runBin(tmp, ['coverage', '--strict']);
  assert.equal(code, 0, `stderr=${stderr}`);
});

test('coverage --strict passes on declaredMockOnly × mock', async () => {
  const tmp = await scaffoldChain({
    tcProvenance: { profile: 'mock' },
    fbsServices: [{ id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'declaredMockOnly', acIds: ['AC-101-1'] }],
  });
  const { code, stderr } = await runBin(tmp, ['coverage', '--strict']);
  assert.equal(code, 0, `stderr=${stderr}`);
});

test('coverage --strict --require-approved refuses on a draft TS', async () => {
  const tmp = await scaffoldChain({
    tsStatus: 'draft',
    tcProvenance: { profile: 'mock' },
    fbsServices: [{ id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'declaredMockOnly', acIds: ['AC-101-1'] }],
  });
  const plain = await runBin(tmp, ['coverage', '--strict']);
  assert.equal(plain.code, 0, `baseline --strict should pass first: ${plain.stderr}`);
  const gated = await runBin(tmp, ['coverage', '--strict', '--require-approved']);
  assert.equal(gated.code, 4);
  assert.match(gated.stderr, /not approved: TS-001/);
});

test('coverage --strict --require-approved passes when the TS is approved', async () => {
  const tmp = await scaffoldChain({
    tsStatus: 'approved',
    tcProvenance: { profile: 'mock' },
    fbsServices: [{ id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'declaredMockOnly', acIds: ['AC-101-1'] }],
  });
  const { code, stderr } = await runBin(tmp, ['coverage', '--strict', '--require-approved']);
  assert.equal(code, 0, `stderr=${stderr}`);
});

test('coverage --strict warns (but does not refuse) on a preFlightConfig service with empty affectedFbsIds (N-3)', async () => {
  const tmp = await scaffoldChain({
    tcProvenance: { profile: 'mock' },
    fbsServices: [{ id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'declaredMockOnly', acIds: ['AC-101-1'] }],
  });
  // Add a preFlightConfig record whose service has no affectedFbsIds.
  const manifestPath = join(tmp, 'rcf/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.preFlightConfig = [{
    id: 'pfc-2026-07-31-001',
    createdAt: '2026-07-31T10:00:00Z',
    prdId: 'PRD-001',
    servicesInScope: [{
      id: 'orphanService',
      displayName: 'Orphan',
      sourceRefs: ['PRD-001#external'],
      attestationMode: 'live',
      credentialSupplied: true,
      sandboxProvisioned: false,
    }],
    operatorAckAt: '2026-07-31T10:02:00Z',
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const { code, stderr } = await runBin(tmp, ['coverage', '--strict']);
  assert.equal(code, 0, `warn-only, should not exit 4: stderr=${stderr}`);
  assert.match(stderr, /preFlightConfig service 'orphanService'/);
  assert.match(stderr, /empty affectedFbsIds/);
});
