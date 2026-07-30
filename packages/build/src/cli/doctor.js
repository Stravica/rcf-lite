// `rcf doctor` subcommand handler (0.6.0 spec §2.2). Diagnoses
// init-hygiene drift across four checks (agent-instructions, gitignore,
// knowledge, identity) and, with --fix, applies the safe minimal
// repair. Never runs implicitly: no init hook, no post-install script,
// no validate sub-call fires --fix on the operator's behalf (§2.8).
//
// Exit codes:
// - 0 clean (every check enabled reports clean).
// - 3 drift (at least one check reports drift).
// - 2 usage error.
//
// --fix contract (§2.7): rewrites managed blocks WHOLESALE inside the
// markers; every byte outside the markers is preserved verbatim. Files
// with structurally broken markers (orphan / duplicate) are refused;
// the operator repairs by hand. Running --fix on a clean repo writes
// zero files (idempotent no-op).

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  loadManagedBlock,
  loadManagedBlockHash,
  managedBlockPath,
} from '../setup/agent-setup.js';
import {
  MARKER_BEGIN,
  MARKER_END,
  LEGACY_MARKER_BEGIN,
  LEGACY_MARKER_END,
} from '../setup/managed-markers.js';
import {
  applyFix as applyManagedBlockFix,
  classifyBlock,
  hashInnerContent,
} from '../setup/managed-block.js';
import {
  composeGitignoreBlock,
  composeGitignoreInner,
  computeGitignoreBlockHash,
  extractGitignoreBlock,
  GITIGNORE_MARKER_BEGIN,
  GITIGNORE_MARKER_END,
  managedGitignoreEntries,
} from '../setup/managed-gitignore.js';
import { identityProfilePath } from '../setup/identity-seed.js';
import { knowledgePaths } from '../setup/knowledge-seed.js';

