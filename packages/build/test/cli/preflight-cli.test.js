// `rcf preflight` CLI integration tests
// (verification-integrity-cluster-spec §4, ADDENDUM §A).
//
// AC-4.1  non-interactive --input writes a preFlightConfig record with
//         the correct id shape and the operator's per-service rulings.
// AC-4.2  operator-added candidate (empty sourceRefs) is accepted by
//         schema — 0.4.0 minItems:0 on sourceRefs is what makes this valid.
// AC-4.3  a design-shape answer of "apiOnly" writes a
//         designShapeAnswers[] entry AND a baselineAcOptOuts[] entry
//         with linkedPreFlightConfigRef pointing at the record + question.
// AC-4.4  the credentials side-file lives at .rcf/preflight-secrets.local.json
//         after a live/sandboxed session; the chain never contains a value.
// AC-4.5  --dry-run emits the composed record without writing.
// AC-4.6  session-cancelled exits 4 (this test path uses --input which
//         cannot cancel; covered by direct session tests).

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

async function scaffold(prefix = 'rcf-preflight-cli-') {
  const tmp = await mkdtemp(join(tmpdir(), prefix));
  await initProject({ projectRoot: tmp, projectName: 'PreflightTest' });
  return tmp;
}

test('AC-4.1: non-interactive preflight writes a valid preFlightConfig record with the ruling', async () => {
  const tmp = await scaffold();
  const input = {
    services: [
      {
        id: 'resend',
        displayName: 'Resend email API',
        sourceRefs: ['PRD-001#external-integrations'],
        attestationMode: 'declaredMockOnly',
        credentialSupplied: false,
        sandboxProvisioned: false,
        operatorReason: 'no key available; ship blocker acknowledged',
      },
    ],
  };
  const inputPath = join(tmp, 'preflight-input.json');
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  const { code, stdout, stderr } = await runBin(tmp, ['preflight', '--non-interactive', '--input', inputPath]);
  assert.equal(code, 0, `stderr=${stderr}`);
  assert.match(stdout, /wrote pfc-\d{4}-\d{2}-\d{2}-001/);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  assert.equal(Array.isArray(manifest.preFlightConfig), true);
  assert.equal(manifest.preFlightConfig.length, 1);
  const rec = manifest.preFlightConfig[0];
  assert.match(rec.id, /^pfc-\d{4}-\d{2}-\d{2}-001$/);
  assert.equal(rec.servicesInScope[0].id, 'resend');
  assert.equal(rec.servicesInScope[0].attestationMode, 'declaredMockOnly');
  assert.equal(rec.operatorAckAt, rec.createdAt);
});

test('AC-4.2: an operator-added candidate with zero sourceRefs is accepted (0.4.0 minItems:0)', async () => {
  const tmp = await scaffold('rcf-preflight-cli-op-add-');
  const input = {
    services: [
      {
        id: 'internalRelay',
        displayName: 'Internal event relay',
        sourceRefs: [],
        attestationMode: 'notShipped',
        credentialSupplied: false,
        sandboxProvisioned: false,
      },
    ],
  };
  const inputPath = join(tmp, 'preflight-op-add.json');
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  const { code, stderr } = await runBin(tmp, ['preflight', '--non-interactive', '--input', inputPath]);
  assert.equal(code, 0, `stderr=${stderr}`);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.preFlightConfig[0].servicesInScope[0].sourceRefs, []);
});

test('AC-4.3: an apiOnly design-shape answer writes designShapeAnswers[] and baselineAcOptOuts[] with linkedPreFlightConfigRef', async () => {
  const tmp = await scaffold('rcf-preflight-cli-designshape-');
  const input = {
    services: [],
    designShapeAnswers: [
      {
        questionId: 'auth.htmlLoginPage',
        reqId: 'REQ-101',
        answer: 'apiOnly',
        reason: 'SDK-driven clients only; no human browser flow ships in v1',
      },
    ],
  };
  const inputPath = join(tmp, 'preflight-designshape.json');
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  const { code, stderr } = await runBin(tmp, ['preflight', '--non-interactive', '--input', inputPath]);
  assert.equal(code, 0, `stderr=${stderr}`);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  const pfc = manifest.preFlightConfig[0];
  assert.equal(pfc.designShapeAnswers[0].questionId, 'auth.htmlLoginPage');
  assert.equal(pfc.designShapeAnswers[0].answer, 'apiOnly');
  assert.equal(Array.isArray(manifest.baselineAcOptOuts), true);
  assert.equal(manifest.baselineAcOptOuts.length, 1);
  const oo = manifest.baselineAcOptOuts[0];
  assert.equal(oo.baselineKey, 'auth.htmlLoginPage');
  assert.equal(oo.scope, 'req');
  assert.equal(oo.reqId, 'REQ-101');
  assert.equal(oo.linkedPreFlightConfigRef, `${pfc.id}#designShapeAnswers.auth.htmlLoginPage`);
});

test('AC-4.5: --dry-run emits the composed record and does NOT write', async () => {
  const tmp = await scaffold('rcf-preflight-cli-dryrun-');
  const input = { services: [{ id: 'x', displayName: 'X', sourceRefs: [], attestationMode: 'notShipped', credentialSupplied: false, sandboxProvisioned: false }] };
  const inputPath = join(tmp, 'preflight-dry.json');
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  const { code, stdout } = await runBin(tmp, ['preflight', '--non-interactive', '--input', inputPath, '--dry-run', '--json']);
  assert.equal(code, 0);
  const emitted = JSON.parse(stdout.split('\n[dry-run]')[0]);
  assert.equal(emitted.record.servicesInScope[0].id, 'x');
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  assert.equal(Array.isArray(manifest.preFlightConfig) ? manifest.preFlightConfig.length : 0, 0, 'dry-run did not touch the manifest');
});

test('preflight refuses on --non-interactive without --input', async () => {
  const tmp = await scaffold('rcf-preflight-cli-noinput-');
  const { code, stderr } = await runBin(tmp, ['preflight', '--non-interactive']);
  assert.equal(code, 2);
  assert.match(stderr, /not on a TTY and no --input file given/);
});
