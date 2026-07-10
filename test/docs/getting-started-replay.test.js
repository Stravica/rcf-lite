// Getting-started replay (Phase 8 §6.3). Replays the non-server command
// sequence of docs/getting-started.md in a temp dir, asserting exit
// codes and key output fragments, so the documented journey fails CI if
// the behaviour it narrates drifts (§D9 mechanical layer).
//
// SEQUENCE below mirrors the doc BY HAND (OQ-P8-6: mirrored constant,
// no markdown parsing) and is bound to the doc's numbered sections:
//   s2  = "2. Scaffold a project"
//   s4  = "4. Author the chain"
//   s5  = "5. Validate"
//   s6  = "6. Ask the traceability questions"
//   s7  = "7. Drive the build loop"
// Section 3 (rcf view, long-running server) and section 8 (MCP) are
// excluded from CI replay per §6.4; they are manual-verification duty.
// If you edit the doc's commands, edit SEQUENCE in the same PR.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const bin = resolve(fileURLToPath(new URL('../..', import.meta.url)), 'bin', 'rcf.js');

const project = await mkdtemp(join(tmpdir(), 'rcf-gs-replay-'));

async function rcf(args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd: project, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

const SEQUENCE = {
  s2Init: ['init', '--non-interactive', '--project-name', 'Recipe Box'],
  s4Author: [
    ['update', 'PRD-001', '--set', 'problemStatement=Home cooks lose recipes across bookmarks, screenshots and notes apps.', '--set', 'objectives.0=Keep every recipe in one place and find it again by ingredient.'],
    ['update', 'REQ-001', '--set', 'title=Recipe capture', '--set', 'description=Users can save a recipe with a title, an ingredient list and a method.', '--set', 'domain=capture'],
    ['update', 'US-101', '--set', 'title=Save a recipe', '--set', 'asA=home cook', '--set', 'iWant=to save a recipe with its ingredients and method', '--set', 'soThat=I never lose it again', '--set', 'acceptanceCriteria.0.description=Saving a recipe with a title, at least one ingredient and a method succeeds'],
    ['create', 'req', '--parent', 'PRD-001', '--title', 'Recipe search'],
    ['update', 'REQ-002', '--set', 'description=Users can find saved recipes by ingredient.', '--set', 'domain=search'],
    ['create', 'us', '--parent', 'REQ-002', '--title', 'Find a recipe by ingredient'],
    ['update', 'US-201', '--set', 'asA=home cook', '--set', 'iWant=to search my recipes by ingredient', '--set', 'soThat=I can cook with what I already have', '--set', 'acceptanceCriteria.0.description=Searching for an ingredient lists every recipe that uses it'],
    ['create', 'ac', '--parent', 'US-201', '--description', 'Searching for an ingredient no recipe uses returns an empty list, not an error'],
  ],
  s4Read: ['read', 'US-201'],
  s4ReadField: ['read', 'REQ-002', '--field', 'title'],
  s4Tac: ['update', 'TAC-001', '--set', 'name=Search index', '--set', 'purpose=Maintain the ingredient-to-recipe index that search queries.', '--set', 'responsibilities.0=Index recipes by ingredient on save.'],
  s4Link: ['link', 'US-201', '--tac', 'TAC-001'],
  s4DeleteDryRun: ['delete', 'ADR-001', '--dry-run'],
  s4Delete: ['delete', 'ADR-001'],
  s5Validate: ['validate'],
  s6Coverage: ['coverage'],
  s6TestLayer: [
    ['create', 'ts', '--parent', 'US-201', '--title', 'Ingredient search behaviour', '--purpose', 'Verify ingredient search returns complete and safe results.', '--test-level', 'integration', '--acs', 'AC-201-1,AC-201-2'],
    ['create', 'tc', '--parent', 'TS-001', '--ac', 'AC-201-1', '--slug', 'flour-search', '--description', 'Searching for flour lists every recipe that uses flour'],
    ['create', 'tc', '--parent', 'TS-001', '--ac', 'AC-201-2', '--slug', 'unknown-ingredient', '--description', 'Searching for dragon fruit returns an empty list'],
  ],
  s6CoverageStrict: ['coverage', '--strict'],
  s6TraceBoth: ['trace', 'US-201', '--both'],
  s6TraceBack: ['trace', 'TC-001-flour-search', '--back'],
  s6Impact: ['impact', 'TAC-001'],
  s6CoverageJson: ['coverage', '--format', 'json'],
  s7Queue: [
    ['update', 'FBS-001', '--set', 'title=Save a recipe end to end', '--set', 'summary=Implement recipe capture: the recipe model, storage and the save flow behind AC-101-1.'],
    ['create', 'fbs', '--parent', 'BS-001', '--title', 'Ingredient search', '--acs', 'AC-201-1,AC-201-2'],
    ['update', 'FBS-002', '--set', 'dependsOnFbsIds=["FBS-001"]', '--json'],
  ],
  s7Build: ['build'],
  s7BuildNextOut: ['build', '--next', '--out', 'fbs-001-bundle.md'],
  s7MarkInProgress: ['build', 'FBS-001', '--mark', 'inProgress'],
  s7MarkComplete: ['build', 'FBS-001', '--mark', 'complete', '--no-code-nodes'],
  s7MarkBackward: ['build', 'FBS-001', '--mark', 'inProgress'],
};

test('s2: rcf init scaffolds 9 files (exit 0)', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s2Init);
  assert.equal(code, 0);
  assert.match(stdout, /Scaffolded 9 files under rcf\//);
});

