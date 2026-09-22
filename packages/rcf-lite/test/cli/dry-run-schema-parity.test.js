// Matrix guard: --dry-run and the write path share ONE schema pass
// across the five discover verbs (0.28.2, issues #230 and #232 with
// review / ui-baseline init / browser-verify folded in per Barry's
// 2026-09-21 ruling).
//
// The reported cases Barry hit in the WSD round-trip:
//   - `rcf discover intake --input <file> --dry-run` accepted a
//     `fidelity: briefRich` that the real run refused with a manifest
//     schema error (issue #230).
//   - `rcf discover preflight --input <file> --dry-run` accepted a
//     kebab-case service id that the real run refused (issue #232).
//
// After 0.28.2 both dry-run paths run `validateComposedRecord` and
// exit 3 with the same message a real run would surface. Any future
// dry-run branch that skips the schema pass fails this matrix.

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

async function scaffold(prefix) {
  const tmp = await mkdtemp(join(tmpdir(), prefix));
  await initProject({ projectRoot: tmp, projectName: 'DryRunParityTest' });
  return tmp;
}

// -- intake ---------------------------------------------------------------

test('AC-15701 (0.28.2 issue #230): intake --dry-run refuses a bad fidelity enum with the same error the write path returns', async () => {
  const tmp = await scaffold('rcf-dryrun-intake-bad-fidelity-');
  const input = {
    fidelity: 'briefRich',
    artefacts: [],
    validationFindings: [],
    elicitationScope: { requestElicitationForAll: false },
  };
  const inputPath = join(tmp, 'intake.json');
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  const dry = await runBin(tmp, ['discover', 'intake', '--input', inputPath, '--dry-run']);
  assert.equal(dry.code, 3, `dry-run must exit 3 on schema miss, got ${dry.code}: ${dry.stderr}`);
  assert.match(dry.stderr, /validation/);
  assert.match(dry.stderr, /fidelity/);
  // The real run must exit with the same shape (parity).
  const real = await runBin(tmp, ['discover', 'intake', '--input', inputPath]);
  assert.equal(real.code, 3, `real run must also exit 3, got ${real.code}: ${real.stderr}`);
  assert.match(real.stderr, /fidelity/);
});

test('AC-15701 (0.28.2 issue #230): intake --dry-run passes an allowed fidelity (parity with the write path)', async () => {
  const tmp = await scaffold('rcf-dryrun-intake-ok-fidelity-');
  const input = {
    fidelity: 'briefLight',
    artefacts: [],
    validationFindings: [],
    elicitationScope: {},
  };
  const inputPath = join(tmp, 'intake.json');
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  const dry = await runBin(tmp, ['discover', 'intake', '--input', inputPath, '--dry-run']);
  assert.equal(dry.code, 0, `dry-run on a valid fidelity must succeed: ${dry.stderr}`);
});

test('AC-15701 (0.28.2 issue #230): intake --help advertises the fidelity enum so a caller can discover it before tripping it', async () => {
  const tmp = await scaffold('rcf-dryrun-intake-help-');
  const { code, stdout } = await runBin(tmp, ['discover', 'intake', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Fidelity enum/);
  assert.match(stdout, /briefStrong/);
});

// -- preflight ------------------------------------------------------------

test('AC-15701 (0.28.2 issue #232): preflight --dry-run refuses a kebab-case service id with the same error the write path returns', async () => {
  const tmp = await scaffold('rcf-dryrun-preflight-bad-id-');
  const input = {
    services: [
      {
        id: 'stripe-checkout',
        displayName: 'Stripe Checkout',
        sourceRefs: ['PRD-001#external-integrations'],
        attestationMode: 'declaredMockOnly',
        credentialSupplied: false,
        sandboxProvisioned: false,
      },
    ],
  };
  const inputPath = join(tmp, 'preflight.json');
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  const dry = await runBin(tmp, ['discover', 'preflight', '--non-interactive', '--input', inputPath, '--dry-run']);
  assert.equal(dry.code, 3, `dry-run must exit 3 on kebab id, got ${dry.code}: ${dry.stderr}`);
  assert.match(dry.stderr, /validation/);
  assert.match(dry.stderr, /pattern/);
  // Parity: the real run refuses too.
  const real = await runBin(tmp, ['discover', 'preflight', '--non-interactive', '--input', inputPath]);
  assert.equal(real.code, 3);
});

test('AC-15701 (0.28.2 issue #232): preflight --help advertises the service id pattern so a caller can discover it before tripping it', async () => {
  const tmp = await scaffold('rcf-dryrun-preflight-help-');
  const { code, stdout } = await runBin(tmp, ['discover', 'preflight', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Service id shape/);
});

test('AC-15701 (0.28.2 issue #232): preflight --dry-run passes a valid camelCase service id', async () => {
  const tmp = await scaffold('rcf-dryrun-preflight-ok-id-');
  const input = {
    services: [
      {
        id: 'stripeCheckout',
        displayName: 'Stripe Checkout',
        sourceRefs: ['PRD-001#external-integrations'],
        attestationMode: 'declaredMockOnly',
        credentialSupplied: false,
        sandboxProvisioned: false,
      },
    ],
  };
  const inputPath = join(tmp, 'preflight.json');
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  const dry = await runBin(tmp, ['discover', 'preflight', '--non-interactive', '--input', inputPath, '--dry-run']);
  assert.equal(dry.code, 0, `dry-run on a valid id must succeed: ${dry.stderr}`);
});