const OPTION_SPEC = {
  fix: { type: 'boolean' },
  check: { type: 'string' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  force: { type: 'boolean' },
  help: { type: 'boolean' },
};

const KNOWN_CHECKS = /** @type {const} */ (['agent-instructions', 'gitignore', 'knowledge', 'identity']);

export const HELP = `Usage: rcf doctor [--fix] [--check <check>[,check]] [--json] [--quiet] [--help]

Diagnose init-hygiene drift in the current project. Exits 0 clean, 3 when
any check reports drift, 2 on usage errors.

Options:
  --fix                     Apply the minimal safe repair for every check
                            that reports drift. Rewrites managed blocks
                            wholesale; leaves operator content untouched.
                            Refuses to touch files with structurally broken
                            markers; those must be resolved by hand or by
                            removing the corrupted region.
  --check <check>[,check]   Run only the named checks. Default: all.
                            Values: agent-instructions, gitignore,
                                    knowledge, identity.
  --json                    Emit machine-readable envelope: { ok, drift[] }.
  --quiet                   Only summary line + first 3 drift items.
  --force                   Accept a legacy-markers --fix on hand-edited
                            content that a non-interactive run would
                            otherwise refuse. See rcf help doctor for the
                            hand-edited-legacy migration rules.
  --help                    Print this help.
`;

/**
 * @param {string[]} argv - argv slice after `doctor`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) {
    stdout.write(HELP);
    return 0;
  }
  if (parsed.positionals.length > 0) {
    stderr.write(`[error] usage doctor: unexpected argument '${parsed.positionals[0]}'\n`);
    stderr.write(HELP);
    return 2;
  }

  let enabled = [...KNOWN_CHECKS];
  if (typeof flags.check === 'string' && flags.check.length > 0) {
    const asked = flags.check.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const bad = asked.filter((c) => !KNOWN_CHECKS.includes(/** @type {(typeof KNOWN_CHECKS)[number]} */ (c)));
    if (bad.length > 0) {
      stderr.write(`[error] usage doctor: unknown check '${bad[0]}'. Known checks: ${KNOWN_CHECKS.join(', ')}\n`);
      return 2;
    }
    enabled = asked;
  }

  // Load canonical block + hash once; a missing shipped asset is a
  // distinct error class so doctor never reports spurious clean.
  const canonical = await loadManagedBlock();
  if (typeof canonical !== 'string') {
    stderr.write(`[error] ${canonical.kind} ${canonical.message}\n`);
    return 1;
  }
  const canonicalHash = await loadManagedBlockHash();
  if (typeof canonicalHash !== 'string') {
    stderr.write(`[error] ${canonicalHash.kind} ${canonicalHash.message}\n`);
    return 1;
  }

  const ctx = {
    projectRoot: cwd,
    canonical,
    canonicalHash,
    fix: Boolean(flags.fix),
    force: Boolean(flags.force),
    // isTty is deps-injectable for tests; falls back to real stdout.
    isTty: deps.isTty ?? Boolean(stdout.isTTY),
  };

  /** @type {Array<{check: string, item: string, file: string, message: string, refusedByFix: boolean}>} */
  const drift = [];
  /** @type {Array<{file: string, action: string}>} */
  const writes = [];

  for (const check of enabled) {
    let result;
    if (check === 'agent-instructions') result = await runAgentInstructionsCheck(ctx);
    else if (check === 'gitignore') result = await runGitignoreCheck(ctx);
    else if (check === 'knowledge') result = await runKnowledgeCheck(ctx);
    else if (check === 'identity') result = await runIdentityCheck(ctx);
    else continue;
    for (const d of result.drift) drift.push({ check, ...d });
    for (const w of result.writes) writes.push(w);
  }

  // §2.7 exit-code semantics: with --fix, a run that repaired every
  // fixable drift item exits 0 even though drift WAS reported at scan
  // time. Exit 3 only when at least one drift item remains unrepaired
  // (either --fix was not passed, or the item was refused by --fix).
  const refusedCount = drift.filter((d) => d.refusedByFix).length;
  const unrepairedCount = ctx.fix ? refusedCount : drift.length;
  const ok = unrepairedCount === 0;
  const exitCode = ok ? 0 : 3;

  if (flags.json) {
    stdout.write(`${JSON.stringify({ ok, drift, writes }, null, 2)}\n`);
    return exitCode;
  }

  writeHumanSummary({ stdout, ok, drift, writes, fixed: ctx.fix, quiet: Boolean(flags.quiet) });
  return exitCode;
}

/** Render a human-readable summary. */
function writeHumanSummary({ stdout, ok, drift, writes, fixed, quiet }) {
  const repaired = writes.length;
  if (ok && repaired === 0) {
    stdout.write('rcf doctor: clean.\n');
    return;
  }
  if (ok && repaired > 0) {
    // Every drift item was repaired successfully. Report the repair
    // count so the operator sees what the run did.
    stdout.write(`rcf doctor: ${repaired} item${repaired === 1 ? '' : 's'} repaired; clean.\n`);
    for (const w of writes) stdout.write(`  fixed: ${w.file} (${w.action}).\n`);
    return;
  }
  const refused = drift.filter((d) => d.refusedByFix);
  stdout.write(`rcf doctor: ${drift.length} drift item${drift.length === 1 ? '' : 's'}`);
  if (fixed) stdout.write(` (${repaired} repaired, ${refused.length} refused)`);
  stdout.write('.\n');
  const limit = quiet ? 3 : drift.length;
  for (const d of drift.slice(0, limit)) {
    const tag = d.refusedByFix ? ' [refused]' : '';
    stdout.write(`  [${d.check}] ${d.item} ${d.file}${tag}\n`);
    if (!quiet) stdout.write(`      ${d.message}\n`);
  }
  if (limit < drift.length) {
    stdout.write(`  ... ${drift.length - limit} more (run without --quiet to see all).\n`);
  }
  if (fixed) {
    for (const w of writes) stdout.write(`  fixed: ${w.file} (${w.action}).\n`);
  } else {
    stdout.write('Run `rcf doctor --fix` to apply the safe repairs above.\n');
  }
}

