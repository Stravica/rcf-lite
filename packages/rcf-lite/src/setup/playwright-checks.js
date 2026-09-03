// Doctor's browser-facing project checks (spec 2026-09-03, section 3) plus
// init-time Playwright signature detection and the Claude Code cross-scope
// probe (spec sections 4.1-4.3). All probes are injectable via a `deps`
// argument so the unit suite runs with none of these tools installed.
//
// A project is browser-facing exactly when its rcf/manifest.json carries at
// least one blueprint in manifest.blueprints[] whose loaded blueprint.json
// declares `browserSurface`. Detection is a manifest fact, not string grammar:
// doctor loads the manifest, walks manifest.blueprints[].source, reads each
// blueprint.json, and evaluates the flag. Blueprints not shipping the field
// are treated as not-browser-facing, and no per-slug allowlist exists.
//
// The 15-second cap on the reachability probe is a diagnostic ceiling; on a
// warm cache the probe returns in well under a second, and the ceiling only
// matters where npx would be doing a fresh network fetch it should not be
// doing on a diagnostic run.

import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve as pathResolve } from 'node:path';
import { spawn } from 'node:child_process';

import { PLAYWRIGHT_MCP_VERSION } from '../verify/engine/launcher.js';

/**
 * The three fix lines emitted per check, verbatim from the spec's fix-line
 * table. Tests assert the strings; changing them requires a spec amendment.
 */
export const FIX_LINES = Object.freeze({
  'playwright-present':
    'Install the peer dependency: npm i -D playwright@^1.50.0 (or the pnpm/yarn equivalent for your project).',
  'browser-present':
    'Install a browser: npx @playwright/mcp install-browser chromium (Playwright-managed) or install system Google Chrome (used by @playwright/mcp by default).',
  'playwright-mcp-reachable':
    `Install @playwright/mcp: npm i -D @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} (the pinned version rcf verify runs).`,
  'playwright-mcp-redundant':
    "project-scope .mcp.json carries a Playwright MCP entry that is also declared at user scope. The project entry shadows the user entry. Remove the project entry with `rcf init --no-playwright-mcp` (which re-runs init without writing it), or delete the entry from .mcp.json by hand.",
});

/**
 * The single skip line for non-browser-facing projects. Not suppressed by
 * --quiet (spec 3.4).
 */
export const SKIP_LINE_NON_BROWSER_FACING =
  'rcf doctor: skipping playwright-present, browser-present, playwright-mcp-reachable (no applied blueprint declares a browser surface).';

/**
 * Is the manifest a browser-facing project per spec 3.1?
 *
 * @param {string} projectRoot
 * @param {object} [deps]
 * @param {(source: string) => Promise<object|null>} [deps.readBlueprintManifest] - test seam
 * @returns {Promise<{ browserFacing: boolean, sources: string[] }>}
 */
export async function loadBrowserFacingSources(projectRoot, deps = {}) {
  const readManifest = deps.readBlueprintManifest ?? defaultReadBlueprintManifest;
  const rootManifestPath = join(projectRoot, 'rcf', 'manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(rootManifestPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { browserFacing: false, sources: [] };
    throw err;
  }
  const applied = Array.isArray(manifest?.blueprints) ? manifest.blueprints : [];
  const sources = [];
  for (const record of applied) {
    if (!record || typeof record.source !== 'string') continue;
    const resolved = isAbsolute(record.source)
      ? record.source
      : pathResolve(projectRoot, record.source);
    let bp;
    try {
      bp = await readManifest(resolved);
    } catch {
      bp = null;
    }
    if (bp && bp.browserSurface && bp.browserSurface.declared === true) {
      sources.push(resolved);
    }
  }
  return { browserFacing: sources.length > 0, sources };
}

