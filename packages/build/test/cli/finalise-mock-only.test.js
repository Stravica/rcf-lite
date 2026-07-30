// `rcf finalise` MOCK-ONLY-DECLARED gate integration tests
// (verification-integrity-cluster-spec §5.2 finalise gate rule, §4.5).
//
// Load-bearing behaviour: on a verify PASS whose report carries at
// least one per-AC MOCK-ONLY-DECLARED / BLOCKED-BY-DECLARATION verdict,
// finalise refuses to promote 'complete' -> 'verified' unless the
// operator passes --ship-without-verified. On the older report shape
// (no perAcVerdicts field), behaviour is identical to pre-0.7.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';

import { main as finalise } from '../../src/cli/finalise.js';

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
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-fin-mockonly-'));
  await initProject({ projectRoot: tmp, projectName: 'FinMockOnlyTest' });
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

function stubDeps({ tmp, stubPath, perAc }) {
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
  };
}

test('finalise refuses to promote on a passing verify report that carries MOCK-ONLY-DECLARED verdicts', async () => {
  const { tmp, stubPath } = await scaffoldComplete();
  const deps = stubDeps({
    tmp,
    stubPath,
    perAc: [{ acId: 'AC-101-2', verdict: 'MOCK-ONLY-DECLARED', reason: 'no live path' }],
  });
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com'], deps);
  assert.equal(code, 4, `stderr=${deps.stderr.data}`);
  assert.equal(await readStatus(tmp), 'complete', 'FBS left at complete');
  assert.match(deps.stderr.data, /1 AC\(s\) came back MOCK-ONLY-DECLARED/);
  assert.match(deps.stderr.data, /--ship-without-verified/);
});

test('finalise --ship-without-verified acknowledges the declaration and leaves the FBS at complete', async () => {
  const { tmp, stubPath } = await scaffoldComplete();
  const deps = stubDeps({
    tmp,
    stubPath,
    perAc: [{ acId: 'AC-101-2', verdict: 'BLOCKED-BY-DECLARATION' }],
  });
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--ship-without-verified'], deps);
  assert.equal(code, 0);
  assert.equal(await readStatus(tmp), 'complete', 'FBS left at complete under ack');
  assert.match(deps.stdout.data, /--ship-without-verified acknowledged/);
});

test('finalise on a report without perAcVerdicts promotes as usual (backwards compatible)', async () => {
  const { tmp, stubPath } = await scaffoldComplete();
  const deps = stubDeps({ tmp, stubPath, perAc: [] });
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com'], deps);
  assert.equal(code, 0);
  assert.equal(await readStatus(tmp), 'verified', 'FBS promoted (no perAcVerdicts to gate on)');
});
