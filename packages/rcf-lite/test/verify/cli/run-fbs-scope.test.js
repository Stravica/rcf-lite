// ADR-4147 / US-16504 (AC-16504-1): `rcf verify run --fbs <id>` verifies
// exactly the acceptance criteria bound to the named FBS items and the
// report records the scope. Covered in agent mode (stub launcher sees
// only the scoped brief) and in deterministic mode (the skip ledger and
// counts are scoped), plus the unknown-id and zero-AC refusals and the
// MCP tool's fbsIds pass-through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main as runMain } from '../../../src/verify/cli/run.js';
import { createToolRegistry } from '../../../src/verify/mcp/tools.js';
import { renderReport } from '../../../src/verify/report/renderer.js';
import { scaffoldChain } from '../helpers/chain.js';
import { scratchDir } from '../../_helpers/scratch.js';

function capture() {
  const out = { text: '' };
  return { stream: { write: (s) => { out.text += s; } }, out };
}

async function outPath() {
  return join(await scratchDir('rcf-cli-scope-'), 'report.json');
}

function fbsDoc(fbsId, buildOrder, acIds) {
  return {
    fbsId,
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder,
    executionStatus: 'complete',
    title: `${fbsId} fixture`,
    summary: `${fbsId} binds ${acIds.join(', ') || 'nothing'}.`,
    acIds,
    dependsOnFbsIds: [],
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  };
}

// Two FBS items over the scaffold's three ACs: FBS-001 binds the plain
// landing-page AC, FBS-002 binds the auth and payment ACs.
async function scaffoldTwoFbs() {
  return scaffoldChain({
    fbsItems: [
      fbsDoc('FBS-001', 1, ['AC-101-3']),
      fbsDoc('FBS-002', 2, ['AC-101-1', 'AC-101-2']),
    ],
  });
}

// A stub launcher that records the ACs it was briefed on and passes each.
function recordingLauncher(seen) {
  return async ({ brief }) => {
    for (const j of brief.journeys) seen.push(j.acId);
    return {
      findings: brief.journeys.map((j) => ({
        severity: 'PASS', acId: j.acId, journey: j.journey, reproSteps: ['drive'], evidence: { kind: 'note', detail: 'ok' },
      })),
    };
  };
}

test('run --fbs: verifies exactly the ACs bound to the named FBS items and records the scope (agent mode and deterministic mode)', async () => {
  const { root } = await scaffoldTwoFbs();

  // Agent mode, scoped to FBS-002: the brief carries its two ACs only.
  const seen = [];
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out, '--provision-mode', 'skip', '--fbs', 'FBS-002'],
    { stderr: stderr.stream, launchAgent: recordingLauncher(seen) },
  );
  assert.equal(code, 0);
  assert.deepEqual(seen, ['AC-101-1', 'AC-101-2']);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.run.scope, 'fbs:FBS-002');
  assert.equal(report.run.scopeAcCount, 2);
  assert.deepEqual(report.findings.map((f) => f.acId), ['AC-101-1', 'AC-101-2']);
  assert.match(stderr.out.text, /Verify scope: FBS-002/);
  assert.match(stderr.out.text, /\[rcf-verify\] scope fbs:FBS-002 \(2 ACs\)/);
  // The human render states the scope under Runtime provenance.
  assert.match(renderReport(report), /scope: {5}fbs:FBS-002 \(2 ACs\)/);

  // Deterministic mode, scoped to FBS-001: the skip ledger and counts
  // cover its single AC, not the chain's three.
  const out2 = await outPath();
  const code2 = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out2, '--provision-mode', 'skip', '--mode', 'deterministic', '--fbs', 'FBS-001'],
    { stderr: capture().stream, fetchImpl: async () => ({ status: 200, text: async () => '<html>ok</html>' }) },
  );
  assert.equal(code2, 5);
  const report2 = JSON.parse(await readFile(out2, 'utf8'));
  assert.equal(report2.verdict, 'BLOCKED');
  assert.equal(report2.run.scope, 'fbs:FBS-001');
  assert.equal(report2.run.scopeAcCount, 1);
  assert.deepEqual(report2.run.runStats.counts, { total: 1, verified: 0, failed: 0, skipped: 1 });
  assert.deepEqual(report2.blockedAcs.map((b) => b.acId), ['AC-101-3']);

  // Repeated --fbs takes the union; a comma list is the same thing.
  const seen3 = [];
  const out3 = await outPath();
  const code3 = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out3, '--provision-mode', 'skip', '--fbs', 'FBS-001', '--fbs', 'FBS-002'],
    { stderr: capture().stream, launchAgent: recordingLauncher(seen3) },
  );
  assert.equal(code3, 0);
  assert.deepEqual(seen3, ['AC-101-1', 'AC-101-2', 'AC-101-3']);
  const report3 = JSON.parse(await readFile(out3, 'utf8'));
  assert.equal(report3.run.scope, 'fbs:FBS-001,FBS-002');
  assert.equal(report3.run.scopeAcCount, 3);
});