test('s4: the authoring sequence succeeds end to end (exit 0 each)', async () => {
  for (const args of SEQUENCE.s4Author) {
    const { code, stderr } = await rcf(args);
    assert.equal(code, 0, `rcf ${args.join(' ')} failed: ${stderr}`);
  }
});

test('s4: rcf read US-201 prints the authored story with both ACs', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s4Read);
  assert.equal(code, 0);
  const doc = JSON.parse(stdout);
  assert.equal(doc.title, 'Find a recipe by ingredient');
  assert.equal(doc.reqId, 'REQ-002');
  assert.deepEqual(doc.acceptanceCriteria.map((ac) => ac.id), ['AC-201-1', 'AC-201-2']);
});

test('s4: rcf read --field prints the single field', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s4ReadField);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), '"Recipe search"');
});

test('s4: the TAC is authored and the story cross-links to it', async () => {
  assert.equal((await rcf(SEQUENCE.s4Tac)).code, 0);
  const { code, stdout } = await rcf(SEQUENCE.s4Link);
  assert.equal(code, 0);
  assert.match(stdout, /US-201 tacIds updated/);
});

test('s4: delete --dry-run plans, delete removes the placeholder ADR', async () => {
  const dry = await rcf(SEQUENCE.s4DeleteDryRun);
  assert.equal(dry.code, 0);
  assert.match(dry.stdout, /\(dry-run\)/);
  assert.match(dry.stdout, /would delete rcf\/adrs\/adr-001\.json/);
  const real = await rcf(SEQUENCE.s4Delete);
  assert.equal(real.code, 0);
  await assert.rejects(access(join(project, 'rcf', 'adrs', 'adr-001.json')));
});

test('s5: validate is clean (exit 0)', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s5Validate);
  assert.equal(code, 0);
  assert.match(stdout, /tree is clean/);
});

test('s5: a hand-broken reference fails validate with exit 3, restore is clean', async () => {
  const usPath = join(project, 'rcf', 'user-stories', 'us-201.json');
  const original = await readFile(usPath, 'utf8');
  await writeFile(usPath, original.replace('"reqId": "REQ-002"', '"reqId": "REQ-999"'));
  const broken = await rcf(SEQUENCE.s5Validate);
  assert.equal(broken.code, 3);
  assert.match(broken.stderr, /REQ-999/);
  await writeFile(usPath, original);
  assert.equal((await rcf(SEQUENCE.s5Validate)).code, 0);
});

