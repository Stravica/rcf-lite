// Verifier-agent launcher (spec §5, §7.3, §9). Verify does NOT hand-code
// browser scripts; it launches a fresh, isolated agent (Claude Code by
// default) configured with browser tooling (Playwright) and the §7.3
// isolation env, and that agent drives the running app and returns structured
// findings. This keeps verify harness-agnostic.
//
// Shared-parent-state caution (§9): the launched agent MUST get its OWN
// isolated browser context. We provision the Playwright MCP server explicitly
// via --mcp-config + --strict-mcp-config so the launcher does NOT inherit the
// operator's ambient user-level MCP config (which may be absent on a fresh
// machine, or may leak the parent's shared browser/OAuth session). The spawned
// agent gets exactly the tool surface it needs — scoped via --allowedTools —
// and nothing more (no --dangerously-skip-permissions).

import { isolationEnv, isolationProvenance } from '@stravica-ai/rcf-lite-core/isolation';

/** Env var naming a module (exporting `launchAgent`) to use instead of the default spawn launcher. The integration + manual-e2e seam. */
export const LAUNCHER_ENV = 'RCF_VERIFY_LAUNCHER';

/**
 * The minimal, SCOPED tool surface the verifier agent needs to drive a live
 * app and collect runtime evidence (spec §9 method). Deliberately narrow —
 * NOT --dangerously-skip-permissions. The Playwright browser family (provided
 * by the explicitly-provisioned MCP server below), WebFetch, and a curl/grep
 * Bash surface for raw HTTP probing cover the empirically-observed method.
 * `mcp__playwright` grants every tool exported by the provisioned `playwright`
 * server.
 */
export const DEFAULT_ALLOWED_TOOLS = Object.freeze([
  'mcp__playwright',
  'WebFetch',
  'Bash(curl:*)',
  'Bash(grep:*)',
]);

/**
 * Explicit Playwright MCP provisioning for the spawned agent. Provisioned by
 * value (not by reference to ambient user config) so the launcher works on a
 * machine with no user-level MCP setup, and so the agent gets its OWN browser
 * context (§9). Server name `playwright` -> tool prefix `mcp__playwright__*`.
 * `npx` is resolved off PATH for portability (no machine-specific absolute).
 */
export const DEFAULT_MCP_CONFIG = Object.freeze({
  mcpServers: {
    playwright: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: {},
    },
  },
});

/**
 * Build the child-process launch configuration for the verifier agent. Pure
 * and testable: asserts the §7.3 isolation env is applied, the agent is pointed
 * at the brief + live URL, the network-capable tool surface is scoped, and the
 * Playwright MCP server is provisioned explicitly. The command defaults to
 * Claude Code headless; callers may override via deps for other harnesses.
 *
 * @param {object} opts
 * @param {object} opts.brief - the composed adversarial brief
 * @param {string} opts.url
 * @param {object} [deps]
 * @param {string} [deps.command] - the agent CLI (default: 'claude')
 * @param {Record<string,string|undefined>} [deps.baseEnv]
 * @param {string[]} [deps.allowedTools] - override the scoped tool surface
 * @param {object} [deps.mcpConfig] - override the provisioned MCP servers
 * @returns {{ command: string, args: string[], env: Record<string,string|undefined>, isolation: {autoMemory: boolean, nonEssentialTraffic: boolean}, briefUrl: string, brief: object }}
 */
export function buildLaunchConfig({ brief, url }, deps = {}) {
  const command = deps.command ?? 'claude';
  const env = isolationEnv(deps.baseEnv ?? process.env);
  const allowedTools = deps.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  const mcpConfig = deps.mcpConfig ?? DEFAULT_MCP_CONFIG;
  // The brief is passed to the agent over stdin by the concrete launcher; here
  // we assemble the invariant config. --output-format json wraps the agent's
  // reply in a result envelope (robust ingestion + runStats, see parseAgentOutput);
  // --allowedTools scopes the network-capable surface; --mcp-config +
  // --strict-mcp-config provision Playwright without touching ambient user config.
  const args = [
    '--print',
    '--output-format', 'json',
    '--allowedTools', allowedTools.join(','),
    '--mcp-config', JSON.stringify(mcpConfig),
    '--strict-mcp-config',
  ];
  return { command, args, env, isolation: isolationProvenance(), briefUrl: url, brief };
}