/* ------------------------------------------------------------------ */
/* Check: agent-instructions                                          */
/* ------------------------------------------------------------------ */

async function runAgentInstructionsCheck(ctx) {
  const drift = [];
  const writes = [];
  const blockOpts = {
    markerBegin: MARKER_BEGIN,
    markerEnd: MARKER_END,
    legacyMarkerBegin: LEGACY_MARKER_BEGIN,
    legacyMarkerEnd: LEGACY_MARKER_END,
  };
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const path = join(ctx.projectRoot, name);
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') continue;
      throw err;
    }
    const state = classifyBlock(text, ctx.canonicalHash, blockOpts);
    if (state === 'clean') continue;
    const refusedByFix = state === 'orphan-marker' || state === 'duplicate-block';
    const item = state;
    const message = messageForState(state, path);
    drift.push({ item, file: name, message, refusedByFix });
    if (ctx.fix && !refusedByFix) {
      if (state === 'legacy-markers' && !ctx.force) {
        // Hand-edited-legacy migration warning (§7.3). Non-interactive
        // runs REFUSE without --force to avoid destroying operator edits.
        const legacyHasHandEdits = detectLegacyHandEdits(text);
        if (legacyHasHandEdits && !ctx.isTty) {
          // Convert the drift into a refused item without repairing.
          drift[drift.length - 1] = {
            item: 'legacy-markers-hand-edited',
            file: name,
            message: `${name} contains a legacy managed block with hand edits that do not match the pre-0.6.0 canonical fragment. Re-run with --force to overwrite (edits inside markers will be lost), or copy the hand-edited lines OUTSIDE the markers first.`,
            refusedByFix: true,
          };
          continue;
        }
      }
      const applied = applyManagedBlockFix(text, ctx.canonical, blockOpts, ctx.canonicalHash);
      if (applied && applied.action !== 'noop') {
        await writeFile(path, applied.nextText, 'utf8');
        writes.push({ file: name, action: applied.action });
      }
    }
  }
  return { drift, writes };
}

function messageForState(state, path) {
  switch (state) {
    case 'missing-block':
      return `${path} has no managed block. \`rcf doctor --fix\` appends one at end of file.`;
    case 'stale-hash':
      return `${path} has a managed block whose text does not match the canonical hash. \`rcf doctor --fix\` rewrites it in place.`;
    case 'legacy-markers':
      return `${path} carries pre-0.6.0 markers. \`rcf doctor --fix\` migrates the block to the new markers and canonical text.`;
    case 'orphan-marker':
      return `orphan managed-block marker in ${path}. Repair by hand: pair the marker or remove the corrupted region, then re-run \`rcf doctor --fix\`.`;
    case 'duplicate-block':
      return `${path} contains more than one managed-block pair. Repair by hand: remove the stale pair, then re-run \`rcf doctor --fix\`.`;
    default:
      return `${path}: ${state}.`;
  }
}

/**
 * Detect whether a legacy-markers file's inner content diverges from
 * the pre-0.6.0 canonical fragment. Since we do not bundle the old
 * fragment, we use a size heuristic (legacy fragment shipped ~130 lines
 * of prose) plus a content marker check: if the inner content is
 * shorter than ~5000 chars and does not obviously start with `## RCF`,
 * or if it contains custom lines that were never in any shipped
 * fragment, we treat it as hand-edited and warn.
 *
 * The precise-legacy-canonical comparison is deliberately not attempted
 * in v1: the shipped fragment changed multiple times across 0.4.x, and
 * a false-negative "yes it matches" would silently destroy edits. Err
 * on the side of warning; --force lets the operator accept.
 */
