// `rcf update <id>` subcommand handler. Parses --set dot-path lists into
// a patch array, optionally deep-merges a --from-file body, and calls
// writer.updateDocument. Phase 4 §D8 (with inline-id + root-singleton
// support).

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { isRcfError } from '../errors/index.js';
import { formatErrors } from '../errors/index.js';
import { updateDocument, walkTree } from '../store/index.js';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
  set: { type: 'string', multiple: true },
  'from-file': { type: 'string' },
  json: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

const HELP = `Usage: rcf update <id> [options]

Options:
  --set <dotPath>=<value>   Set a field; repeatable
  --from-file <path>        Merge body fields from a JSON file
                            (deep merge; arrays replace)
  --json                    Parse --set values as JSON (default: string)
  --dry-run                 Print intended writes without executing
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

/**
 * @param {string[]} argv - argv slice after `update`
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
    stderr.write('[error] usage update: expected exactly one <id>\n');
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
  if (walkResult.errors.length > 0) {
    stderr.write(`${formatErrors(walkResult.errors, { verbose: false, strict: false })}\n`);
    return 3;
  }

  const sets = [];
  const useJson = Boolean(flags.json);
  for (const rawSet of flags.set ?? []) {
    const eq = rawSet.indexOf('=');
    if (eq < 0) {
      stderr.write(`[error] usage update: bad --set '${rawSet}' (expected <path>=<value>)\n`);
      return 2;
    }
    const path = rawSet.slice(0, eq);
    const raw = rawSet.slice(eq + 1);
    let value = raw;
    if (useJson) {
      try { value = JSON.parse(raw); } catch (err) {
        stderr.write(`[error] usage update: --json parse failed on '${raw}': ${err.message}\n`);
        return 2;
      }
    }
    sets.push({ path, value });
  }
  let patch = null;
  if (flags['from-file']) {
    try {
      patch = JSON.parse(await readFile(flags['from-file'], 'utf8'));
    } catch (err) {
      stderr.write(`[error] usage update: cannot read --from-file: ${err.message}\n`);
      return 2;
    }
  }
  if (sets.length === 0 && !patch) {
    stderr.write('[error] usage update: at least one --set or --from-file is required\n');
    return 2;
  }
  const result = await updateDocument({
    projectRoot, tree: walkResult.tree, id, patch, sets,
    options: { dryRun: Boolean(flags['dry-run']) },
  });
  if (isRcfError(result)) return handleWriterError(result, stderr);
  if (flags['dry-run']) {
    if (!flags.quiet) stdout.write(`[dry-run] would update ${result.id} at ${result.filePath}\n`);
    return 0;
  }
  if (!flags.quiet) stdout.write(`${result.id} updated at ${result.filePath}\n`);
  return 0;
}

function handleWriterError(err, stderr) {
  const kind = err.kind;
  stderr.write(`[error] ${kind} ${err.message}\n`);
  if (kind === 'usage') return 2;
  if (kind === 'validation' || kind === 'brokenReference') return 3;
  if (kind === 'ioFailure') return 1;
  return 1;
}
