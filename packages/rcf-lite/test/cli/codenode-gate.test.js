// Phase 10 (X2 CodeNode bridge, D17, operator ruling 2026-07-10) CLI-level
// tests: `rcf build <fbs-id> --mark complete` refuses without CN coverage;
// `--no-code-nodes` declares the exemption on the FBS; the declaration is
// sticky (marking again later does not re-trigger the gate).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';
import { declareUiNoneForTests } from '../_helpers/d0.js';
import { scratchDir } from '../_helpers/scratch.js';
import { rcf as harnessRcf, lines } from '../_harness/spawn.js';
import { commit, git as harnessGit, initRepo } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, testStrengthReport, testVerdict, verdictPath, writeText } from '../_harness/fixture.js';

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

async function scaffold(name) {
  const tmp = await scratchDir(`rcf-gate-cli-${name}-`);
  await initProject({ projectRoot: tmp, projectName: 'GateTest' });
  await declareUiNoneForTests(tmp);
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(join(tmp, 'src', 'save.js'), 'export function save() {}\n', 'utf8');
  // Scaffold FBS-001 delivers AC-101-1 (initProject wires acIds:['AC-101-1']).
  return tmp;
}

// The Code Node gate through rcf build finalise (the stage-keeper's ruling
// RC-32 on the round C DEFINE): rcf build mark <fbs-id> complete is refused
// after FBS-237 (AC-20003-3), and the light Finalise checks "Code Nodes
// for every touched criterion" (TAC-4156; AC-20002-3's exit 3 "finalise
// refused: missing Code Node for <ids>"). The round is recorded by verdicts
// on a branch: DEFINE: (FBS-001 notStarted -> inProgress), BUILD: (H,
// src/x.js and, with cn, a Code Node for AC-101-1), REVIEW: MERGE/PASS at
// H touching AC-101-1 and TEST: PASS with a passing test-strength record
// at H. The --no-code-nodes declaration tests left with the mark-complete
// gate (RC-32: the light Finalise's Code Node check names no declaration).
const CN_001 = {
  cnId: 'CN-001', path: 'src/x.js#first', title: 'fixture node for AC-101-1', description: 'Fixture Code Node implementing AC-101-1.',
  implementsAcIds: ['AC-101-1'], dependencies: [], version: '0.1.0', status: 'draft', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

async function lightRound(t, { cn }) {
  const dir = await project(t, { name: 'gate' });
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria = [criterion('AC-101-1', '[happy] first behaviour holds', { given: 'a fixture project', when: 'the fixture runs', then: 'first behaviour holds', verification: 'external' })];
  });
  editFbs(dir, 'FBS-001', (f) => ({ ...f, acIds: ['AC-101-1'], executionStatus: 'notStarted' }));
  bindTests(dir, [{ acId: 'AC-101-1', pointer: 'test/rcf/a.test.js::first behaviour holds' }]);
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base chain');
  harnessGit(dir, 'switch', '-q', '-c', 'feature');
  editFbs(dir, 'FBS-001', (f) => ({ ...f, executionStatus: 'inProgress', summary: `${f.summary} Round opened.` }));
  commit(dir, 'DEFINE: round');
  const H = commit(dir, 'BUILD: code', { 'src/x.js': 'export function first() { return 1; }\n', ...(cn ? { 'rcf/code-nodes/cn-001.json': CN_001 } : {}) });
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H) });
  commit(dir, 'TEST: verdict', { [verdictPath(H, 'test.json')]: testVerdict(H), [verdictPath(H, 'test-strength.json')]: testStrengthReport(H) });
  return dir;
}

test('rcf build finalise is refused (exit 3, missing Code Node) when the touched AC has no CN', async (t) => {
  const tmp = await lightRound(t, { cn: false });
  const before = readText(tmp, 'rcf/fbs/fbs-001.json');
  const { code, stdout, stderr } = await harnessRcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7'], { cwd: tmp });
  assert.equal(code, 3, `${stdout}${stderr}`);
  assert.ok(lines(stderr).includes('finalise refused: missing Code Node for AC-101-1'), `stderr names the gate and AC-101-1\n${stderr}`);
  assert.equal(readText(tmp, 'rcf/fbs/fbs-001.json'), before, 'FBS-001 is byte-identical');
});