test('s6: coverage reports zero covered before the test layer exists', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6Coverage);
  assert.equal(code, 0);
  assert.match(stdout, /Requirements: 2 {2}covered: 0 {2}uncovered: 2/);
});

test('s6: the TS/TC layer is created (exit 0 each)', async () => {
  for (const args of SEQUENCE.s6TestLayer) {
    const { code, stderr } = await rcf(args);
    assert.equal(code, 0, `rcf ${args.join(' ')} failed: ${stderr}`);
  }
});

test('s6: coverage now reports REQ-002 covered', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6Coverage);
  assert.equal(code, 0);
  assert.match(stdout, /Requirements: 2 {2}covered: 1 {2}uncovered: 1/);
  assert.match(stdout, /TC-001-flour-search/);
});

test('s6: coverage --strict exits 4 while REQ-001 has a gap', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6CoverageStrict);
  assert.equal(code, 4);
  assert.match(stdout, /strict \(per-AC\)/);
});

test('s6: trace --both walks ancestors and descendants around the story', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6TraceBoth);
  assert.equal(code, 0);
  assert.match(stdout, /Trace pivot: US-201 {2}direction: both/);
  assert.match(stdout, /REQ-002/);
  assert.match(stdout, /TC-001-unknown-ingredient/);
});

test('s6: trace --back climbs from a test case to the PRD', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6TraceBack);
  assert.equal(code, 0);
  assert.match(stdout, /PRD-001/);
});

test('s6: impact labels the fan-out from the TAC', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6Impact);
  assert.equal(code, 0);
  assert.match(stdout, /review-arch/);
  assert.match(stdout, /re-run/);
});

test('s6: coverage --format json is machine-readable and agrees with the table', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6CoverageJson);
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.totals.requirements, 2);
  assert.equal(report.totals.covered, 1);
});

test('s7: the queue is authored: FBS-002 depends on FBS-001 (exit 0 each)', async () => {
  for (const args of SEQUENCE.s7Queue) {
    const { code, stderr } = await rcf(args);
    assert.equal(code, 0, `rcf ${args.join(' ')} failed: ${stderr}`);
  }
});

test('s7: the queue overview shows FBS-002 blocked by FBS-001', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s7Build);
  assert.equal(code, 0);
  assert.match(stdout, /\| 2 \| FBS-002 \| Ingredient search \| notStarted \| blocked \| FBS-001 \|/);
  assert.match(stdout, /Next actionable: FBS-001/);
});

test('s7: build --next --out sinks the FBS-001 bundle to a file', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s7BuildNextOut);
  assert.equal(code, 0);
  assert.match(stdout, /bundle written to fbs-001-bundle\.md/);
  const bundle = await readFile(join(project, 'fbs-001-bundle.md'), 'utf8');
  assert.match(bundle, /^# Spec bundle: FBS-001 - Save a recipe end to end/);
});

test('s7: forward marks land; completing FBS-001 unblocks FBS-002', async () => {
  assert.match((await rcf(SEQUENCE.s7MarkInProgress)).stdout, /marked FBS-001 notStarted -> inProgress/);
  assert.match((await rcf(SEQUENCE.s7MarkComplete)).stdout, /marked FBS-001 inProgress -> complete/);
  const { stdout } = await rcf(SEQUENCE.s7Build);
  assert.match(stdout, /Next actionable: FBS-002/);
});

test('s7: a backward mark is refused with exit 4', async () => {
  const { code, stderr } = await rcf(SEQUENCE.s7MarkBackward);
  assert.equal(code, 4);
  assert.match(stderr, /refusing backward transition complete -> inProgress/);
});
