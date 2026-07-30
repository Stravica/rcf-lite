// Pre-session agent bootstrap (Theme 1, E2E matrix 2026-07-06-003;
// updated for 0.6.0 init-hygiene). `rcf init` is the single golden path
// that leaves a project fully wired BEFORE the agent session starts:
// rcf/ tree + project-root .mcp.json (rcf server entry) + the managed
// canonical block inside marker comments in the agent-instructions
// file. Anything that detects incomplete setup funnels back here: run
// `npx rcf init`, then restart the agent session.
//
// 0.6.0 changes:
// - Marker constants moved to `managed-markers.js` and imported here
//   (D-7); the strand-1 legacy migration recognises both generations.
// - Canonical block content is sourced from
//   `guidance/managed/agent-instructions-block.md`, not from the
//   `guidance/harness-template.md` fenced fragment. The two remain
//   byte-identical after `scripts/gen-managed-artefacts.mjs` runs
//   (AC-1.14); harness-template.md stays as the manual-paste-in doc.
// - `hasAgentMarker` recognises BOTH the new managed markers and the
//   pre-0.6.0 legacy markers so the MCP setup funnel does not spam
//   legacy-inited repos with "Setup incomplete" notices (§2.5 / AC-1.13).

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';

import {
  MARKER_BEGIN,
  MARKER_END,
  LEGACY_MARKER_BEGIN,
  markerRegex,
} from './managed-markers.js';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');
const MANAGED_BLOCK_PATH = join(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.md');
const MANAGED_HASH_PATH = join(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.hash');
const LEGACY_FRAGMENT_HASHES_PATH = join(PACKAGE_ROOT, 'guidance', 'managed', 'legacy-fragment-hashes.json');

// Re-export the marker constants at the module boundary so callers that
// already import from `agent-setup.js` (setup funnel, existing tests)
// keep working without touching every import site.
export { MARKER_BEGIN, MARKER_END, LEGACY_MARKER_BEGIN } from './managed-markers.js';

/** Absolute path of this package's rcf bin - what .mcp.json points at. */
export function rcfBinPath() {
  return join(PACKAGE_ROOT, 'bin', 'rcf.js');
}

/** Absolute path of the canonical managed block; test-visible for the byte-match AC. */
export function managedBlockPath() {
  return MANAGED_BLOCK_PATH;
}

/** Absolute path of the canonical managed-block hash file. */
export function managedBlockHashPath() {
  return MANAGED_HASH_PATH;
}

/**
 * Absolute path of the pre-0.6.0 canonical-fragment hash whitelist that
 * §7.3's fail-safe hand-edit detector consults. Test-visible.
 */
export function legacyFragmentHashesPath() {
  return LEGACY_FRAGMENT_HASHES_PATH;
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
 * Read the canonical managed block text (§2.4 verbatim). Returns the
 * text with a trailing newline; callers wrap it in the markers. Fails
 * with an RcfError if the shipped asset is missing (bad tarball, files
 * whitelist regression) - doctor surfaces this rather than pretending
 * clean (§12 risk).
 *
 * @returns {Promise<string | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function loadManagedBlock() {
  const text = await readIfExists(MANAGED_BLOCK_PATH);
  if (text === null) {
    return rcfError({ kind: 'missingFile', message: `managed block not found: ${MANAGED_BLOCK_PATH}`, filePath: MANAGED_BLOCK_PATH });
  }
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Read the SHA-256 hash the package shipped for the managed block. One
 * line, no trailing whitespace; on read failure, returns an RcfError
 * with kind `hashFileMissing` so doctor emits a distinct error rather
 * than reporting spurious clean.
 *
 * @returns {Promise<string | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function loadManagedBlockHash() {
  const text = await readIfExists(MANAGED_HASH_PATH);
  if (text === null) {
    return rcfError({ kind: 'hashFileMissing', message: `managed-block hash not found: ${MANAGED_HASH_PATH}`, filePath: MANAGED_HASH_PATH });
  }
  return text.trim();
}

/**
 * Read the SHA-256 whitelist of pre-0.6.0 canonical fragments (§7.3).
 * Doctor's `detectLegacyHandEdits` hashes the extracted legacy inner
 * content (trimmed) and treats any hash NOT in the returned set as
 * hand-edited. Fail-safe: a missing / malformed whitelist surfaces as
 * an RcfError rather than silently allowing overwrite.
 *
 * @returns {Promise<Set<string> | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function loadLegacyFragmentHashes() {
  const text = await readIfExists(LEGACY_FRAGMENT_HASHES_PATH);
  if (text === null) {
    return rcfError({
      kind: 'legacyFragmentHashesMissing',
      message: `legacy fragment hash whitelist not found: ${LEGACY_FRAGMENT_HASHES_PATH}`,
      filePath: LEGACY_FRAGMENT_HASHES_PATH,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return rcfError({
      kind: 'legacyFragmentHashesInvalid',
      message: `legacy fragment hash whitelist is not valid JSON: ${err.message}`,
      filePath: LEGACY_FRAGMENT_HASHES_PATH,
    });
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.hashes)) {
    return rcfError({
      kind: 'legacyFragmentHashesInvalid',
      message: `legacy fragment hash whitelist missing hashes[] array`,
      filePath: LEGACY_FRAGMENT_HASHES_PATH,
    });
  }
  const set = new Set();
  for (const entry of parsed.hashes) {
    if (entry && typeof entry.hash === 'string' && /^[0-9a-f]{64}$/i.test(entry.hash)) {
      set.add(entry.hash.toLowerCase());
    }
  }
  return set;
}

/**
 * Extract the paste-in fragment from guidance/harness-template.md (the
 * first ```markdown fence). Preserved for the paste-in doc use case,
 * but the fragment is regenerated at package-build time from the
 * managed block canonical source (AC-1.14) so the two are byte-identical.
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
 * Write the composed managed block into one agent-instructions file.
 * Idempotent: an existing new-marker block is replaced in place, never
 * duplicated; a file without one gets the block appended; a missing
 * file is created. Init does not touch legacy markers - that migration
 * is doctor's `--fix` path, so an existing pre-0.6.0 file whose only
 * marker pair is the legacy one gets a NEW managed block appended
 * alongside the legacy one, and the operator resolves via `rcf doctor
 * --fix` afterwards. This preserves init's "leave operator content
 * alone" discipline even for a file that also happens to carry the old
 * managed convention.
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
  const markerRe = markerRegex();
  if (markerRe.test(existing)) {
    await writeFile(target, existing.replace(markerRe, block), 'utf8');
    return { file, action: 'replaced' };
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  await writeFile(target, `${existing}${sep}${block}\n`, 'utf8');
  return { file, action: 'appended' };
}

/**
 * Write the canonical managed block into the project's agent-instructions
 * file(s) inside the rcf managed markers. Routing:
 * - An existing instructions file is refreshed in place (CLAUDE.md
 *   preferred as the write target, else an existing AGENTS.md). We
 *   never invent the other convention's file when one already exists.
 * - A fresh repo (neither present) gets BOTH CLAUDE.md and AGENTS.md,
 *   so the wiring is vendor-neutral by default (operator ruling
 *   2026-07-16). The same marked block goes into each.
 * Idempotent throughout: re-running replaces the marked block in place,
 * never duplicating it, in whichever file(s) are touched.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.fragment - canonical block inner content (no markers).
 * @returns {Promise<{ writes: Array<{ file: string, action: 'created'|'appended'|'replaced' }> }>}
 */
export async function writeAgentInstructions({ projectRoot, fragment }) {
  const claudePath = join(projectRoot, 'CLAUDE.md');
  const agentsPath = join(projectRoot, 'AGENTS.md');
  const claudeExists = await fileExists(claudePath);
  const agentsExists = await fileExists(agentsPath);
  const trimmed = fragment.trim();
  const block = `${MARKER_BEGIN}\n${trimmed}\n${MARKER_END}`;
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
 * Does the project's agent-instructions file carry ANY generation of
 * the rcf marker block? The MCP setup funnel uses this: marker absent
 * means the session started without the init bootstrap.
 *
 * Recognises BOTH the 0.6.0+ managed marker (MARKER_BEGIN) and the
 * pre-0.6.0 legacy marker (LEGACY_MARKER_BEGIN). Either presence
 * satisfies the funnel so a legacy-inited repo is not spammed with
 * setup notices for the process lifetime while it waits to migrate;
 * the correct signal for "you should migrate" is doctor's
 * `legacy-markers` drift item, which the operator sees on their next
 * diagnostic run. §2.5, AC-1.13.
 *
 * @param {string} projectRoot
 * @returns {Promise<boolean>}
 */
export async function hasAgentMarker(projectRoot) {
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const text = await readIfExists(join(projectRoot, name));
    if (text === null) continue;
    if (text.includes(MARKER_BEGIN)) return true;
    if (text.includes(LEGACY_MARKER_BEGIN)) return true;
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
    '  2. Paste the fragment from `rcf guidance harness-template` (the',
    '     first ```markdown fence) into your project\'s CLAUDE.md or',
    '     AGENTS.md.',
    '  3. Restart your agent session so it picks both up.',
  ].join('\n');
}