function detectLegacyHandEdits(fileText) {
  const inner = extractLegacyInner(fileText);
  if (inner === null) return false;
  const trimmed = inner.trim();
  // The pre-0.6.0 shipped fragment opens with `## RCF` and is ~130
  // lines. Anything shorter than 500 chars is almost certainly a
  // hand-edited stub, and anything that does not start with `## RCF`
  // is not the canonical opener.
  if (trimmed.length < 500) return true;
  if (!trimmed.startsWith('## RCF')) return true;
  // Look for common hand-edited signals: `## PR convention` custom
  // sections, `TODO:` reminders operators sometimes leave.
  if (/^##\s+(PR convention|Notes|Team)/mi.test(trimmed)) return true;
  return false;
}

function extractLegacyInner(fileText) {
  const beginAt = fileText.indexOf(LEGACY_MARKER_BEGIN);
  if (beginAt < 0) return null;
  const innerStart = beginAt + LEGACY_MARKER_BEGIN.length;
  const endAt = fileText.indexOf(LEGACY_MARKER_END, innerStart);
  if (endAt < 0) return null;
  return fileText.slice(innerStart, endAt);
}

/* ------------------------------------------------------------------ */
/* Check: gitignore                                                   */
/* ------------------------------------------------------------------ */

async function runGitignoreCheck(ctx) {
  const drift = [];
  const writes = [];
  const path = join(ctx.projectRoot, '.gitignore');
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      drift.push({
        item: 'missing-file',
        file: '.gitignore',
        message: 'no .gitignore in project root. `rcf doctor --fix` creates it with only the managed block.',
        refusedByFix: false,
      });
      if (ctx.fix) {
        await writeFile(path, composeGitignoreBlock(), 'utf8');
        writes.push({ file: '.gitignore', action: 'created' });
      }
      return { drift, writes };
    }
    throw err;
  }
  const beginCount = countOccurrencesLocal(text, GITIGNORE_MARKER_BEGIN);
  const endCount = countOccurrencesLocal(text, GITIGNORE_MARKER_END);
  if (beginCount >= 2 && endCount >= 2) {
    drift.push({
      item: 'duplicate-block',
      file: '.gitignore',
      message: '.gitignore contains more than one managed-block pair. Repair by hand: remove the stale pair, then re-run.',
      refusedByFix: true,
    });
    return { drift, writes };
  }
  if (beginCount !== endCount) {
    drift.push({
      item: 'orphan-marker',
      file: '.gitignore',
      message: 'orphan managed-block marker in .gitignore. Repair by hand: pair the marker or remove the corrupted region.',
      refusedByFix: true,
    });
    return { drift, writes };
  }
  if (beginCount === 0) {
    drift.push({
      item: 'missing-block',
      file: '.gitignore',
      message: '.gitignore has no managed block. `rcf doctor --fix` appends one at end of file.',
      refusedByFix: false,
    });
    if (ctx.fix) {
      const composed = composeGitignoreBlock();
      const sep = text.length === 0 ? '' : (text.endsWith('\n') ? '\n' : '\n\n');
      const next = `${text}${sep}${composed}`;
      await writeFile(path, next, 'utf8');
      writes.push({ file: '.gitignore', action: 'appended' });
    }
    return { drift, writes };
  }
  const located = extractGitignoreBlock(text);
  if (!located) {
    // Shouldn't happen given the counts above, but guard defensively.
    drift.push({
      item: 'orphan-marker',
      file: '.gitignore',
      message: 'orphan managed-block marker in .gitignore.',
      refusedByFix: true,
    });
    return { drift, writes };
  }
  const innerHash = hashInnerContent(located.innerText);
  const expected = computeGitignoreBlockHash();
  if (innerHash === expected) {
    return { drift, writes };
  }
  drift.push({
    item: 'stale-hash',
    file: '.gitignore',
    message: '.gitignore managed block does not match the current aggregator output. `rcf doctor --fix` rewrites it.',
    refusedByFix: false,
  });
  if (ctx.fix) {
    const composed = composeGitignoreBlock();
    const next = text.slice(0, located.beginIndex) + composed + text.slice(located.endIndex);
    await writeFile(path, next, 'utf8');
    writes.push({ file: '.gitignore', action: 'replaced' });
  }
  return { drift, writes };
}

