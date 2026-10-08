// Issue 330 (2026-10-08): `rcf verify run --mode deterministic` — the
// model-free, in-process verify path a dispatched worker can run.
// Covers: mode validation, happy-path with a reachable URL, counts on
// runStats, blockedAcs populated with critique-only entries, and the
// aggregate verdict is BLOCKED (so finalise refuses promotion).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main as runMain } from '../../../src/verify/cli/run.js';
import { scaffoldChain } from '../helpers/chain.js';

function capture() {
  const out = { text: '' };
  return { stream: { write: (s) => { out.text += s; } }, out };
}

async function outPath() {
  return join(await mkdtemp(join(tmpdir(), 'rcf-cli-')), 'report.json');
}

// Stub fetch that returns a 200 so the deterministic reachability
// probe records httpProbe.ok === true. The deterministic engine
// treats this as diagnostic context, not a per-AC verification claim.
function fetchStub({ status = 200, body = '<html>ok</html>' } = {}) {
  return async () => ({ status, text: async () => body });
}

test('run --mode deterministic: BLOCKED with critique-only blockedAcs on every AC', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out, '--provision-mode', 'skip', '--mode', 'deterministic'],
    { stderr: stderr.stream, fetchImpl: fetchStub() },
  );
  // BLOCKED trips the severity-gate default (BROKEN=4; BLOCKED always
  // trips). Verify exits 5.
  assert.equal(code, 5);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.verdict, 'BLOCKED');
  // mode stamped on runStats
  assert.equal(report.run.runStats.mode, 'deterministic');
  // counts honest: zero verified / zero failed / three skipped (the
  // scaffoldChain fixture has three ACs on US-101)
  assert.equal(report.run.runStats.counts.total, 3);
  assert.equal(report.run.runStats.counts.verified, 0);
  assert.equal(report.run.runStats.counts.failed, 0);
  assert.equal(report.run.runStats.counts.skipped, 3);
  // blockedAcs carries one critique-only entry per AC
  assert.equal(report.blockedAcs.length, 3);
  for (const b of report.blockedAcs) {
    assert.match(b.reason, /critique-only/);
    assert.equal(b.mode, 'deterministic');
  }
  // http probe recorded on runStats
  assert.equal(report.run.runStats.httpProbe.ok, true);
  assert.equal(report.run.runStats.httpProbe.status, 200);
  assert.match(stderr.out.text, /Verify mode: deterministic/);
});

test('run --mode deterministic: still writes a report when the URL is unreachable', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out, '--provision-mode', 'skip', '--mode', 'deterministic'],
    {
      stderr: capture().stream,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    },
  );
  assert.equal(code, 5);
  const report = JSON.parse(await readFile(out, 'utf8'));
  // Unreachable: findings carry BROKEN entries per AC (one per testable
  // AC in the fixture), blockedAcs still carries critique-only entries
  // (both are legitimate — the probe failed AND the ACs are untried).
  assert.equal(report.run.runStats.mode, 'deterministic');
  assert.equal(report.run.runStats.httpProbe.ok, false);
  assert.equal(report.run.runStats.httpProbe.error.kind, 'network');
});

test('run --mode: unknown value is a usage error (exit 2)', async () => {
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(
    ['--repo', '/x', '--profile', 'ci', '--url', 'http://localhost', '--out', out,
      '--mode', 'determinstic'],
    { stderr: stderr.stream },
  );
  assert.equal(code, 2);
  assert.match(stderr.out.text, /--mode must be one of/);
});

test('run (no --mode): defaults to agentScreenshotCritique and still runs through the stub launcher', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const passFinding = {
    severity: 'PASS', acId: 'AC-101-3', journey: 'landing',
    reproSteps: ['load /'], evidence: { kind: 'note', detail: 'ok' },
  };
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out, '--provision-mode', 'skip'],
    {
      stderr: capture().stream,
      launchAgent: async () => ({ findings: [passFinding] }),
    },
  );
  assert.equal(code, 0);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.run.runStats.mode, 'agentScreenshotCritique');
});
