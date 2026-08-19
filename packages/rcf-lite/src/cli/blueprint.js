// `rcf blueprint <verb>` — Phase 1 landing (add | list | remove).
// Upgrade is deferred to Phase 3 iteration alongside SPA+REST conflict
// ergonomics (design-brief.md v2 §Depth for v1, prototype-unknown #1).

import { parseArgs } from 'node:util';

import { isRcfError } from '#core/errors';
import { walkTree } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import { applyBlueprint, listBlueprints, removeBlueprint } from '../blueprint/index.js';
import { renderConflictReport } from '../blueprint/conflicts.js';

export const HELP = `Usage: rcf blueprint <verb> [options]

Verbs:
  add <source>           Apply a blueprint from a source directory
                         (Phase 1: local path; the registry / git-ref
                         resolver is a Phase 2 concern). Writes an entry
                         to manifest.blueprints[] and copies namespaced
                         contributions into the tree.
  list                   List every applied blueprint (slug, version,
                         appliedAt, contributionCount).
  remove <slug>          Remove an applied blueprint. Refuses when any
                         project-authored doc references a contribution
                         id; prints the referring docs and exits 3.

Options:
  --namespace <slug>     Override the blueprint's default namespace
                         (defaults to the blueprint's slug).
  --dry-run              Print intended writes without executing.
  --quiet                Suppress non-error stdout.
  --help                 Print this help.

Composition and namespacing:

  Blueprint-contributed doc ids are namespaced by the blueprint's slug.
  REQ / US / PRD / BS / TAD / TS: slug PREFIX (spa-REQ-001).
  ADR / TAC / FBS / CN: slug SUFFIX (ADR-005-spa).
  Two blueprints both contributing a scope:global ADR on the same topic
  is a genuine conflict: rcf blueprint add exits non-zero and prints
  both sides.
`;

const OPTION_SPEC = {
  namespace: { type: 'string' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

/**
 * @param {string[]} argv - argv slice after `blueprint`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();
  const now = deps.now ?? new Date();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  if (parsed.values.help || parsed.positionals.length === 0) {
    stdout.write(HELP);
    return 0;
  }
  const verb = parsed.positionals[0];
  const rest = parsed.positionals.slice(1);

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] no rcf/ tree found in this directory or any ancestor.\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0 && verb !== 'list') {
    // Tree errors are non-fatal for list; every other verb needs a clean tree.
    for (const e of errors) stderr.write(`[tree] ${e.kind}: ${e.message}\n`);
    return 2;
  }

  if (verb === 'add') {
    if (rest.length === 0) {
      stderr.write('[error] blueprint add: missing <source>\n');
      return 2;
    }
    const source = rest[0];
    const result = await applyBlueprint({
      projectRoot, tree, source,
      namespaceOverride: parsed.values.namespace,
      now,
      dryRun: parsed.values['dry-run'] === true,
    });
    if (isRcfError(result)) {
      stderr.write(`[error] blueprint add: ${result.message}\n`);
      return 2;
    }
    if (result.conflicts && result.conflicts.length > 0) {
      stderr.write(renderConflictReport(result.conflicts));
      return 3;
    }
    if (result.alreadyApplied) {
      if (!parsed.values.quiet) stdout.write(`[blueprint] '${result.slug}' already applied at ${result.version}; no changes.\n`);
      return 0;
    }
    if (!parsed.values.quiet) {
      stdout.write(`[blueprint] applied '${result.slug}' at ${result.version} (${result.contributions.length} contribution(s)).\n`);
    }
    return 0;
  }

  if (verb === 'list') {
    const rows = listBlueprints(tree);
    if (rows.length === 0) {
      if (!parsed.values.quiet) stdout.write('[blueprint] no blueprints applied on this project.\n');
      return 0;
    }
    for (const row of rows) {
      stdout.write(`${row.slug}\t${row.version}\t${row.appliedAt}\t${row.contributionCount} contribution(s)\n`);
    }
    return 0;
  }

  if (verb === 'remove') {
    if (rest.length === 0) {
      stderr.write('[error] blueprint remove: missing <slug>\n');
      return 2;
    }
    const slug = rest[0];
    const result = await removeBlueprint({
      projectRoot, tree, slug, dryRun: parsed.values['dry-run'] === true,
    });
    if (isRcfError(result)) {
      stderr.write(`[error] blueprint remove: ${result.message}\n`);
      return 2;
    }
    if (!result.removed) {
      stderr.write(`[blueprint] remove refused: ${result.referringDocs.length} referring doc(s):\n`);
      for (const r of result.referringDocs) {
        stderr.write(`  ${r.docId} references ${r.matchedId}\n`);
      }
      stderr.write('resolve by unbinding the references, then re-run.\n');
      return 3;
    }
    if (!parsed.values.quiet) stdout.write(`[blueprint] removed '${result.slug}' (${result.deletedPaths.length} file(s) deleted).\n`);
    return 0;
  }

  stderr.write(`[error] blueprint: unknown verb '${verb}'\n`);
  stderr.write(HELP);
  return 2;
}