function countOccurrencesLocal(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let i = 0;
  while (true) {
    const at = haystack.indexOf(needle, i);
    if (at < 0) return count;
    count += 1;
    i = at + needle.length;
  }
}

/* ------------------------------------------------------------------ */
/* Check: knowledge                                                   */
/* ------------------------------------------------------------------ */

async function runKnowledgeCheck(ctx) {
  const drift = [];
  const paths = knowledgePaths(ctx.projectRoot);
  const rootExists = await pathExists(paths.dir);
  if (!rootExists) {
    drift.push({
      item: 'missing-directory',
      file: 'rcf/knowledge/',
      message: 'rcf/knowledge/ is missing (0.6.0 convention). Run `rcf init` to seed it, or create the directory by hand.',
      refusedByFix: true,
    });
    return { drift, writes: [] };
  }
  const notesExists = await pathExists(join(paths.dir, 'notes'));
  const docsExists = await pathExists(join(paths.dir, 'docs'));
  if (!notesExists) {
    drift.push({
      item: 'missing-subdir',
      file: 'rcf/knowledge/notes/',
      message: 'rcf/knowledge/notes/ is missing. Run `rcf init` to re-seed, or create the directory by hand.',
      refusedByFix: true,
    });
  }
  if (!docsExists) {
    drift.push({
      item: 'missing-subdir',
      file: 'rcf/knowledge/docs/',
      message: 'rcf/knowledge/docs/ is missing. Run `rcf init` to re-seed, or create the directory by hand.',
      refusedByFix: true,
    });
  }
  return { drift, writes: [] };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return false;
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Check: identity                                                    */
/* ------------------------------------------------------------------ */

async function runIdentityCheck(ctx) {
  const drift = [];
  const path = identityProfilePath(ctx.projectRoot);
  const profileExists = await pathExists(path);
  if (!profileExists) {
    drift.push({
      item: 'missing-file',
      file: 'rcf/.identity/profile.md',
      message: 'optional; profile.md is the recommended template but not required. Run `rcf init` to seed it, or create it by hand.',
      refusedByFix: true,
    });
  }
  const ignored = await isPathIgnored(ctx.projectRoot);
  if (profileExists && !ignored) {
    drift.push({
      item: 'gitignore-mismatch',
      file: 'rcf/.identity/',
      message: '`rcf/.identity/` is not gitignored; the profile may be exposed. Check your `.gitignore`.',
      refusedByFix: true,
    });
  }
  return { drift, writes: [] };
}

/**
 * Coarse effective-ignore check: does the project's .gitignore contain
 * a line that matches `rcf/.identity/`? We look inside the managed
 * block first (the expected home) and then scan any operator-owned
 * lines. Real git semantics are more subtle (later-match wins,
 * unignore patterns, .git/info/exclude); doctor's job here is to warn
 * on the common case, and the AC-4.3 test uses `git check-ignore` for
 * the definitive assertion. If any registered aggregator entry with
 * path `rcf/.identity/` appears anywhere in the .gitignore text and
 * there is no bare `!rcf/.identity/` unignore, we treat it as ignored.
 */
async function isPathIgnored(projectRoot) {
  try {
    const text = await readFile(join(projectRoot, '.gitignore'), 'utf8');
    const wantsIgnored = managedGitignoreEntries()
      .some((e) => e.path === 'rcf/.identity/')
      || false;
    const lines = text.split('\n').map((l) => l.trim());
    const ignored = lines.includes('rcf/.identity/');
    const unignored = lines.includes('!rcf/.identity/') || lines.includes('!rcf/.identity/*');
    return wantsIgnored && ignored && !unignored;
  } catch {
    return false;
  }
}

// Silence unused-import warnings for values consumed only via names.
void composeGitignoreInner;
