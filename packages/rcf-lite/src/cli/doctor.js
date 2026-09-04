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
  loadLegacyFragmentHashes,
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
import {
  checkBrowserPresent,
  checkPlaywrightMcpReachable,
  checkPlaywrightPresent,
  findProjectPlaywrightKey,
  FIX_LINES,
  loadBrowserFacingSources,
  probeClaudeCodeMcp,
  SKIP_LINE_NON_BROWSER_FACING,
} from '../setup/playwright-checks.js';

const OPTION_SPEC = {
  fix: { type: 'boolean' },
  check: { type: 'string' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  force: { type: 'boolean' },
  help: { type: 'boolean' },
};

const KNOWN_CHECKS = /** @type {const} */ ([
  'agent-instructions',
  'gitignore',
  'knowledge',
  'identity',
  'playwright-present',
  'browser-present',
  'playwright-mcp-reachable',
  'playwright-mcp-redundant',
  'probe-path-owner',
]);

/** The four Playwright-related checks doctor runs conditionally for
 * browser-facing projects (spec 2026-09-03, section 3). */
const PLAYWRIGHT_CHECKS = /** @type {const} */ ([
  'playwright-present',
  'browser-present',
  'playwright-mcp-reachable',
]);

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
                                    knowledge, identity, playwright-present,
                                    browser-present, playwright-mcp-reachable,
                                    playwright-mcp-redundant, probe-path-owner.
  --json                    Emit machine-readable envelope: { ok, drift, writes, notices }.
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
  // §7.3 fail-safe hand-edit detector: any legacy inner content whose
  // hash is NOT in this whitelist is treated as hand-edited (warn on
  // TTY, refuse without --force on non-TTY). A missing / malformed
  // whitelist is a distinct error class so doctor never quietly falls
  // back to a permissive heuristic.
  const legacyFragmentHashes = await loadLegacyFragmentHashes();
  if (!(legacyFragmentHashes instanceof Set)) {
    stderr.write(`[error] ${legacyFragmentHashes.kind} ${legacyFragmentHashes.message}\n`);
    return 1;
  }

  const ctx = {
    projectRoot: cwd,
    canonical,
    canonicalHash,
    legacyFragmentHashes,
    fix: Boolean(flags.fix),
    force: Boolean(flags.force),
    // isTty is deps-injectable for tests; falls back to real stdout.
    isTty: deps.isTty ?? Boolean(stdout.isTTY),
    // Doctor's Playwright-check seams (spec 2026-09-03, section 3). Every
    // probe is injectable so the unit suite runs with none of these tools
    // installed on the runner.
    checkPlaywrightPresentImpl: deps.checkPlaywrightPresent ?? checkPlaywrightPresent,
    checkBrowserPresentImpl: deps.checkBrowserPresent ?? checkBrowserPresent,
    checkPlaywrightMcpReachableImpl:
      deps.checkPlaywrightMcpReachable ?? checkPlaywrightMcpReachable,
    probeClaudeCodeMcpImpl: deps.probeClaudeCodeMcp ?? probeClaudeCodeMcp,
    loadBrowserFacingSourcesImpl:
      deps.loadBrowserFacingSources ?? loadBrowserFacingSources,
    readMcpJsonImpl: deps.readMcpJson ?? defaultReadMcpJson,
  };

  // Section 3.1: browser-facing projection. Computed once; every Playwright
  // check reads the result from ctx rather than re-walking the manifest.
  const browserFacingResult = await ctx.loadBrowserFacingSourcesImpl(cwd);
  ctx.browserFacing = Boolean(browserFacingResult.browserFacing);
  ctx.browserFacingSources = browserFacingResult.sources ?? [];

  /** @type {Array<{check: string, item: string, file: string, message: string, refusedByFix: boolean}>} */
  const drift = [];
  /** @type {Array<{file: string, action: string}>} */
  const writes = [];
  /** @type {string[]} */
  const notices = [];

  // Section 3.4: skip line for the three Playwright checks on non-browser-
  // facing projects. Emitted when at least one of the three is enabled but
  // the project is not browser-facing AND the operator did not explicitly ask
  // for that check by name (spec 3.5). We honour the --check filter by
  // detecting whether the operator explicitly named any playwright check.
  const explicitlyPickedPlaywrightChecks = new Set(
    enabled.filter((c) => PLAYWRIGHT_CHECKS.includes(c)),
  );
  const anyPlaywrightCheckEnabled = explicitlyPickedPlaywrightChecks.size > 0;
  const operatorAskedByName =
    typeof flags.check === 'string'
    && flags.check.length > 0
    && explicitlyPickedPlaywrightChecks.size > 0;
  if (anyPlaywrightCheckEnabled && !ctx.browserFacing && !operatorAskedByName) {
    notices.push(SKIP_LINE_NON_BROWSER_FACING);
  }

  for (const check of enabled) {
    let result;
    if (check === 'agent-instructions') result = await runAgentInstructionsCheck(ctx);
    else if (check === 'gitignore') result = await runGitignoreCheck(ctx);
    else if (check === 'knowledge') result = await runKnowledgeCheck(ctx);
    else if (check === 'identity') result = await runIdentityCheck(ctx);
    else if (PLAYWRIGHT_CHECKS.includes(check)) {
      // Skip the check on non-browser-facing projects unless the operator
      // explicitly asked for this check by name (--check filter): the skip
      // line above is the ground-truth diagnostic in that case (spec 3.4/3.5).
      if (!ctx.browserFacing && !operatorAskedByName) continue;
      if (check === 'playwright-present') result = await runPlaywrightPresentCheck(ctx);
      else if (check === 'browser-present') result = await runBrowserPresentCheck(ctx);
      else if (check === 'playwright-mcp-reachable') result = await runPlaywrightMcpReachableCheck(ctx);
      else continue;
    } else if (check === 'playwright-mcp-redundant') {
      // Fires only on browser-facing projects (spec 4.5). Never runs on an
      // API-only project even under an explicit --check ask.
      if (!ctx.browserFacing) continue;
      result = await runPlaywrightMcpRedundantCheck(ctx);
    } else if (check === 'probe-path-owner') {
      // Fires whenever more than one applied blueprint teaches probe paths.
      // Runs on every project (not gated on browser-facing). Spec:
      // projects/rcf-lite-wsd/specs/rcf-lite-probe-path-alignment-spec-2026-09-04.md section 9.
      result = await runProbePathOwnerCheck(ctx);
    } else continue;
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
    stdout.write(`${JSON.stringify({ ok, drift, writes, notices }, null, 2)}\n`);
    return exitCode;
  }

  // Notices (spec 3.4 skip line) are diagnostic ground truth. Emitted BEFORE
  // the summary so an operator scanning the top of the output sees why the
  // three checks did not fire on a non-browser-facing project. Not
  // suppressed by --quiet.
  for (const notice of notices) stdout.write(`${notice}\n`);
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
        const legacyHasHandEdits = detectLegacyHandEdits(text, ctx.legacyFragmentHashes);
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
 * the pre-0.6.0 canonical fragment as shipped in 0.4.x/0.5.x
 * (§7.3 fail-safe). Hashes the extracted legacy inner content (trimmed,
 * matching `writeAgentInstructions`'s pre-0.6.0 write convention: the
 * fragment landed between markers as `\n${fragment}\n`, and the shipped
 * `fragment` was itself `.trim()`-normalised by `loadHarnessFragment`,
 * so the trimmed inner content is exactly the fragment) and checks
 * membership in the shipped whitelist.
 *
 * Fail-safe by default: any hash NOT in the whitelist is treated as
 * hand-edited. Empty whitelist (edge case) means "every legacy block
 * is potentially hand-edited", which is the safer stance. The
 * heuristic-based v0.6.0 draft (`length < 500`, `startsWith('## RCF')`
 * denylist) was fail-open by design — a hand-edit that kept the
 * leading `## RCF`, stayed above the length floor, and did not add one
 * of the three named headers slipped past silently. This replacement
 * inverts the safety profile so unknown content requires explicit
 * `--force` in non-interactive mode.
 *
 * @param {string} fileText
 * @param {Set<string>} legacyFragmentHashes - whitelist loaded via loadLegacyFragmentHashes.
 * @returns {boolean}
 */
function detectLegacyHandEdits(fileText, legacyFragmentHashes) {
  const inner = extractLegacyInner(fileText);
  if (inner === null) return false;
  const innerHash = hashInnerContent(inner);
  return !legacyFragmentHashes.has(innerHash);
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

/* ------------------------------------------------------------------ */
/* Check: playwright-present (spec 3.3)                               */
/* ------------------------------------------------------------------ */

async function runPlaywrightPresentCheck(ctx) {
  const drift = [];
  const result = ctx.checkPlaywrightPresentImpl(ctx.projectRoot);
  if (!result.ok) {
    drift.push({
      item: 'missing-peer',
      file: 'package.json',
      message: FIX_LINES['playwright-present'],
      refusedByFix: true,
    });
  }
  return { drift, writes: [] };
}

/* ------------------------------------------------------------------ */
/* Check: browser-present (spec 3.3)                                  */
/* ------------------------------------------------------------------ */

async function runBrowserPresentCheck(ctx) {
  const drift = [];
  const result = await ctx.checkBrowserPresentImpl();
  if (!result.ok) {
    drift.push({
      item: 'no-browser',
      file: '(system)',
      message: FIX_LINES['browser-present'],
      refusedByFix: true,
    });
  }
  return { drift, writes: [] };
}

/* ------------------------------------------------------------------ */
/* Check: playwright-mcp-reachable (spec 3.3)                         */
/* ------------------------------------------------------------------ */

async function runPlaywrightMcpReachableCheck(ctx) {
  const drift = [];
  const result = await ctx.checkPlaywrightMcpReachableImpl();
  if (!result.ok) {
    drift.push({
      item: result.timedOut ? 'unreachable-timeout' : 'unreachable',
      file: '(npx @playwright/mcp)',
      message: FIX_LINES['playwright-mcp-reachable'],
      refusedByFix: true,
    });
  }
  return { drift, writes: [] };
}

/* ------------------------------------------------------------------ */
/* Check: playwright-mcp-redundant (spec 4.5)                         */
/* ------------------------------------------------------------------ */

async function runPlaywrightMcpRedundantCheck(ctx) {
  const drift = [];
  const mcpJson = await ctx.readMcpJsonImpl(ctx.projectRoot);
  const projectKey = mcpJson ? findProjectPlaywrightKey(mcpJson) : null;
  if (!projectKey) return { drift, writes: [] };
  const probeResult = await ctx.probeClaudeCodeMcpImpl();
  if (probeResult.kind !== 'found') return { drift, writes: [] };
  drift.push({
    item: 'redundant-entry',
    file: '.mcp.json',
    message: `project-scope .mcp.json carries a Playwright MCP entry ('${projectKey}') that is also declared at ${probeResult.scope} scope. The project entry shadows the user entry. Remove the project entry with \`rcf init --no-playwright-mcp\` (which re-runs init without writing it), or delete the '${projectKey}' entry from .mcp.json by hand.`,
    refusedByFix: true,
  });
  return { drift, writes: [] };
}

/* ------------------------------------------------------------------ */
/* Check: probe-path-owner (probe-path alignment spec section 9)      */
/* ------------------------------------------------------------------ */

/**
 * Fires when more than one applied blueprint teaches probe paths. Reads
 * `rcf/manifest.json` for the applied-blueprint records; counts how many
 * carry a scope:global ADR on `healthProbes` (the shelf-wide probe-path
 * ownership topic). More than one is drift: names the blueprints and the
 * remedy line naming the one that would have to drop its opinion.
 *
 * Also names any resolutions[] entry the alignment removed as redundant
 * (a project that applied essentials v1.x + probe-endpoints v1.0.0 and
 * resolved the two topics via supersede will have a resolution entry
 * pointing at both blueprint ADRs; after re-applying to essentials v2.0.0
 * the essentials side no longer claims the topic and the resolution is
 * redundant historical context the operator can remove).
 */
async function runProbePathOwnerCheck(ctx) {
  const drift = [];
  const manifestPath = join(ctx.projectRoot, 'rcf', 'manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch { return { drift, writes: [] }; }
  const applied = Array.isArray(manifest?.blueprints) ? manifest.blueprints : [];
  const claimants = { healthProbes: [], readinessSemantics: [] };
  for (const b of applied) {
    for (const c of b?.contributions ?? []) {
      if (c?.kind === 'adr' && c?.scope === 'global' && (c.topic === 'healthProbes' || c.topic === 'readinessSemantics')) {
        claimants[c.topic].push({ slug: b.slug, adrId: c.id });
      }
    }
  }
  for (const topic of ['healthProbes', 'readinessSemantics']) {
    if (claimants[topic].length > 1) {
      const slugs = claimants[topic].map((x) => x.slug).join(', ');
      const owner = claimants[topic].find((x) => x.slug === 'observability-probe-endpoints');
      const remedy = owner
        ? `${claimants[topic].filter((x) => x.slug !== 'observability-probe-endpoints').map((x) => x.slug).join(', ')} would have to drop its scope:global claim on ${topic} (observability-probe-endpoints is the shelf canonical owner from probe-endpoints v1.0.0)`
        : `one of ${slugs} would have to drop its scope:global claim on ${topic}`;
      drift.push({
        item: `multiple-${topic}-owners`,
        file: 'rcf/manifest.json',
        message: `more than one applied blueprint teaches probe paths on topic '${topic}': ${slugs}. ${remedy}. Spec: projects/rcf-lite-wsd/specs/rcf-lite-probe-path-alignment-spec-2026-09-04.md section 9.`,
        refusedByFix: true,
      });
    }
  }
  // Redundant resolutions: a resolutions[] entry that names both
  // `healthProbes` or `readinessSemantics` where the current claimant
  // count is 1 (or 0) is redundant historical context.
  const resolutions = Array.isArray(manifest?.resolutions) ? manifest.resolutions : [];
  for (const r of resolutions) {
    if (r?.topic === 'healthProbes' || r?.topic === 'readinessSemantics') {
      if (claimants[r.topic].length <= 1) {
        drift.push({
          item: `redundant-${r.topic}-resolution`,
          file: 'rcf/manifest.json',
          message: `resolution '${r?.resolvedByAdrId ?? '(unnamed)'}' on topic '${r.topic}' is now redundant historical context: only ${claimants[r.topic].length} applied blueprint claims the topic after the probe-path alignment. Consider \`rcf define blueprint remove-resolution ${r?.resolvedByAdrId ?? '<id>'}\` or leave the resolution ADR as historical.`,
          refusedByFix: true,
        });
      }
    }
  }
  return { drift, writes: [] };
}


/**
 * Default reader for the project-root .mcp.json body. Returns the parsed
 * object, or null on missing / unparseable (doctor treats an unparseable
 * .mcp.json as "no signature findable" rather than a hard refusal here; the
 * merge path in agent-setup already refuses unparseable with exit 2 on write).
 *
 * @param {string} projectRoot
 * @returns {Promise<object|null>}
 */
async function defaultReadMcpJson(projectRoot) {
  const file = join(projectRoot, '.mcp.json');
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