// A launcher that answers only for the ACs named in `answer` (PASS) and
// adds whatever extra findings it is given, in scope or not.
function partialLauncher({ answer, extra = [] }) {
  return async ({ brief }) => ({
    findings: [
      ...brief.journeys
        .filter((j) => answer.includes(j.acId))
        .map((j) => ({ severity: 'PASS', acId: j.acId, journey: j.journey, reproSteps: ['drive'], evidence: { kind: 'note', detail: 'ok' } })),
      ...extra,
    ],
  });
}

test('run --fbs: a scoped AC with no finding is recorded as blocked (noFinding); a finding outside the scope is ignored and noted', async () => {
  const { root } = await scaffoldTwoFbs();

  // FBS-002 scopes AC-101-1 and AC-101-2. The launcher answers for
  // AC-101-1 only and adds a BROKEN finding for AC-101-3 (outside the
  // scope). AC-101-2 lands on blockedAcs with reason noFinding, the
  // out-of-scope finding does not reach the verdict (still PASS), and
  // both facts are on the report.
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out, '--provision-mode', 'skip', '--fbs', 'FBS-002'],
    {
      stderr: stderr.stream,
      launchAgent: partialLauncher({
        answer: ['AC-101-1'],
        extra: [{ severity: 'BROKEN', acId: 'AC-101-3', journey: 'landing', reproSteps: ['load /'], evidence: { kind: 'note', detail: 'out of scope' } }],
      }),
    },
  );
  assert.equal(code, 0);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual(report.findings.map((f) => f.acId), ['AC-101-1']);
  assert.deepEqual(report.blockedAcs.map((b) => b.acId), ['AC-101-2']);
  assert.match(report.blockedAcs[0].reason, /^noFinding:/);
  assert.equal(report.blockedAcs[0].mode, 'agentScreenshotCritique');
  assert.deepEqual(report.run.runStats.coverage, {
    expected: 2, found: 1, missing: ['AC-101-2'], ignored: [{ acId: 'AC-101-3', severity: 'BROKEN' }],
  });
  const rendered = renderReport(report);
  assert.match(rendered, /Blocked ACs \(1\)[\s\S]*AC-101-2: noFinding:/);
  assert.match(rendered, /Ignored findings \(1\), outside the verification scope\n {2}AC-101-3: BROKEN/);

  // The same launcher with every scoped AC answered: no blocked entry, the
  // extra finding is still ignored and the verdict is the same PASS.
  const out2 = await outPath();
  const code2 = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out2, '--provision-mode', 'skip', '--fbs', 'FBS-002'],
    {
      stderr: capture().stream,
      launchAgent: partialLauncher({
        answer: ['AC-101-1', 'AC-101-2'],
        extra: [{ severity: 'BROKEN', acId: 'AC-101-3', journey: 'landing', reproSteps: ['load /'], evidence: { kind: 'note', detail: 'out of scope' } }],
      }),
    },
  );
  assert.equal(code2, 0);
  const report2 = JSON.parse(await readFile(out2, 'utf8'));
  assert.equal(report2.verdict, 'PASS');
  assert.deepEqual(report2.blockedAcs, []);
  assert.deepEqual(report2.findings.map((f) => f.acId), ['AC-101-1', 'AC-101-2']);
  assert.deepEqual(report2.run.runStats.coverage.ignored, [{ acId: 'AC-101-3', severity: 'BROKEN' }]);

  // No findings at all: every scoped AC is blocked, so the verdict is
  // BLOCKED (exit 5), never an empty PASS.
  const out3 = await outPath();
  const code3 = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out3, '--provision-mode', 'skip', '--fbs', 'FBS-002'],
    { stderr: capture().stream, launchAgent: partialLauncher({ answer: [] }) },
  );
  assert.equal(code3, 5);
  const report3 = JSON.parse(await readFile(out3, 'utf8'));
  assert.equal(report3.verdict, 'BLOCKED');
  assert.deepEqual(report3.blockedAcs.map((b) => b.acId), ['AC-101-1', 'AC-101-2']);

  // Deterministic mode runs the same reconciliation: its skip ledger
  // already names every scoped AC, so nothing is added and the coverage
  // record shows the scoped count with nothing found.
  const out4 = await outPath();
  const code4 = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out4, '--provision-mode', 'skip', '--mode', 'deterministic', '--fbs', 'FBS-002'],
    { stderr: capture().stream, fetchImpl: async () => ({ status: 200, text: async () => '<html>ok</html>' }) },
  );
  assert.equal(code4, 5);
  const report4 = JSON.parse(await readFile(out4, 'utf8'));
  assert.deepEqual(report4.blockedAcs.map((b) => b.acId), ['AC-101-1', 'AC-101-2']);
  assert.ok(report4.blockedAcs.every((b) => /critique-only/.test(b.reason)));
  assert.deepEqual(report4.run.runStats.coverage, { expected: 2, found: 0, missing: [], ignored: [] });
});

