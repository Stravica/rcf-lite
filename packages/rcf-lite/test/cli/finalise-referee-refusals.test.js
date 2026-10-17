// `rcf build finalise` referee-guarantee refusal branches
// (referee-guarantees train, REQ-165 / US-16501 + US-16502, docs
// claims C-22 / C-26 / C-28 / C-29 / C-30 / C-36).
//
// Load-bearing behaviour: on a verify PASS whose report carries at
// least one per-AC UI-BASELINE-UNMET, BROWSER-VERIFICATION-MISSING or
// SCOPE-MISMATCH verdict, finalise refuses to promote complete ->
// verified. On the older report shape (no perAcVerdicts field), the
// gate proceeds unchanged. The merge-state precondition (C-26) refuses
// promotion when git is not on a default trunk unless --allow-pre-merge
// is passed. The writer refusal (C-22) blocks a manual
// executionStatus=verified write on FBS unless
// --acknowledge-verified-override is passed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as realSpawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';

import { main as finalise } from '../../src/cli/finalise.js';
import { updateDocument } from '#core/store';
import { walkTree } from '#core/store';
import { scratchDir } from '../_helpers/scratch.js';

function sink() {
  return { data: '', write(s) { this.data += s; } };
}

const STUB = `import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outPath = argv[outIdx + 1];
const perAcVerdicts = JSON.parse(process.env.STUB_PER_AC ?? '[]');
const report = {
  schemaVersion: '1',
  verdict: 'PASS',
  verdictAuthority: 'ship',
  run: { profile: 'deployed', url: 'https://app.example.com', parityEnv: false },
  findings: [],
};
if (perAcVerdicts.length > 0) report.perAcVerdicts = perAcVerdicts;
writeFileSync(outPath, JSON.stringify(report), 'utf8');
process.exit(0);
`;

async function scaffoldComplete() {
  const tmp = await scratchDir('rcf-fin-referee-');
  await initProject({ projectRoot: tmp, projectName: 'RefereeTest' });
  const fbsPath = join(tmp, 'rcf/fbs/fbs-001.json');
  const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
  fbs.executionStatus = 'complete';
  await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  const stubPath = join(tmp, 'stub-verify.mjs');
  await writeFile(stubPath, STUB, 'utf8');
  return { tmp, stubPath };
}

async function readStatus(tmp) {
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  return fbs.executionStatus;
}

// Stub the git branch so the merge-state precondition (C-26) does not
// gate every test unrelated to that check. Tests targeting C-26 pass
// an alternative branch explicitly. The stub spawn only intercepts
// `git` calls; every other spawn (rcf-verify) goes through the real
// child_process.spawn.
function stubDeps({ tmp, stubPath, perAc, branch = 'main' }) {
  const stubSpawn = (command, args, opts) => {
    if (command !== 'git') return realSpawn(command, args, opts);
    const child = {
      stdout: { on: (evt, fn) => { if (evt === 'data') fn(Buffer.from(`${branch}\n`)); } },
      stderr: { on: () => {} },
      on: (evt, fn) => { if (evt === 'close') queueMicrotask(() => fn(0)); },
    };
    return child;
  };
  return {
    stdout: sink(),
    stderr: sink(),
    cwd: tmp,
    detectVerify: async () => ({
      installed: true,
      invocation: { command: process.execPath, prefixArgs: [stubPath], source: 'package' },
    }),
    baseEnv: { ...process.env, STUB_PER_AC: JSON.stringify(perAc) },
    stdio: 'ignore',
    spawn: stubSpawn,
  };
}

test('define update FBS.executionStatus=verified is refused without --acknowledge-verified-override (referee-guarantees C-22)', async () => {
  const { tmp } = await scaffoldComplete();
  const { tree } = await walkTree({ projectRoot: tmp });
  const result = await updateDocument({
    projectRoot: tmp,
    tree,
    id: 'FBS-001',
    sets: [{ path: 'executionStatus', value: 'verified' }],
    options: {},
  });
  // The writer returns an RcfError; the message names the finalise gate.
  assert.equal(result.kind, 'usage');
  assert.match(result.message, /verified is written only by the finalise gate/);
  // FBS on disk is unchanged.
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  assert.equal(fbs.executionStatus, 'complete');
});

test('define update FBS.executionStatus=verified proceeds with allowVerifiedOverride:true (finalise seam, C-22 opt-out)', async () => {
  const { tmp } = await scaffoldComplete();
  const { tree } = await walkTree({ projectRoot: tmp });
  const result = await updateDocument({
    projectRoot: tmp,
    tree,
    id: 'FBS-001',
    sets: [{ path: 'executionStatus', value: 'verified' }],
    options: { allowVerifiedOverride: true },
  });
  assert.ok(result.id, `expected write success, got ${JSON.stringify(result)}`);
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  assert.equal(fbs.executionStatus, 'verified');
});