test('rcf build finalise succeeds once the touched AC has a CN', async (t) => {
  const tmp = await lightRound(t, { cn: true });
  const { code, stdout, stderr } = await harnessRcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7'], { cwd: tmp });
  assert.equal(code, 0, `${stdout}${stderr}`);
  assert.match(stdout, /finalise: FBS-001 complete at [0-9a-f]{7} \(reviewed [0-9a-f]{7}, ci run-7, touched 1 criteria\)/);
  assert.equal(readJson(tmp, 'rcf/fbs/fbs-001.json').executionStatus, 'complete');
});

test('--no-code-nodes only combines with .build mark (exit 2 otherwise)', async () => {
  const tmp = await scaffold('flag-conflict');
  const { code, stderr } = await runBin(tmp, ['build', 'mark', 'FBS-001', 'inProgress', '--no-code-nodes']);
  assert.equal(code, 2);
  assert.match(stderr, /--no-code-nodes only combines with .build mark/);
});

// RC-37 and RC-48 (F-22): rcf build finalise keeps parsing --no-code-nodes;
// it is not on AC-20003-1's retired list. Over the world of the test
// above that writes complete, so the outcome does not turn on what the
// flag does beyond the parse.
test('rcf build finalise parses --no-code-nodes: no usage error, and the light round with a CN still writes complete', async (t) => {
  const tmp = await lightRound(t, { cn: true });
  const { code, stdout, stderr } = await harnessRcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7', '--no-code-nodes'], { cwd: tmp });
  assert.ok(!lines(stderr).some((l) => l.startsWith('[error] usage')), `rcf build finalise parses --no-code-nodes\nexit ${code}\n${stderr}`);
  assert.equal(code, 0, `${stdout}${stderr}`);
  assert.match(stdout, /finalise: FBS-001 complete at [0-9a-f]{7} \(reviewed [0-9a-f]{7}, ci run-7, touched 1 criteria\)/);
  assert.equal(readJson(tmp, 'rcf/fbs/fbs-001.json').executionStatus, 'complete');
});

test('rcf coverage --with-code reports the four classes and never blocks', async () => {
  const tmp = await scaffold('coverage');
  // Two AC creates: the first replaces the seeded phantom in place at
  // AC-101-1 (0.13.0 G5), the second appends at AC-101-2 so the test
  // exercises both `implemented-uncovered` (AC-101-1 with a Code Node)
  // and `unimplemented` (AC-101-2 without one).
  await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--description', 'First acceptance criterion']);
  await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--description', 'A second acceptance criterion']);
  await runBin(tmp, ['define', 'create', 'cn', '--path', 'src/save.js#save', '--acs', 'AC-101-1']);
  await runBin(tmp, ['define', 'create', 'cn', '--path', 'src/orphan.js']);
  // REQ-164 (strict-by-default): exercise the --with-code shape on an
  // uncovered scaffold via --mode shallow-any so the strict gate's
  // exit-4 does not mask the assertion body.
  const { code, stdout } = await runBin(tmp, ['audit', 'coverage', '--mode', 'shallow-any', '--with-code', '--format', 'json']);
  assert.equal(code, 0, stdout);
  const body = JSON.parse(stdout);
  assert.equal(body.withCode, true);
  const ac1 = body.requirements.flatMap((r) => r.acs).find((a) => a.id === 'AC-101-1');
  assert.equal(ac1.codeClass, 'implemented-uncovered');
  const ac2 = body.requirements.flatMap((r) => r.acs).find((a) => a.id === 'AC-101-2');
  assert.equal(ac2.codeClass, 'unimplemented');
  assert.deepEqual(body.codeNodeOrphans, ['CN-002']);
});
