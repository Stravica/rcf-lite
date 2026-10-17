// Issue 330 (2026-10-08) finalise-side coverage:
//   1. --mode threads through to the fresh verify subprocess (argv shape).
//   2. Deterministic-mode BLOCKED verdict is refused at the gate with
//      the counts line (ADR-4112 verified invariant).
//   3. Deterministic-mode PASS with skipped>0 is ALSO refused (no quiet
//      promotion).
//   4. Partial-report fallback: when verify exits non-zero without
//      replacing the preseed stub, the gate-NOT-passed path overwrites
//      the stub with an `aborted` record naming the mode and the exit
//      code — never leaves the operator reading ENOENT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';

import { main as finalise } from '../../src/cli/finalise.js';
import { buildVerifyArgs } from '../../src/finalise/spawn.js';
import { scratchDir } from '../_helpers/scratch.js';

function sink() { return { data: '', write(s) { this.data += s; } }; }

async function scaffoldComplete() {
  const tmp = await scratchDir('rcf-finalise-330-');
  await initProject({ projectRoot: tmp, projectName: 'FinaliseTest' });
  const fbsPath = join(tmp, 'rcf/fbs/fbs-001.json');
  const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
  fbs.executionStatus = 'complete';
  await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  return tmp;
}

const DETECTED = { installed: true, invocation: { command: 'node', prefixArgs: [] } };

test('buildVerifyArgs: --mode threads through to the fresh subprocess argv', () => {
  const args = buildVerifyArgs({
    repo: '/r', url: 'https://app', profile: 'deployed',
    out: '/r/.rcf-verify-report.json', severityGate: 'BROKEN',
    mode: 'deterministic',
  });
  const i = args.indexOf('--mode');
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], 'deterministic');
});
