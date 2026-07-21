// `rcf link` / `rcf unlink` verb (Phase 4 §D19). Idempotent append/remove
// of TAC ids on a US's `tacIds[]`. Depends on `@stravica-ai/rcf-schemas`
// having `US.tacIds[]` defined (0.2.1+).

import { parseArgs } from 'node:util';

import { isRcfError } from '../errors/index.js';
import { updateDocument, walkTree } from '../store/index.js';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
  tac: { type: 'string', multiple: true },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

/**
 * @param {string[]} argv - argv slice after `link`
 * @param {object} deps
 * @param {boolean} deps.remove - false for link, true for unlink
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();
  const removing = Boolean(deps.remove);

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(help(removing));
    return 2;
  }
  const flags = parsed.values;
  const positionals = parsed.positionals;
  if (flags.help) { stdout.write(help(removing)); return 0; }
  if (positionals.length !== 1) {
    stderr.write(`[error] usage ${removing ? 'unlink' : 'link'}: expected exactly one <us-id>\n`);
    return 2;
  }
  const usId = positionals[0];
  const tacIds = flags.tac ?? [];
  if (tacIds.length === 0) {
    stderr.write(`[error] usage ${removing ? 'unlink' : 'link'}: at least one --tac is required\n`);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }
  const walkResult = await walkTree({ projectRoot });
  // B5: pre-existing tree breakage no longer blocks write verbs - the
  // write is gated on the POST-write tree state inside the writer.
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding - writes are validated against the post-write state (run 'rcf validate' for details)\n`);
  }
  const us = walkResult.tree.byId.get(usId);
  if (!us || walkResult.tree.kindById.get(usId) !== 'userStory') {
    stderr.write(`[error] usage ${removing ? 'unlink' : 'link'}: ${usId} is not an existing US\n`);
    return 2;
  }
  for (const tacId of tacIds) {
    if (walkResult.tree.kindById.get(tacId) !== 'tac') {
      stderr.write(`[error] brokenReference ${removing ? 'unlink' : 'link'}: ${tacId} is not an existing TAC\n`);
      return 3;
    }
  }
  const current = new Set(us.tacIds ?? []);
  const target = new Set(current);
  for (const tacId of tacIds) {
    if (removing) target.delete(tacId); else target.add(tacId);
  }
  const next = [...target].sort();
  const changed = next.length !== current.size || next.some((id, i) => id !== [...current].sort()[i]);
  if (!changed) {
    if (!flags.quiet) stdout.write(`${usId} tacIds already at target state (idempotent no-op).\n`);
    return 0;
  }
  const result = await updateDocument({
    projectRoot,
    tree: walkResult.tree,
    id: usId,
    patch: next.length === 0 ? { tacIds: [] } : { tacIds: next },
    sets: [],
    options: { dryRun: Boolean(flags['dry-run']) },
    walkErrors: walkResult.errors,
  });
  if (isRcfError(result)) {
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    if (result.kind === 'validation' || result.kind === 'brokenReference') return 3;
    return 2;
  }
  if (flags['dry-run']) {
    if (!flags.quiet) stdout.write(`[dry-run] would ${removing ? 'unlink' : 'link'} ${usId} tacIds=${JSON.stringify(next)}\n`);
    return 0;
  }
  if (!flags.quiet) stdout.write(`${usId} tacIds updated (${next.length} entries).\n`);
  return 0;
}

function help(removing) {
  return removing
    ? `Usage: rcf unlink <us-id> --tac <tac-id> [options]\n\nOptions:\n  --tac <tac-id>            TAC id to unlink (repeatable)\n  --dry-run                 Print the intended write without executing\n  --quiet                   Suppress non-error stdout\n  --help                    Print this help\n`
    : `Usage: rcf link <us-id> --tac <tac-id> [options]\n\nOptions:\n  --tac <tac-id>            TAC id to link (repeatable)\n  --dry-run                 Print the intended write without executing\n  --quiet                   Suppress non-error stdout\n  --help                    Print this help\n`;
}