/**
 * Brace-balanced extraction of the LAST `{"findings" ...}` object from an
 * arbitrary text blob. The verifier agent empirically ALWAYS prepends prose
 * even when told to emit only JSON, so whole-string JSON.parse cannot be
 * trusted (both shakedown transcripts prove it). We scan for the last
 * `{ "findings"` opener (tolerant of whitespace) and walk braces — respecting
 * string literals and escapes — to its matching close.
 *
 * @param {string} text
 * @returns {string | null} the JSON substring, or null if none found
 */
export function extractFindingsObject(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  // Find the last opener `{  "findings"` (allow whitespace between { and key).
  const opener = /\{\s*"findings"/g;
  let start = -1;
  let m;
  while ((m = opener.exec(text)) !== null) start = m.index;
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < text.length; j += 1) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, j + 1);
    }
  }
  return null;
}

/**
 * Map the `--output-format json` result envelope's usage/timing to a camelCase
 * runStats block for the report (spec §5.3, additive). Omit-not-fake: any
 * field absent from the envelope is simply left off.
 *
 * @param {object} envelope
 * @returns {object | null}
 */
export function extractRunStats(envelope) {
  if (!envelope || typeof envelope !== 'object') return null;
  const stats = {};
  if (typeof envelope.duration_ms === 'number') stats.durationMs = envelope.duration_ms;
  if (typeof envelope.num_turns === 'number') stats.numTurns = envelope.num_turns;
  if (typeof envelope.total_cost_usd === 'number') stats.totalCostUsd = envelope.total_cost_usd;
  const u = envelope.usage;
  if (u && typeof u === 'object') {
    const tokens = {};
    if (typeof u.input_tokens === 'number') tokens.inputTokens = u.input_tokens;
    if (typeof u.output_tokens === 'number') tokens.outputTokens = u.output_tokens;
    if (typeof u.cache_read_input_tokens === 'number') tokens.cacheReadInputTokens = u.cache_read_input_tokens;
    if (typeof u.cache_creation_input_tokens === 'number') tokens.cacheCreationInputTokens = u.cache_creation_input_tokens;
    if (Object.keys(tokens).length > 0) stats.tokens = tokens;
  }
  return Object.keys(stats).length > 0 ? stats : null;
}

/**
 * Two-layer robust ingestion of the raw agent stdout (spec §5.4 — the report
 * is build-lite's next input, so parse must not lose the verdict to a stray
 * prose prefix):
 *   Layer A — parse the whole stdout as the `--output-format json` result
 *             envelope; the agent's text reply is in `.result`, and usage/timing
 *             give runStats.
 *   Layer B — brace-balanced extraction of the `{"findings":[...]}` object,
 *             first from the envelope's `.result` text, then (belt) from the
 *             whole raw stdout in case the envelope shape ever changes.
 * Both layers, never either. Success requires a `{ findings: [...] }` object.
 *
 * @param {string} rawStdout
 * @returns {{ ok: true, findings: object[], runStats: (object|null) } | { ok: false, reason: string }}
 */
export function parseAgentOutput(rawStdout) {
  const raw = typeof rawStdout === 'string' ? rawStdout : '';
  let envelope = null;
  let resultText = raw;
  let runStats = null;
  // Layer A: the result envelope.
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.type === 'result') {
      envelope = parsed;
      runStats = extractRunStats(envelope);
      if (typeof envelope.result === 'string') resultText = envelope.result;
    }
  } catch {
    // Not an envelope (text-mode stdout, or truncated). Fall through to Layer B on raw.
  }
  // Layer B: brace-balanced extraction — from the envelope text first, then raw.
  const candidate = extractFindingsObject(resultText) ?? extractFindingsObject(raw);
  if (!candidate) {
    const detail = envelope
      ? `agent produced no {"findings"} object (envelope subtype=${envelope.subtype ?? 'unknown'}, is_error=${envelope.is_error ?? 'unknown'})`
      : 'agent output was neither a result envelope nor did it contain a {"findings"} object';
    return { ok: false, reason: detail };
  }
  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch (err) {
    return { ok: false, reason: `extracted {"findings"} object failed to parse: ${err.message}` };
  }
  if (!obj || !Array.isArray(obj.findings)) {
    return { ok: false, reason: 'extracted object had no findings array' };
  }
  return { ok: true, findings: obj.findings, runStats };
}

