// Launcher tests (spec §7.3, §9, §11): the isolation env + scoped network
// tool surface + provisioned Playwright MCP are applied to the launch config,
// the launcher-resolution precedence (injected > env module > default spawn)
// holds, and the two-layer output ingestion is proven against the REAL
// captured agent transcripts from the 2026-07-21 shakedown (d-023).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildLaunchConfig,
  resolveLauncher,
  LAUNCHER_ENV,
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_MCP_CONFIG,
  extractFindingsObject,
  extractRunStats,
  parseAgentOutput,
} from '../../src/engine/launcher.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const readFixture = (name) => readFile(join(FIXTURES, name), 'utf8');

/** Pull a specific flag's value out of the assembled argv (the token after the flag). */
function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

test('buildLaunchConfig: stamps the §7.3 isolation env (both flags) onto the child env', () => {
  const cfg = buildLaunchConfig({ brief: { stance: 'disprove' }, url: 'https://app' }, { baseEnv: { PATH: '/usr/bin' } });
  assert.equal(cfg.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.equal(cfg.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(cfg.env.PATH, '/usr/bin'); // base preserved
  assert.deepEqual(cfg.isolation, { autoMemory: false, nonEssentialTraffic: false });
});

test('buildLaunchConfig: recipe wins over a leaked parent value (isolation cannot be re-enabled)', () => {
  const cfg = buildLaunchConfig({ brief: {}, url: 'https://app' }, { baseEnv: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' } });
  assert.equal(cfg.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
});

test('buildLaunchConfig: command defaults to claude, overridable for other harnesses', () => {
  assert.equal(buildLaunchConfig({ brief: {}, url: 'x' }).command, 'claude');
  assert.equal(buildLaunchConfig({ brief: {}, url: 'x' }, { command: 'my-agent' }).command, 'my-agent');
});

test('buildLaunchConfig: uses --output-format json for robust ingestion + runStats (fix 2/5)', () => {
  const { args } = buildLaunchConfig({ brief: {}, url: 'https://app' });
  assert.ok(args.includes('--print'));
  assert.equal(argValue(args, '--output-format'), 'json');
});

test('buildLaunchConfig: grants the SCOPED network tool surface, not --dangerously-skip-permissions (fix 1)', () => {
  const { args } = buildLaunchConfig({ brief: {}, url: 'https://app' });
  assert.ok(!args.includes('--dangerously-skip-permissions'), 'scoped allowlisting, never skip-permissions');
  assert.ok(!args.includes('--permission-mode'), 'acceptEdits mode replaced by scoped allowedTools');
  const allowed = argValue(args, '--allowedTools');
  assert.ok(allowed.includes('mcp__playwright'), 'Playwright browser family granted');
  assert.ok(allowed.includes('WebFetch'), 'WebFetch granted');
  assert.ok(/Bash\(curl/.test(allowed), 'curl Bash surface granted');
});

test('buildLaunchConfig: provisions the Playwright MCP server explicitly + strictly (no ambient user config, fix 1)', () => {
  const { args } = buildLaunchConfig({ brief: {}, url: 'https://app' });
  assert.ok(args.includes('--strict-mcp-config'), 'ignore ambient user MCP config');
  const cfg = JSON.parse(argValue(args, '--mcp-config'));
  assert.ok(cfg.mcpServers.playwright, 'playwright server provisioned by value');
  assert.equal(cfg.mcpServers.playwright.type, 'stdio');
});

test('buildLaunchConfig: allowedTools + mcpConfig are overridable via deps (harness-agnostic)', () => {
  const { args } = buildLaunchConfig({ brief: {}, url: 'x' }, {
    allowedTools: ['WebFetch'],
    mcpConfig: { mcpServers: { custom: { type: 'stdio', command: 'x', args: [] } } },
  });
  assert.equal(argValue(args, '--allowedTools'), 'WebFetch');
  assert.ok(JSON.parse(argValue(args, '--mcp-config')).mcpServers.custom);
});

test('DEFAULT_ALLOWED_TOOLS / DEFAULT_MCP_CONFIG are frozen (shared recipe cannot be mutated)', () => {
  assert.ok(Object.isFrozen(DEFAULT_ALLOWED_TOOLS));
  assert.ok(Object.isFrozen(DEFAULT_MCP_CONFIG));
});

// --- Output ingestion: the empirically-broken whole-stdout JSON.parse (fix 2) ---

test('extractFindingsObject: pulls the balanced {"findings"} object out of prose-prepended text', () => {
  const text = 'Here is my analysis. Blah {curly} braces in prose.\n{"findings":[{"acId":"AC-1","note":"a } brace in a string"}]}';
  const js = extractFindingsObject(text);
  assert.ok(js);
  const obj = JSON.parse(js);
  assert.equal(obj.findings[0].acId, 'AC-1');
});

test('extractFindingsObject: takes the LAST findings object and handles nested braces', () => {
  const text = '{"findings":[]} then later {"findings":[{"acId":"AC-9","evidence":{"kind":"note","detail":"x"}}]}';
  const obj = JSON.parse(extractFindingsObject(text));
  assert.equal(obj.findings[0].acId, 'AC-9');
});

test('extractFindingsObject: returns null when there is no findings object', () => {
  assert.equal(extractFindingsObject('just prose, no json here'), null);
  assert.equal(extractFindingsObject(''), null);
});

test('extractRunStats: maps the result-envelope usage/timing to camelCase, omit-not-fake', () => {
  const stats = extractRunStats({ duration_ms: 1234, num_turns: 3, total_cost_usd: 0.05, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 } });
  assert.equal(stats.durationMs, 1234);
  assert.equal(stats.numTurns, 3);
  assert.equal(stats.totalCostUsd, 0.05);
  assert.deepEqual(stats.tokens, { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 5 });
  assert.equal(extractRunStats({}), null); // nothing present -> null, not a faked zero
  assert.equal(extractRunStats(null), null);
});

test('parseAgentOutput: the OLD whole-stdout JSON.parse is empirically broken — proven by the real GOOD transcript', async () => {
  const raw = await readFixture('agent-output-good-prose-prepended.txt');
  // The pre-fix launcher did JSON.parse(out) on this exact stdout and threw:
  assert.throws(() => JSON.parse(raw));
  // The two-layer parser ingests it anyway (Layer B on raw text, no envelope):
  const res = parseAgentOutput(raw);
  assert.equal(res.ok, true);
  assert.equal(res.findings.length, 3);
  assert.ok(res.findings.every((f) => f.severity === 'PASS'));
  assert.equal(res.runStats, null); // raw text mode carries no envelope stats
});

test('parseAgentOutput: real BROKEN transcript -> BROKEN findings ingested (Layer B)', async () => {
  const raw = await readFixture('agent-output-broken-prose-prepended.txt');
  const res = parseAgentOutput(raw);
  assert.equal(res.ok, true);
  assert.equal(res.findings.length, 3);
  assert.equal(res.findings.filter((f) => f.severity === 'BROKEN').length, 2);
});

test('parseAgentOutput: Layer A — a --output-format json envelope wrapping prose+findings, with runStats', async () => {
  const inner = await readFixture('agent-output-good-prose-prepended.txt');
  const envelope = JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: inner,
    duration_ms: 9000, num_turns: 4, total_cost_usd: 0.12,
    usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
  });
  const res = parseAgentOutput(envelope);
  assert.equal(res.ok, true);
  assert.equal(res.findings.length, 3);
  assert.equal(res.runStats.durationMs, 9000);
  assert.equal(res.runStats.tokens.outputTokens, 200);
});

test('parseAgentOutput: clean envelope whose result is pure JSON also ingests', () => {
  const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: '{"findings":[{"acId":"AC-1"}]}' });
  const res = parseAgentOutput(envelope);
  assert.equal(res.ok, true);
  assert.equal(res.findings[0].acId, 'AC-1');
});

test('parseAgentOutput: un-ingestible output -> ok:false with a reason (never a fabricated pass, §9)', () => {
  assert.equal(parseAgentOutput('I could not reach the network, blocked.').ok, false);
  assert.equal(parseAgentOutput('').ok, false);
  // Envelope present but no findings object anywhere:
  const env = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'gave up' });
  const res = parseAgentOutput(env);
  assert.equal(res.ok, false);
  assert.match(res.reason, /error_max_turns/);
});

test('resolveLauncher: an injected launchAgent takes precedence', async () => {
  const injected = async () => ({ findings: [] });
  const fn = await resolveLauncher({ launchAgent: injected });
  assert.equal(fn, injected);
});

test('resolveLauncher: RCF_VERIFY_LAUNCHER module is used when no injection', async () => {
  const prev = process.env[LAUNCHER_ENV];
  try {
    // A data: URL module exporting launchAgent — no temp file needed.
    process.env[LAUNCHER_ENV] = 'data:text/javascript,export async function launchAgent(){return {findings:[]}}';
    const fn = await resolveLauncher({});
    const out = await fn({ brief: {}, url: 'x' });
    assert.deepEqual(out, { findings: [] });
  } finally {
    if (prev === undefined) delete process.env[LAUNCHER_ENV]; else process.env[LAUNCHER_ENV] = prev;
  }
});
