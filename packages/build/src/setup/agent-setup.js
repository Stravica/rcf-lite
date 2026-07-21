// Pre-session agent bootstrap (Theme 1, E2E matrix 2026-07-06-003).
// `rcf init` is the single golden path that leaves a project fully
// wired BEFORE the agent session starts: rcf/ tree + project-root
// .mcp.json (rcf server entry) + the guidance fragment inside marked
// begin/end comments in the agent-instructions file. Anything that
// detects incomplete setup funnels back here: run `npx rcf init`, then
// restart the agent session.
//
// The fragment's single source of truth is guidance/harness-template.md
// (the first ```markdown fence); this module extracts it at runtime so
// the paste-in doc and the init-written block can never drift.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');

export const MARKER_BEGIN = '<!-- rcf:begin -->';
export const MARKER_END = '<!-- rcf:end -->';

/** Absolute path of this package's rcf bin - what .mcp.json points at. */
export function rcfBinPath() {
  return join(PACKAGE_ROOT, 'bin', 'rcf.js');
}

async function fileExists(path) {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Extract the paste-in fragment from guidance/harness-template.md (the
 * first ```markdown fence). Returns the fragment text (no fences) or an
 * RcfError if the template is missing or holds no fence.
 *
 * @param {object} [opts]
 * @param {string} [opts.templatePath] - test override
 * @returns {Promise<string | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function loadHarnessFragment({ templatePath } = {}) {
  const path = templatePath ?? join(PACKAGE_ROOT, 'guidance', 'harness-template.md');
  const text = await readIfExists(path);
  if (text === null) {
    return rcfError({ kind: 'missingFile', message: `harness template not found: ${path}`, filePath: path });
  }
  const m = /```markdown\n([\s\S]*?)```/.exec(text);
  if (!m) {
    return rcfError({ kind: 'parseFailure', message: `no \`\`\`markdown fragment fence in ${path}`, filePath: path });
  }
  return m[1].trim();
}

/**
 * Write or merge the project-root .mcp.json with the rcf server entry
 * (the exact registration shape docs/install.md documents). MERGE
 * discipline: other servers and unknown top-level keys are preserved
 * verbatim; an existing `rcf` entry is left alone.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} [args.binPath] - test override
 * @returns {Promise<{ file: string, action: 'created'|'merged'|'kept' } | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function writeMcpConfig({ projectRoot, binPath = rcfBinPath() }) {
  const file = join(projectRoot, '.mcp.json');
  const raw = await readIfExists(file);
  let config = {};
  let action = 'created';
  if (raw !== null) {
    try {
      config = JSON.parse(raw);
    } catch (err) {
      return rcfError({
        kind: 'parseFailure',
        message: `.mcp.json exists but is not valid JSON (${err.message}); refusing to modify it. Fix it by hand, or add the rcf entry manually - see docs/install.md, section 7.`,
        filePath: '.mcp.json',
      });
    }
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      return rcfError({
        kind: 'parseFailure',
        message: '.mcp.json exists but is not a JSON object; refusing to modify it.',
        filePath: '.mcp.json',
      });
    }
    action = 'merged';
  }
  const servers = (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers))
    ? config.mcpServers
    : {};
  if (servers.rcf) {
    return { file: '.mcp.json', action: 'kept' };
  }
  const next = {
    ...config,
    mcpServers: {
      ...servers,
      rcf: { command: 'node', args: [binPath, 'mcp'] },
    },
  };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { file: '.mcp.json', action };
}

/**
 * Write the fragment into one agent-instructions file inside the rcf
 * marker block. Idempotent: an existing marker block is replaced in
 * place, never duplicated; a file without one gets the block appended;
 * a missing file is created.
 *
 * @param {string} target - absolute path
 * @param {string} file - display name (CLAUDE.md / AGENTS.md)
 * @param {string} block - the marked fragment block
 * @returns {Promise<{ file: string, action: 'created'|'appended'|'replaced' }>}
 */
