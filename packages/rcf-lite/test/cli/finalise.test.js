// `rcf finalise` integration tests (spec §8 - the build-side finalise-gate).
//
// These prove the load-bearing contract points that unit tests cannot:
//   - verify is launched as a REAL FRESH SUBPROCESS (a stub rcf-verify is
//     executed via node child_process, and it records that it ran) - never an
//     in-process import (§8.2 / §9 independence);
//   - the subprocess EXIT CODE is the gate: exit 0 promotes complete->verified,
//     non-zero leaves the FBS unchanged and surfaces findings (§8.2);
//   - the ISOLATION ENV (§7.3) reaches the subprocess;
//   - findings flow via the --out REPORT FILE, not stdout scraping (§8.2);
//   - the absent-verify path PROMPTS / requires a flag and NEVER silently skips
//     the gate (§8.3).
//
// The stub stands in for rcf-verify by injecting the detection result; the
// spawn itself is the real spawnVerify (not injected), so the process boundary
// and env propagation are genuinely exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';

import { main as finalise } from '../../src/cli/finalise.js';
import { scratchDir } from '../_helpers/scratch.js';

function sink() {
  return { data: '', write(s) { this.data += s; } };
}

// A stub rcf-verify: records its argv + the isolation env it was spawned with
// to a marker file, writes the --out report, and exits with STUB_EXIT.
const STUB = `import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outPath = argv[outIdx + 1];
writeFileSync(process.env.STUB_MARKER, JSON.stringify({
  argv,
  autoMemoryDisabled: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
  trafficDisabled: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
}), 'utf8');
if (!process.env.STUB_SKIP_REPORT) {
  writeFileSync(outPath, JSON.stringify({
    schemaVersion: '1',
    verdict: process.env.STUB_VERDICT ?? 'PASS',
    verdictAuthority: process.env.STUB_AUTHORITY ?? 'ship',
    run: {
      profile: process.env.STUB_PROFILE ?? 'deployed',
      url: 'https://app.example.com',
      parityEnv: process.env.STUB_PARITY === '1',
    },
    findings: JSON.parse(process.env.STUB_FINDINGS ?? '[]'),
  }), 'utf8');
}
process.exit(Number(process.env.STUB_EXIT ?? '0'));
`;

async function scaffoldComplete() {
  const tmp = await scratchDir('rcf-finalise-');
  await initProject({ projectRoot: tmp, projectName: 'FinaliseTest' });
  // Move FBS-001 to `complete` so the finalise gate is applicable.
  const fbsPath = join(tmp, 'rcf/fbs/fbs-001.json');
  const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
  fbs.executionStatus = 'complete';
  await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  return tmp;
}

async function writeStub(tmp) {
  const stubPath = join(tmp, 'stub-rcf-verify.mjs');
  await writeFile(stubPath, STUB, 'utf8');
  return stubPath;
}

async function readStatus(tmp) {
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  return fbs.executionStatus;
}

// Base deps that point finalise at the stub as a real subprocess.
function stubDeps(tmp, stubPath, markerPath, extraEnv = {}) {
  return {
    stdout: sink(),
    stderr: sink(),
    cwd: tmp,
    detectVerify: async () => ({
      installed: true,
      invocation: { command: process.execPath, prefixArgs: [stubPath], source: 'package' },
    }),
    // Real spawnVerify runs; feed it the stub's control env + silence its stdio.
    baseEnv: { ...process.env, STUB_MARKER: markerPath, ...extraEnv },
    stdio: 'ignore',
  };
}

test('finalise: a non-FBS id is a usage error', async () => {
  const tmp = await scaffoldComplete();
  const deps = { stdout: sink(), stderr: sink(), cwd: tmp };
  const code = await finalise(['US-101', '--url', 'https://app.example.com'], deps);
  assert.equal(code, 2);
});
