// `rcf review <fbs-id>` subcommand handler
// (verification-integrity-cluster-spec §5.5, §6).
//
// Runs the REVIEW-stage audit (test-theatre + mutation-sampling),
// writes the reviewAudit record to the manifest, and exits with:
//   0 on pass
//   4 on warn or block
//   3 on schema/tree validation failure
//   1 on IO / unexpected runtime failure
//   2 on usage error
//
// The mutation-sampling agent is injected via `deps.mutationRunner`;
// v1 default is a no-op runner that emits a valid schema record with
// a `notes` explaining that no runner was wired. `--skip-mutation`
// records the skip explicitly. `--dry-run` runs the audit without
// writing the record.

import { access, mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { parseArgs } from 'node:util';
import process from 'node:process';

import { rcfError, writeUnexpectedFailure } from '#core/errors';
import { resolveTestPointers, validateDocument, walkTree } from '#core/store';

import { findProjectRoot } from '../view/index.js';
import {
  auditTestTheatre,
  composeReviewAuditRecord,
} from '../review/index.js';
import { auditUiBaselineDrift } from '../review/ui-baseline-drift.js';
import {
  defaultMutationRunner,
  defaultSizing,
  resolveTestCommand,
  skippedMutationRunner,
} from '../review/mutation.js';

const OPTION_SPEC = {
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  'skip-mutation': { type: 'boolean' },
  'test-cmd': { type: 'string' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf review <fbs-id> [options]

Run the REVIEW-stage audit (test-theatre + mutation-sampling) and write
the reviewAudit record to the manifest. Exit 4 on any warn or block
verdict, so the audit is a Stage 3 -> Stage 4 gate.

Options:
  --dry-run                 Run the audit and print findings without
                            writing the reviewAudit record.
  --json                    Emit the composed record to stdout as JSON.
  --skip-mutation           Record that mutation-sampling was skipped
                            without running it; useful when the harness
                            has no runner wired yet. The reviewAudit
                            record still validates.
  --test-cmd <command>      Test command for the mutation-sampling agent
                            (default: manifest.testCommand, else
                            'npm test' when package.json exists).
  --quiet                   Suppress non-error stdout
  --help                    Print this help

Exit codes:
  0  audit passed
  1  IO / unexpected runtime failure
  2  usage error
  3  schema or tree validation refused the write
  4  audit warn or block verdict (Stage 4 refused)
`;

/**
 * @param {string[]} argv
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
  if (flags.help) { stdout.write(HELP); return 0; }
  if (parsed.positionals.length !== 1) {
    stderr.write('[error] usage review: expected exactly one <fbs-id> positional\n');
    return 2;
  }
  const fbsId = parsed.positionals[0];
  if (!/^FBS-\d{3,}$/.test(fbsId)) {
    stderr.write(`[error] usage review: expected an FBS id like FBS-011, got '${fbsId}'\n`);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }

  const walkResult = await walkTree({ projectRoot });
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); the audit proceeds but coverage-drift findings may be noisy\n`);
  }
  const tree = walkResult.tree;
  const fbs = tree.byId.get(fbsId);
  if (!fbs || tree.kindById.get(fbsId) !== 'fbs') {
    stderr.write(`[error] usage review: ${fbsId} not found or not an FBS\n`);
    return 2;
  }

  // Test-pointer resolution feeds the testPointerBroken detector.
  const testPointers = await resolveTestPointers({ projectRoot, tree });
  const findings = auditTestTheatre({ tree, fbs, testPointers });

  // Track B (ui-design-gate-0.7.0-spec §3.4): run the UI-baseline drift
  // audit alongside the Track A test-theatre audit for uiBearing FBS.
  // One brief, one worker, one record per FBS: the same reviewAudit
  // record carries both Track A and Track B kinds (spec §12 O-12).
  const listFiles = deps.listFiles ?? defaultListFiles(projectRoot);
  const uiFindings = await auditUiBaselineDrift({
    projectRoot,
    fbs,
    uiBaseline: tree.manifest?.uiBaseline ?? null,
    listFiles,
  });
  for (const f of uiFindings) findings.push(f);

  // Mutation-sampling.
  let mutationRunner = deps.mutationRunner;
  if (!mutationRunner) mutationRunner = flags['skip-mutation'] ? skippedMutationRunner : defaultMutationRunner;
  const hasPackageJson = await fileExists(join(projectRoot, 'package.json'));
  const { command: testCommand } = resolveTestCommand({
    manifest: tree.manifest, cliFlag: flags['test-cmd'], hasPackageJson,
  });
  const fbsAcIds = new Set(fbs.acIds ?? []);
  const coveringTs = (tree.testSuites ?? []).filter((ts) => (ts.acIds ?? []).some((a) => fbsAcIds.has(a)));
  const runnerInput = {
    fbsId, acIds: fbs.acIds ?? [], testSuites: coveringTs,
    sizing: defaultSizing(), testCommand: testCommand ?? undefined, projectRoot,
  };
  let mutationSampling;
  try {
    const runnerOut = await mutationRunner(runnerInput);
    mutationSampling = runnerOut?.record;
  } catch (err) {
    writeUnexpectedFailure(
      rcfError({ kind: 'ioFailure', message: `review: mutation runner failed: ${err.message}`, stack: err.stack }),
      stderr,
    );
    return 1;
  }

  const record = composeReviewAuditRecord({
    tree, fbs, findings, mutationSampling,
    now: deps.now ? new Date(deps.now()) : new Date(),
  });

  if (flags.json) stdout.write(`${JSON.stringify(record, null, 2)}\n`);

  if (flags['dry-run']) {
    if (!flags.quiet) {
      stdout.write(`[dry-run] review ${fbsId}: ${findings.length} finding(s); verdict=${record.verdict}\n`);
      for (const f of findings) {
        stdout.write(`  [${f.severity}] ${f.kind} ${f.tsId}${f.tcId ? '/' + f.tcId : ''}: ${f.detail}\n`);
      }
    }
    return record.verdict === 'pass' ? 0 : 4;
  }

  // Write the record to the manifest.
  const nextManifest = { ...(tree.manifest ?? {}) };
  const existing = Array.isArray(nextManifest.reviewAudit) ? nextManifest.reviewAudit : [];
  nextManifest.reviewAudit = [...existing, record];
  if (testCommand && nextManifest.testCommand !== testCommand && !nextManifest.testCommand) {
    // Optionally record the resolved testCommand when not already set,
    // so a later re-audit inherits the same resolution without a flag.
    nextManifest.testCommand = testCommand;
  }
  const relPath = 'rcf/manifest.json';
  const validation = validateDocument({ doc: nextManifest, kind: 'manifest', filePath: relPath });
  if (validation) {
    stderr.write(`[error] validation ${validation.message}\n`);
    return 3;
  }
  const absPath = join(projectRoot, 'rcf', 'manifest.json');
  try {
    await mkdir(dirname(absPath), { recursive: true });
    const tmp = `${absPath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    try {
      await rename(tmp, absPath);
    } catch (err) {
      try { await unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    writeUnexpectedFailure(
      rcfError({ kind: 'ioFailure', message: `review: manifest write failed: ${err.message}`, filePath: relPath, stack: err.stack }),
      stderr,
    );
    return 1;
  }
  if (!flags.quiet) {
    stdout.write(`review ${fbsId}: wrote ${record.id} to rcf/manifest.json (${findings.length} findings, verdict=${record.verdict}).\n`);
  }
  return record.verdict === 'pass' ? 0 : 4;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Default file lister used by the UI-baseline drift audit. Walks the
 * project tree once and matches each path against the supplied glob
 * patterns. Supports the `**` suffix (recursive) and `*` mid-path
 * wildcards. Deliberately minimal: the audit's callers pass either
 * `src/ui/**` or `src/routes/**` in v1, so a formal glob library
 * would be scope-creep. Returns project-root-relative paths.
 *
 * @param {string} projectRoot
 * @returns {(patterns: string[]) => Promise<string[]>}
 */
function defaultListFiles(projectRoot) {
  return async (patterns) => {
    const out = new Set();
    for (const raw of Array.isArray(patterns) ? patterns : []) {
      const pattern = String(raw);
      const idx = pattern.indexOf('**');
      let root;
      let recursive;
      let suffix;
      if (idx >= 0) {
        root = pattern.slice(0, Math.max(0, idx - 1));
        recursive = true;
        suffix = pattern.slice(idx + 2).replace(/^\//, '');
      } else if (pattern.includes('*')) {
        const slash = pattern.lastIndexOf('/');
        root = slash >= 0 ? pattern.slice(0, slash) : '.';
        recursive = false;
        suffix = pattern.slice(slash + 1);
      } else {
        // Literal path; include as-is.
        root = pattern;
        recursive = false;
        suffix = '';
      }
      const absRoot = join(projectRoot, root);
      const collected = [];
      await walkDir(absRoot, recursive, collected);
      for (const abs of collected) {
        const rel = relative(projectRoot, abs);
        if (matchesSuffix(rel, suffix)) out.add(rel);
      }
    }
    return [...out];
  };
}

async function walkDir(root, recursive, out) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await walkDir(abs, true, out);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
}

function matchesSuffix(rel, suffix) {
  if (!suffix || suffix.length === 0) return true;
  // Support a single `*` wildcard on the suffix segment.
  const escaped = suffix.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`(?:^|/)${escaped}$`).test(rel);
}
