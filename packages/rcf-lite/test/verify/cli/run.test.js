// CLI `run` tests (spec §3, §8.2, §10, §11): arg parsing, mandatory flags, the
// --provision dash-footgun, exit-code behaviour under --severity-gate, and the
// report-always-written rule. The verifier agent is stubbed via deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main as runMain } from '../../../src/verify/cli/run.js';
import { scaffoldChain, stubLauncher } from '../helpers/chain.js';
import { scratchDir } from '../../_helpers/scratch.js';

function capture() {
  const out = { text: '' };
  return { stream: { write: (s) => { out.text += s; } }, out };
}

const brokenFinding = { severity: 'BROKEN', acId: 'AC-101-1', journey: 'sign-in', reproSteps: ['500'], evidence: { kind: 'runtimeError', detail: 'auth 500' } };
const passFinding = { severity: 'PASS', acId: 'AC-101-3', journey: 'landing', reproSteps: ['load /'], evidence: { kind: 'note', detail: 'ok' } };

async function outPath() {
  return join(await scratchDir('rcf-cli-'), 'report.json');
}

test('run: --help exits 0 and prints usage', async () => {
  const stdout = capture();
  const code = await runMain(['--help'], { stdout: stdout.stream });
  assert.equal(code, 0);
  assert.match(stdout.out.text, /Usage: rcf verify run/);
});

// Issue #353: `--provision-mode skip` is critical for chains whose
// prerequisites are admin-seeded / out-of-band (Dex's first run blocked
// 68 ACs for lack of this). The help text must describe the modes and
// name the audit-trail disclosure so a reader knows the flag exists and
// what it commits them to.
test('run: --help describes --provision-mode skip and names the audit-trail disclosure (#353)', async () => {
  const stdout = capture();
  const code = await runMain(['--help'], { stdout: stdout.stream });
  assert.equal(code, 0);
  const help = stdout.out.text;
  assert.match(help, /--provision-mode/);
  assert.match(help, /skip\s+bypass/);
  assert.match(help, /admin-seeded/);
  assert.match(help, /report\.provisioning\.mode/);
});

// Issue #353: the mode lands on report.provisioning.mode as an audit-trail
// disclosure so a promoted tree records that provisioning was skipped
// rather than satisfied. Without this, a seeded tree and a verified tree
// are indistinguishable in the ingested report.
test('run: --provision-mode skip stamps provisioning.mode on the written report (#353)', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000',
      '--out', out, '--provision-mode', 'skip'],
    { stderr: capture().stream, launchAgent: stubLauncher([passFinding]) },
  );
  assert.equal(code, 0);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.provisioning.mode, 'skip');
});

test('run: default (run mode) also stamps provisioning.mode so the audit trail is unambiguous (#353)', async () => {
  // The default scaffold's AC-101-1 is an auth journey. In `run` mode, with
  // no injected signup route, it gets BLOCKED: exactly the shape Dex's
  // first run hit. The mode disclosure must still land on the report.
  const { root } = await scaffoldChain();
  const out = await outPath();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000', '--out', out],
    { stderr: capture().stream, launchAgent: stubLauncher([passFinding]) },
  );
  // Exit 5 is expected: an auth AC is BLOCKED under default `run` mode.
  // The code is incidental to this test; the audit-trail disclosure is
  // the lock.
  assert.ok([0, 5].includes(code), `unexpected exit ${code}`);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.provisioning.mode, 'run');
});

test('run: missing --out is a usage error (exit 2)', async () => {
  const { root } = await scaffoldChain();
  const stderr = capture();
  const code = await runMain(['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000'], { stderr: stderr.stream });
  assert.equal(code, 2);
  assert.match(stderr.out.text, /--out/);
});

test('run: missing --profile is a usage error (exit 2)', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(['--repo', root, '--url', 'http://localhost:3000', '--out', out], { stderr: stderr.stream, launchAgent: stubLauncher([]) });
  assert.equal(code, 2);
});

test('run: invalid --severity-gate is a usage error (exit 2)', async () => {
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(['--repo', '/x', '--profile', 'ci', '--url', 'http://localhost', '--out', out, '--severity-gate', 'FATAL'], { stderr: stderr.stream });
  assert.equal(code, 2);
  assert.match(stderr.out.text, /severity-gate/);
});

test('run: invalid --provision-mode is a usage error (exit 2)', async () => {
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(['--repo', '/x', '--profile', 'ci', '--url', 'http://localhost', '--out', out, '--provision-mode', 'maybe'], { stderr: stderr.stream });
  assert.equal(code, 2);
});

