// `rcf delete <id>` subcommand handler. Refuse-by-default when the doc
// has dependents; --cascade opts in. Orphan-refuse pre-plan check on
// REQ / US / AC cascade paths (Phase 4 §D9 amendment). Phase 4 §D9.

import { parseArgs } from 'node:util';

import { isRcfError, writeUnexpectedFailure } from '../errors/index.js';
import { deleteDocument, walkTree } from '../store/index.js';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
  cascade: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

const HELP = `Usage: rcf delete <id> [options]

Options:
  --cascade                 Also delete dependents and drop backrefs
  --dry-run                 Print the plan without executing
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

/**
 * @param {string[]} argv - argv slice after `delete`
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
  const positionals = parsed.positionals;
  if (flags.help) { stdout.write(HELP); return 0; }
  if (positionals.length !== 1) {
    stderr.write('[error] usage delete: expected exactly one <id>\n');
    stderr.write(HELP);
    return 2;
  }
  const id = positionals[0];

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }
  const walkResult = await walkTree({ projectRoot });
  // B5 (amends the §D9 broken-tree-before-dependents precedence): a
  // broken tree no longer blocks delete - deleting the offending doc is
  // the canonical repair. The writer gates on the POST-write tree state;
  // only net-new breakage refuses.
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding - writes are validated against the post-write state (run 'rcf validate' for details)\n`);
  }

  const result = await deleteDocument({
    projectRoot, tree: walkResult.tree, id,
    options: {
      cascade: Boolean(flags.cascade),
      dryRun: Boolean(flags['dry-run']),
    },
    walkErrors: walkResult.errors,
  });
  if (isRcfError(result)) return handleDeleteError(result, stderr);
  // BUG-005 fix: split the header text between dry-run (future tense,
  // "Would delete …") and executed (past tense, "Deleted …"). Previously
  // both paths shared the future-tense header, making an executed delete
  // visually indistinguishable from a plan at the summary line.
  const dryRun = Boolean(flags['dry-run']);
  const label = dryRun ? '[dry-run] would ' : '';
  if (!flags.quiet) {
    if (dryRun) {
      stdout.write(
        `Would delete ${result.deleted.length} file(s) and mutate ${result.mutated.length} doc(s). (dry-run)\n`,
      );
    } else {
      stdout.write(
        `Deleted ${result.deleted.length} file(s), mutated ${result.mutated.length} doc(s).\n`,
      );
    }
    for (const line of result.plan) stdout.write(`  ${label}${line}\n`);
  }
  return 0;
}

/**
 * `rcfError.kind === 'usage'` from writer.deleteDocument overloads two
 * exit codes: the plain "unknown id / already-clean" cases stay exit 2,
 * while a `rule` of `dependents` / `wouldOrphan` maps to exit 4.
 *
 * BUG-007 fix: `ioFailure` emits the spec §D15 `[rcf] unexpected failure`
 * block (message + stack), not the structured `[error] ioFailure` line.
 *
 * BUG-008 fix: exit-4 refusals are labelled `[error] refused …` so the
 * prefix matches the exit-code semantics, instead of the misleading
 * `[error] usage …` prefix used when the underlying `rcfError.kind`
 * happens to be `usage` with a `dependents` / `wouldOrphan` rule.
 */
function handleDeleteError(err, stderr) {
  const kind = err.kind;
  if (kind === 'ioFailure') {
    writeUnexpectedFailure(err, stderr);
    return 1;
  }
  if (kind === 'usage' && (err.rule === 'dependents' || err.rule === 'wouldOrphan')) {
    stderr.write(`[error] refused ${err.message}\n`);
    return 4;
  }
  stderr.write(`[error] ${kind} ${err.message}\n`);
  if (kind === 'usage') return 2;
  if (kind === 'validation' || kind === 'brokenReference') return 3;
  return 1;
}
