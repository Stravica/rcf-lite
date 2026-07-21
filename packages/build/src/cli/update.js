// `rcf update <id>` subcommand handler. Parses --set dot-path lists into
// a patch array, optionally deep-merges a --from-file body, and calls
// writer.updateDocument. Phase 4 §D8 (with inline-id + root-singleton
// support).

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { isRcfError, writeUnexpectedFailure } from '@stravica-ai/rcf-lite-core/errors';
import { splitCnPath, updateDocument, walkTree } from '@stravica-ai/rcf-lite-core/store';
import { deriveFileDeps, mapDerivedDepsToCnIds } from '@stravica-ai/rcf-lite-core/store/derive-deps.js';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
  set: { type: 'string', multiple: true },
  'from-file': { type: 'string' },
  json: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
  // Phase 10 (X2 CodeNode bridge, D5): re-derive a CN's file-level
  // dependencies via dependency-cruiser, merged into dependencies[].
  'derive-deps': { type: 'boolean' },
};

const HELP = `Usage: rcf update <id> [options]

Options:
  --set <dotPath>=<value>   Set a field; repeatable
  --from-file <path>        Merge body fields from a JSON file
                            (deep merge; arrays replace)
  --json                    Parse --set values as JSON (default: string)
  --dry-run                 Print intended writes without executing
  --quiet                   Suppress non-error stdout
  --derive-deps             CN only: re-derive file-level dependencies via
                            dependency-cruiser and merge into dependencies[]
                            (dev-time assist; never a runtime dependency)
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
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  const walkResult = await walkTree({ projectRoot });
  // B5: pre-existing tree breakage no longer blocks write verbs - the
  // update is gated on the POST-write tree state inside the writer, so
  // repairing a broken doc is exactly what this verb is now for.
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding - writes are validated against the post-write state (run 'rcf validate' for details)\n`);
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
  if (flags['derive-deps']) {
    if (walkResult.tree.kindById.get(id) !== 'codeNode') {
      stderr.write('[error] usage update: --derive-deps only applies to cn ids\n');
      return 2;
    }
    const setPath = sets.find((s) => s.path === 'path')?.value;
    const currentPath = typeof setPath === 'string' ? setPath : walkResult.tree.byId.get(id)?.path;
    const { file } = splitCnPath(currentPath ?? '');
    const derived = await deriveFileDeps({ projectRoot, filePath: file });
    if (!derived.ok) {
      stderr.write(`[error] usage update: --derive-deps: ${derived.message}\n`);
      return 2;
    }
    const { cnIds, unmatched } = mapDerivedDepsToCnIds(walkResult.tree, derived.deps);
    const existing = walkResult.tree.byId.get(id)?.dependencies ?? [];
    const merged = [...new Set([...existing, ...cnIds])].filter((d) => d !== id).sort();
    sets.push({ path: 'dependencies', value: merged });
    if (unmatched.length > 0 && !flags.quiet) {
      stdout.write(`[info] --derive-deps: ${unmatched.length} file-level import(s) have no matching CN yet, skipped: ${unmatched.join(', ')}\n`);
    }
  }
  if (sets.length === 0 && !patch) {
    stderr.write('[error] usage update: at least one --set or --from-file is required\n');
    return 2;
  }
  const result = await updateDocument({
    projectRoot, tree: walkResult.tree, id, patch, sets,
    options: { dryRun: Boolean(flags['dry-run']) },
    walkErrors: walkResult.errors,
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
  // BUG-007 fix: spec §D15 mandates exit-1 emit
  // `[rcf] unexpected failure: <msg>\n<stack>` — even under --quiet.
  if (kind === 'ioFailure') {
    writeUnexpectedFailure(err, stderr);
    return 1;
  }
  stderr.write(`[error] ${kind} ${err.message}\n`);
  if (kind === 'usage') return 2;
  if (kind === 'validation' || kind === 'brokenReference') return 3;
  return 1;
}
