// `rcf delete <id>` subcommand handler. Refuse-by-default when the doc
// has dependents; --cascade opts in. Orphan-refuse pre-plan check on
// REQ / US / AC cascade paths (Phase 4 §D9 amendment). Phase 4 §D9.

import { parseArgs } from 'node:util';

import { isRcfError } from '../errors/index.js';
import { formatErrors } from '../errors/index.js';
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
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }
  const walkResult = await walkTree({ projectRoot });
  // §D9 precedence: broken-tree (exit 3) before dependents (exit 4).
  if (walkResult.errors.length > 0) {
    stderr.write(`${formatErrors(walkResult.errors, { verbose: false, strict: false })}\n`);
    return 3;
  }

  const result = await deleteDocument({
    projectRoot, tree: walkResult.tree, id,
    options: {
      cascade: Boolean(flags.cascade),
      dryRun: Boolean(flags['dry-run']),
    },
  });
  if (isRcfError(result)) return handleDeleteError(result, stderr);
  const label = flags['dry-run'] ? '[dry-run] would ' : '';
  if (!flags.quiet) {
    stdout.write(`Would delete ${result.deleted.length} file(s) and mutate ${result.mutated.length} doc(s).\n`);
    for (const line of result.plan) stdout.write(`  ${label}${line}\n`);
  }
  return 0;
}

/**
 * `rcfError.kind === 'usage'` from writer.deleteDocument overloads two
 * exit codes: the plain "unknown id / already-clean" cases stay exit 2,
 * while a `rule` of `dependents` / `wouldOrphan` maps to exit 4.
 */
function handleDeleteError(err, stderr) {
  const kind = err.kind;
  stderr.write(`[error] ${kind} ${err.message}\n`);
  if (kind === 'usage') {
    if (err.rule === 'dependents' || err.rule === 'wouldOrphan') return 4;
    return 2;
  }
  if (kind === 'validation' || kind === 'brokenReference') return 3;
  if (kind === 'ioFailure') return 1;
  return 1;
}