test('run: --provision followed by a flag is refused by the parser (exit 2)', async () => {
  const out = await outPath();
  const stderr = capture();
  // node parseArgs itself refuses `--provision --url` as ambiguous (would
  // swallow the next flag as the value) — the first line of dash-footgun defence.
  const code = await runMain(['--repo', '/x', '--profile', 'ci', '--url', 'http://localhost', '--out', out, '--provision', '--url'], { stderr: stderr.stream });
  assert.equal(code, 2);
});

test('run: --provision=-inline dash-footgun refused by our guard (file path only, no inline creds)', async () => {
  const out = await outPath();
  const stderr = capture();
  // The `=` form parses, so our own guard must catch a flag/inline-looking value.
  const code = await runMain(['--repo', '/x', '--profile', 'ci', '--url', 'http://localhost', '--out', out, '--provision=-secret-token'], { stderr: stderr.stream });
  assert.equal(code, 2);
  assert.match(stderr.out.text, /file path/);
});

test('run: chain load failure exits 3', async () => {
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(['--repo', '/no/such/chain', '--profile', 'ci', '--url', 'http://localhost:3000', '--out', out], { stderr: stderr.stream, launchAgent: stubLauncher([]) });
  assert.equal(code, 3);
});

test('run: PASS below gate exits 0 and writes the report', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000', '--out', out, '--severity-gate', 'BROKEN', '--provision-mode', 'skip'],
    { stderr: capture().stream, launchAgent: stubLauncher([passFinding]) },
  );
  assert.equal(code, 0);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.verdict, 'PASS');
});

test('run: BROKEN at/above the gate exits 5, report still written', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000', '--out', out, '--severity-gate', 'BROKEN', '--provision-mode', 'skip'],
    { stderr: capture().stream, launchAgent: stubLauncher([brokenFinding]) },
  );
  assert.equal(code, 5);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.verdict, 'BROKEN');
});

test('run: no gate -> BROKEN still exits 0 (gate controls exit only), report written', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000', '--out', out, '--provision-mode', 'skip'],
    { stderr: capture().stream, launchAgent: stubLauncher([brokenFinding]) },
  );
  assert.equal(code, 0);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).verdict, 'BROKEN');
});

test('run: deployed + local URL exits 5 (NOT-DEPLOYED, never a soft pass), report written', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const code = await runMain(
    ['--repo', root, '--profile', 'deployed', '--url', 'http://localhost:8787', '--out', out],
    { stderr: capture().stream, launchAgent: stubLauncher([passFinding]) },
  );
  assert.equal(code, 5);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).verdict, 'NOT-DEPLOYED');
});

/* ------------------------------------------------------------------ */
/* Section 1 (spec 2026-09-03): pinned Playwright MCP + override.     */
/* ------------------------------------------------------------------ */

test('run: preflight prints the pinned Playwright MCP version to stderr', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000', '--out', out],
    { stderr: stderr.stream, launchAgent: stubLauncher([passFinding]) },
  );
  assert.equal(code, 0);
  assert.match(stderr.out.text, /^Playwright MCP: pinned to @playwright\/mcp@\d+\.\d+\.\d+$/m);
});

test('run: --playwright-mcp-version fires the loud override notice AND lands on the report', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000', '--out', out,
      '--playwright-mcp-version', '0.0.99'],
    { stderr: stderr.stream, launchAgent: stubLauncher([passFinding]) },
  );
  assert.equal(code, 0);
  assert.match(stderr.out.text, /^Playwright MCP: OVERRIDE @playwright\/mcp@0\.0\.99 \(pinned default: \d+\.\d+\.\d+\)$/m);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.run.runStats.playwrightMcpVersion, '0.0.99');
});

test('run: default pin lands on the report as runStats.playwrightMcpVersion even with no override', async () => {
  const { root } = await scaffoldChain();
  const out = await outPath();
  const stderr = capture();
  await runMain(
    ['--repo', root, '--profile', 'ci', '--url', 'http://localhost:3000', '--out', out],
    { stderr: stderr.stream, launchAgent: stubLauncher([passFinding]) },
  );
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.match(report.run.runStats.playwrightMcpVersion, /^\d+\.\d+\.\d+$/);
});

test('run: --playwright-mcp-version with a non-semver value refuses exit 2 with the spec-named message', async () => {
  const out = await outPath();
  const stderr = capture();
  const code = await runMain(
    ['--repo', '/x', '--profile', 'ci', '--url', 'http://localhost', '--out', out,
      '--playwright-mcp-version', 'notasemver'],
    { stderr: stderr.stream },
  );
  assert.equal(code, 2);
  assert.match(
    stderr.out.text,
    /--playwright-mcp-version expects a semver string, got 'notasemver'/,
  );
});