test('run (no --fbs): the whole chain is verified and the report records scope chain', async () => {
  const { root } = await scaffoldTwoFbs();
  const seen = [];
  const out = await outPath();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out, '--provision-mode', 'skip'],
    { stderr: capture().stream, launchAgent: recordingLauncher(seen) },
  );
  assert.equal(code, 0);
  assert.deepEqual(seen, ['AC-101-1', 'AC-101-2', 'AC-101-3']);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.run.scope, 'chain');
  assert.equal(report.run.scopeAcCount, 3);
});

test('run --fbs: an unknown FBS id refuses with exit 2 and names the id', async () => {
  const { root } = await scaffoldTwoFbs();
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out, '--provision-mode', 'skip', '--fbs', 'FBS-777'],
    { stderr: stderr.stream, launchAgent: recordingLauncher([]) },
  );
  assert.equal(code, 2);
  assert.match(stderr.out.text, /FBS-777/);
  assert.match(stderr.out.text, /not on this chain/);
});

test('run --fbs: an FBS with zero bound ACs cannot be verified (the schema refuses the empty binding at chain load)', async () => {
  // The FBS schema requires at least one bound AC, so an empty acIds
  // list never reaches the scope resolver through the chain reader: the
  // chain fails to load (exit 3) naming the acIds rule. The resolver's
  // own plain-message refusal for an empty binding is covered in
  // test/verify/chain/scope.test.js.
  const { root } = await scaffoldChain({ fbsItems: [fbsDoc('FBS-009', 9, [])] });
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out, '--provision-mode', 'skip', '--fbs', 'FBS-009'],
    { stderr: stderr.stream, launchAgent: recordingLauncher([]) },
  );
  assert.equal(code, 3);
  assert.match(stderr.out.text, /acIds/);
});

test('run --help documents --fbs and the scope the report records', async () => {
  const stdout = capture();
  const code = await runMain(['--help'], { stdout: stdout.stream, stderr: capture().stream });
  assert.equal(code, 0);
  assert.match(stdout.out.text, /--fbs <fbs-id>/);
  assert.match(stdout.out.text, /run\.scope/);
  assert.match(stdout.out.text, /finalise <fbs-id>.*passes its\s+own FBS/s);
});

test('MCP rcf_verify_run: fbsIds narrows the run the same way and the report carries the scope', async () => {
  const { root } = await scaffoldTwoFbs();
  const seen = [];
  const registry = createToolRegistry({ launchAgent: recordingLauncher(seen) });
  const tool = registry.definitions.find((d) => d.name === 'rcf_verify_run');
  assert.equal(tool.inputSchema.properties.fbsIds.type, 'array');
  const result = await registry.call('rcf_verify_run', {
    repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip', fbsIds: ['FBS-001'],
  });
  assert.equal(result.isError, false);
  assert.deepEqual(seen, ['AC-101-3']);
  assert.equal(result.structuredContent.report.run.scope, 'fbs:FBS-001');
  assert.equal(result.structuredContent.report.run.scopeAcCount, 1);

  const bad = await registry.call('rcf_verify_run', {
    repo: root, profile: 'ci', url: 'http://localhost:3000', fbsIds: 'FBS-001',
  });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /fbsIds must be an array/);
});