async function writeFragmentToFile(target, file, block) {
  const existing = await readIfExists(target);
  if (existing === null) {
    await writeFile(target, `${block}\n`, 'utf8');
    return { file, action: 'created' };
  }
  const markerRe = /<!-- rcf:begin -->[\s\S]*?<!-- rcf:end -->/;
  if (markerRe.test(existing)) {
    await writeFile(target, existing.replace(markerRe, block), 'utf8');
    return { file, action: 'replaced' };
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  await writeFile(target, `${existing}${sep}${block}\n`, 'utf8');
  return { file, action: 'appended' };
}

/**
 * Write the guidance fragment into the project's agent-instructions
 * file(s) inside the rcf marker block. Routing:
 * - An existing instructions file is refreshed in place (CLAUDE.md
 *   preferred as the write target, else an existing AGENTS.md). We
 *   never invent the other convention's file when one already exists.
 * - A fresh repo (neither present) gets BOTH CLAUDE.md and AGENTS.md,
 *   so the wiring is vendor-neutral by default (operator ruling
 *   2026-07-16). The same marked fragment goes into each.
 * Idempotent throughout: re-running replaces the marked block in place,
 * never duplicating it, in whichever file(s) are touched.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.fragment
 * @returns {Promise<{ writes: Array<{ file: string, action: 'created'|'appended'|'replaced' }> }>}
 */
export async function writeAgentInstructions({ projectRoot, fragment }) {
  const claudePath = join(projectRoot, 'CLAUDE.md');
  const agentsPath = join(projectRoot, 'AGENTS.md');
  const claudeExists = await fileExists(claudePath);
  const agentsExists = await fileExists(agentsPath);
  const block = `${MARKER_BEGIN}\n${fragment}\n${MARKER_END}`;
  const writes = [];

  if (claudeExists) {
    // Existing CLAUDE.md wins as the target; refresh it in place.
    writes.push(await writeFragmentToFile(claudePath, 'CLAUDE.md', block));
  } else if (agentsExists) {
    // No CLAUDE.md, but an AGENTS.md is present: keep that routing.
    writes.push(await writeFragmentToFile(agentsPath, 'AGENTS.md', block));
  } else {
    // Fresh repo: write both, vendor-neutral by default.
    writes.push(await writeFragmentToFile(claudePath, 'CLAUDE.md', block));
    writes.push(await writeFragmentToFile(agentsPath, 'AGENTS.md', block));
  }
  return { writes };
}

/**
 * Does the project's agent-instructions file carry the rcf marker
 * block? The MCP setup funnel uses this: marker absent means the
 * session started without the init bootstrap.
 *
 * @param {string} projectRoot
 * @returns {Promise<boolean>}
 */
export async function hasAgentMarker(projectRoot) {
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const text = await readIfExists(join(projectRoot, name));
    if (text !== null && text.includes(MARKER_BEGIN)) return true;
  }
  return false;
}

/**
 * The single funnel instruction every incomplete-setup touchpoint
 * repeats. One golden path; no degraded mid-session fallback.
 */
export const SETUP_FUNNEL_INSTRUCTION = 'Setup incomplete. Run `npx rcf init` to finish wiring '
  + '(tree + .mcp.json + agent instructions), then tell the user to exit and restart their '
  + 'agent session before continuing.';

/**
 * Manual instructions printed by `rcf init --no-agent-setup`.
 *
 * @param {string} [binPath]
 * @returns {string}
 */
export function manualSetupInstructions(binPath = rcfBinPath()) {
  return [
    'Agent setup skipped (--no-agent-setup). To wire the harness manually:',
    '  1. Register the MCP server in your project-root .mcp.json:',
    '       { "mcpServers": { "rcf": { "command": "node",',
    `         "args": ["${binPath}", "mcp"] } } }`,
    '  2. Paste the fragment from guidance/harness-template.md into your',
    '     project\'s CLAUDE.md or AGENTS.md.',
    '  3. Restart your agent session so it picks both up.',
  ].join('\n');
}
