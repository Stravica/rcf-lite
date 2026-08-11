// CLI `report` verb + top-level bin dispatch tests (spec §3, §10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main as reportMain } from '../../src/cli/report.js';
import { main as binMain } from '../../bin/rcf-verify.js';
import { buildReport, serialiseReport } from '../../src/report/index.js';

function capture() {
  const out = { text: '' };
  return { stream: { write: (s) => { out.text += s; } }, out };
}

async function writeSampleReport() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-report-'));
  const path = join(dir, 'report.json');
  const report = buildReport({
    profile: 'deployed', url: 'https://app', parityEnv: false, reachability: { reachable: true, looksLocal: false },
    chainRef: 'PRD-001', verdict: 'BROKEN', verdictAuthority: 'ship',
    findings: [{ severity: 'BROKEN', acId: 'AC-101-1', journey: 'sign-in', reproSteps: ['500'], evidence: { detail: 'auth 500' } }],
    blockedAcs: [], provisioning: null,
  });
  await writeFile(path, serialiseReport(report), 'utf8');
  return path;
}

test('report: renders a prior report artifact to human text', async () => {
  const path = await writeSampleReport();
  const stdout = capture();
  const code = await reportMain([path], { stdout: stdout.stream });
  assert.equal(code, 0);
  assert.match(stdout.out.text, /Verdict:\s+BROKEN/);
  assert.match(stdout.out.text, /AC-101-1/);
});

test('report: --json re-emits the parsed artifact', async () => {
  const path = await writeSampleReport();
  const stdout = capture();
  const code = await reportMain([path, '--json'], { stdout: stdout.stream });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout.out.text).verdict, 'BROKEN');
});

test('report: no path is a usage error (exit 2)', async () => {
  const code = await reportMain([], { stdout: capture().stream, stderr: capture().stream });
  assert.equal(code, 2);
});

test('report: an unreadable path exits 3', async () => {
  const code = await reportMain(['/no/such/report.json'], { stdout: capture().stream, stderr: capture().stream });
  assert.equal(code, 3);
});

test('bin: no args prints top-level help (exit 0)', async () => {
  const stdout = capture();
  const code = await binMain([], { stdout: stdout.stream });
  assert.equal(code, 0);
  assert.match(stdout.out.text, /Usage: rcf-verify <command>/);
});

test('bin: --version prints the package version', async () => {
  const stdout = capture();
  const code = await binMain(['--version'], { stdout: stdout.stream });
  assert.equal(code, 0);
  assert.match(stdout.out.text, /rcf-verify \d+\.\d+\.\d+/);
});

test('bin: unknown subcommand exits 2', async () => {
  const code = await binMain(['frobnicate'], { stdout: capture().stream, stderr: capture().stream });
  assert.equal(code, 2);
});

test('bin: dispatches to a real subcommand (help report)', async () => {
  const stdout = capture();
  const code = await binMain(['help', 'report'], { stdout: stdout.stream });
  assert.equal(code, 0);
  assert.match(stdout.out.text, /Usage: rcf-verify report/);
});