/**
 * Resolve the launchAgent function for this run. Precedence:
 *   1. an explicitly injected `deps.launchAgent` (unit tests, in-process harness);
 *   2. a module named by RCF_VERIFY_LAUNCHER (integration + manual e2e seam);
 *   3. the default spawn launcher (live Claude Code + Playwright).
 *
 * @param {object} [deps]
 * @returns {Promise<(ctx: object) => Promise<{findings: object[], runStats?: object}>>}
 */
export async function resolveLauncher(deps = {}) {
  if (typeof deps.launchAgent === 'function') return deps.launchAgent;
  const envModule = process.env[LAUNCHER_ENV];
  if (envModule) {
    const mod = await import(envModule);
    const fn = mod.launchAgent ?? mod.default;
    if (typeof fn !== 'function') {
      throw new Error(`${LAUNCHER_ENV} module "${envModule}" does not export launchAgent`);
    }
    return fn;
  }
  return defaultSpawnLauncher;
}

/**
 * Default launcher: spawn the live verifier agent (Claude Code) with the
 * isolation env + scoped tools + provisioned Playwright, and let it drive the
 * app. Ingests its output through the two-layer parser.
 *
 * v1 honesty (§9, §11): the live-agent-drives-live-app path is NOT unit-
 * testable and is exercised only by the recorded manual e2e; the PARSE logic
 * (parseAgentOutput / extractFindingsObject) IS unit-tested against real
 * captured transcripts. When ingestion fails, the raw transcript is written to
 * disk and its path carried on the thrown error — never lose the evidence, and
 * never fabricate a PASS (§9). Callers (engine) turn the throw into a
 * LAUNCH-FAILURE report so the §5.4 fix loop still has something to ingest.
 *
 * @param {object} ctx
 * @returns {Promise<{ findings: object[], runStats: (object|null) }>}
 */
export async function defaultSpawnLauncher(ctx) {
  const { spawn } = await import('node:child_process');
  const config = buildLaunchConfig(ctx, {});
  const out = await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.command, config.args, { env: config.env, stdio: ['pipe', 'pipe', 'inherit'] });
    } catch (err) {
      reject(new Error(`could not launch verifier agent "${config.command}": ${err.message}. `
        + `Set ${LAUNCHER_ENV} to a module exporting launchAgent, or install the agent CLI.`));
      return;
    }
    let buf = '';
    child.stdout.on('data', (d) => { buf += d.toString(); });
    child.on('error', (err) => reject(new Error(`verifier agent failed to start: ${err.message}. Set ${LAUNCHER_ENV} to inject a launcher.`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`verifier agent exited ${code}`));
        return;
      }
      resolve(buf);
    });
    // Hand the brief to the agent on stdin.
    child.stdin.write(JSON.stringify(config.brief));
    child.stdin.end();
  });

  const parsed = parseAgentOutput(out);
  if (!parsed.ok) {
    const rawPath = await persistRawOutput(out);
    const err = new Error(`verifier agent output could not be ingested: ${parsed.reason}. Raw transcript: ${rawPath}`);
    err.rawOutputPath = rawPath;
    throw err;
  }
  return { findings: parsed.findings, runStats: parsed.runStats };
}

/**
 * Persist an un-ingestible raw agent transcript so it is never lost (spec §5.4
 * — the transcript is the only evidence of what the agent actually emitted).
 *
 * @param {string} raw
 * @returns {Promise<string>} the path written (or a marker if the write failed)
 */
async function persistRawOutput(raw) {
  try {
    const { writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const path = join(tmpdir(), `rcf-verify-agent-output-${Date.now()}.txt`);
    await writeFile(path, raw ?? '', 'utf8');
    return path;
  } catch (err) {
    return `(could not persist raw transcript: ${err.message})`;
  }
}