async function defaultReadBlueprintManifest(source) {
  const metaPath = join(source, 'blueprint.json');
  try {
    return JSON.parse(await readFile(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Check that `playwright` is resolvable from the project root.
 *
 * @param {string} projectRoot
 * @returns {{ ok: boolean, resolvedFrom: (string|null) }}
 */
export function checkPlaywrightPresent(projectRoot) {
  const req = createRequire(join(projectRoot, '__rcf-require-anchor__'));
  try {
    const resolvedFrom = req.resolve('playwright');
    return { ok: true, resolvedFrom };
  } catch {
    return { ok: false, resolvedFrom: null };
  }
}

/**
 * Check that some Chromium is available to @playwright/mcp: system Chrome on
 * PATH first, then a Playwright-managed cache directory, then the tool's own
 * first-party status probe.
 *
 * @param {object} [deps]
 * @param {(name: string) => boolean} [deps.pathHas]
 * @param {(path: string) => boolean} [deps.dirExists]
 * @param {() => Promise<{ ok: boolean, source: string }>} [deps.probeMcpBrowserStatus]
 * @param {() => string} [deps.homedir]
 * @returns {Promise<{ ok: boolean, source: (string|null) }>}
 */
export async function checkBrowserPresent(deps = {}) {
  const pathHas = deps.pathHas ?? defaultPathHas;
  const dirExists = deps.dirExists ?? existsSync;
  const home = deps.homedir ?? homedir;
  for (const bin of ['google-chrome-stable', 'chromium', 'chrome', 'Google Chrome']) {
    if (pathHas(bin)) return { ok: true, source: `path:${bin}` };
  }
  const playwrightCache = join(home(), '.cache', 'ms-playwright');
  if (dirExists(playwrightCache)) {
    try {
      const entries = await readdir(playwrightCache);
      if (entries.some((e) => /^chromium/i.test(e))) {
        return { ok: true, source: `cache:${playwrightCache}` };
      }
    } catch {
      // fall through to first-party probe
    }
  }
  const probe = deps.probeMcpBrowserStatus ?? defaultProbeMcpBrowserStatus;
  try {
    const res = await probe();
    if (res && res.ok) return { ok: true, source: `mcp:${res.source ?? 'ok'}` };
  } catch {
    // treat any probe failure as no browser
  }
  return { ok: false, source: null };
}

function defaultPathHas(binName) {
  const path = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of path.split(sep)) {
    if (!dir) continue;
    try {
      const p = join(dir, binName);
      if (existsSync(p)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

async function defaultProbeMcpBrowserStatus() {
  return runNpxProbe(['--no-install', '@playwright/mcp', 'browser-status', '--json'], 15000)
    .then((r) => (r.exitCode === 0 ? { ok: true, source: 'browser-status' } : { ok: false }))
    .catch(() => ({ ok: false }));
}

/**
 * Check that `npx --no-install @playwright/mcp --help` runs and exits 0 in
 * under 15 seconds. `--no-install` so the check does not silently pull the
 * package during a diagnostic run.
 *
 * @param {object} [deps]
 * @param {(args: string[], timeoutMs: number) => Promise<{ exitCode: number, timedOut: boolean }>} [deps.runNpx]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<{ ok: boolean, exitCode: (number|null), timedOut: boolean }>}
 */
export async function checkPlaywrightMcpReachable(deps = {}) {
  const runNpx = deps.runNpx ?? runNpxProbe;
  const timeoutMs = deps.timeoutMs ?? 15000;
  try {
    const res = await runNpx(['--no-install', '@playwright/mcp', '--help'], timeoutMs);
    return {
      ok: res.exitCode === 0,
      exitCode: res.exitCode ?? null,
      timedOut: Boolean(res.timedOut),
    };
  } catch (err) {
    return { ok: false, exitCode: null, timedOut: false, error: err.message };
  }
}

function runNpxProbe(args, timeoutMs) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn('npx', args, { stdio: 'ignore' });
    } catch (err) {
      resolvePromise({ exitCode: null, timedOut: false, error: err.message });
      return;
    }
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolvePromise({ exitCode: null, timedOut: true });
    }, timeoutMs);
    child.on('close', (code) => {
      if (done) return;
      clearTimeout(timer);
      done = true;
      resolvePromise({ exitCode: code ?? null, timedOut: false });
    });
    child.on('error', (err) => {
      if (done) return;
      clearTimeout(timer);
      done = true;
      resolvePromise({ exitCode: null, timedOut: false, error: err.message });
    });
  });
}

/* ================================================================== */
/* Playwright signature detection (spec 4.1) + probe (spec 4.2/4.3).  */
/* ================================================================== */

/** Regex naming a @playwright/mcp args token (any pinning suffix accepted). */
const PLAYWRIGHT_MCP_TOKEN = /^@playwright\/mcp(?:@|$)/;

/**
 * True iff a parsed mcpServers[<name>] entry has a Playwright signature by
 * command tail: any `args` string matching /^@playwright\/mcp(@|$)/, or a
 * `command` path whose basename is `mcp` and lives under a @playwright/mcp
 * package directory.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
export function hasPlaywrightSignature(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const args = Array.isArray(entry.args) ? entry.args : [];
  if (args.some((a) => typeof a === 'string' && PLAYWRIGHT_MCP_TOKEN.test(a))) return true;
  if (typeof entry.command === 'string') {
    const cmd = entry.command;
    if (basename(cmd) === 'mcp' && /@playwright\/mcp/.test(cmd)) return true;
  }
  return false;
}

/**
 * Look up the first project-scope entry key carrying a Playwright signature
 * in a parsed .mcp.json body. Returns null when no entry matches.
 *
 * @param {object|null|undefined} mcpJson - the parsed .mcp.json body
 * @returns {string|null}
 */
export function findProjectPlaywrightKey(mcpJson) {
  const servers = mcpJson?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return null;
  for (const [key, entry] of Object.entries(servers)) {
    if (hasPlaywrightSignature(entry)) return key;
  }
  return null;
}

/**
 * Probe the Claude Code harness for a Playwright entry at any scope by
 * shelling out to `claude mcp list` and parsing its text output. Result
 * shapes:
 * - { kind: 'found', name, scope } - line matched signature and named scope
 * - { kind: 'none' } - claude ran cleanly and reported no Playwright entry
 * - { kind: 'inconclusive', reason } - probe could not prove either way
 *
 * @param {object} [deps]
 * @param {(cmd: string, args: string[], timeoutMs: number) => Promise<{ exitCode: number, stdout: string, timedOut: boolean, error?: string }>} [deps.runProbe]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<{ kind: 'found', name: string, scope: string }
 *   | { kind: 'none' } | { kind: 'inconclusive', reason: string }>}
 */
export async function probeClaudeCodeMcp(deps = {}) {
  const run = deps.runProbe ?? defaultRunProbeText;
  const timeoutMs = deps.timeoutMs ?? 5000;
  let res;
  try {
    res = await run('claude', ['mcp', 'list'], timeoutMs);
  } catch (err) {
    return { kind: 'inconclusive', reason: `claude probe threw: ${err.message}` };
  }
  if (res.timedOut) return { kind: 'inconclusive', reason: 'claude mcp list timed out' };
  if (res.error) return { kind: 'inconclusive', reason: `claude probe error: ${res.error}` };
  if (res.exitCode !== 0) return { kind: 'inconclusive', reason: `claude mcp list exited ${res.exitCode}` };
  const parsed = parseClaudeMcpListOutput(res.stdout ?? '');
  if (parsed.kind === 'unparseable') {
    return { kind: 'inconclusive', reason: 'claude mcp list output did not parse' };
  }
  if (parsed.kind === 'found') return { kind: 'found', name: parsed.name, scope: parsed.scope };
  return { kind: 'none' };
}

/**
 * Parse `claude mcp list` text output for a Playwright signature. The docs
 * name the shape as human-readable text: each server on its own line,
 * beginning with a name; a scope marker `user`, `project`, or `local`
 * appears; the command tail column carries the command and its args. We
 * accept any line whose text contains `@playwright/mcp` and one of the
 * three scope tokens; the name is the first token on that line.
 *
 * @param {string} text
 * @returns {{ kind: 'found', name: string, scope: string } | { kind: 'none' } | { kind: 'unparseable' }}
 */
export function parseClaudeMcpListOutput(text) {
  if (typeof text !== 'string') return { kind: 'unparseable' };
  const lines = text.split('\n');
  let sawAnyEntry = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (/^(No |No MCP servers|Usage:|Error:)/i.test(line)) continue;
    if (!/@playwright\/mcp/.test(line)) {
      // A recognisable non-Playwright entry indicates parseable output.
      if (/\b(user|project|local)\b/.test(line)) sawAnyEntry = true;
      continue;
    }
    const scopeMatch = line.match(/\b(user|project|local)\b/);
    if (!scopeMatch) continue;
    const firstToken = line.split(/\s+/)[0];
    if (!firstToken) continue;
    return { kind: 'found', name: firstToken, scope: scopeMatch[1] };
  }
  // No Playwright line found; if we saw at least one non-Playwright entry,
  // treat the output as parseable and definitively no Playwright.
  if (sawAnyEntry) return { kind: 'none' };
  // Empty or unrecognised output.
  if (lines.every((l) => l.trim().length === 0)) return { kind: 'none' };
  return { kind: 'none' };
}

async function defaultRunProbeText(cmd, args, timeoutMs) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolvePromise({ exitCode: null, stdout: '', timedOut: false, error: err.message });
      return;
    }
    let stdout = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolvePromise({ exitCode: null, stdout, timedOut: true });
    }, timeoutMs);
    child.on('close', (code) => {
      if (done) return;
      clearTimeout(timer);
      done = true;
      resolvePromise({ exitCode: code ?? null, stdout, timedOut: false });
    });
    child.on('error', (err) => {
      if (done) return;
      clearTimeout(timer);
      done = true;
      resolvePromise({ exitCode: null, stdout, timedOut: false, error: err.message });
    });
  });
}

// Silence unused import warnings for values consumed only via names.
void stat;
