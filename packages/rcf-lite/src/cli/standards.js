// `rcf standards <verb>` — Phase 1 landing (add | list).

import { parseArgs } from 'node:util';

import { isRcfError } from '#core/errors';
import { walkTree } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import { listStandards, registerStandardsPack } from '../blueprint/index.js';

export const HELP = `Usage: rcf define standards <verb> [options]

Verbs:
  add <source>           Register a standards pack against the project.
                         Reference-by-default: if <source> lives inside
                         the project root, the pack is referenced in place
                         and no copy is written. If <source> lives OUTSIDE
                         the project root, the pack is copied into
                         rcf/standards/<slug>/ so the tree stays portable.
  list                   List every registered standards pack.

Options (for add):
  --slug <slug>              Required. Kebab slug for this pack.
  --tags <t1,t2,...>         Required. Comma-separated tag vocabulary.
  --summary <string>         Optional short summary read by the selective-
                             retrieval step alongside the tags.
  --tests-provided-by <val>  Required. One of: standard | agent | none.
  --provenance <val>         Required. One of: personal | corporate.
  --dry-run                  Print intended writes without executing.
  --quiet                    Suppress non-error stdout.
  --help                     Print this help.
`;

const OPTION_SPEC = {
  slug: { type: 'string' },
  tags: { type: 'string' },
  summary: { type: 'string' },
  'tests-provided-by': { type: 'string' },
  provenance: { type: 'string' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

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
    for (const e of errors) stderr.write(`[tree] ${e.kind}: ${e.message}\n`);
    return 2;
  }

  if (verb === 'add') {
    if (rest.length === 0) {
      stderr.write('[error] standards add: missing <source>\n');
      return 2;
    }
    if (!parsed.values.slug || !parsed.values.tags || !parsed.values['tests-provided-by'] || !parsed.values.provenance) {
      stderr.write('[error] standards add: --slug, --tags, --tests-provided-by and --provenance are required\n');
      return 2;
    }
    const result = await registerStandardsPack({
      projectRoot, tree,
      sourcePath: rest[0],
      slug: parsed.values.slug,
      tags: parsed.values.tags.split(',').map((t) => t.trim()).filter(Boolean),
      summary: parsed.values.summary,
      testsProvidedBy: parsed.values['tests-provided-by'],
      provenance: parsed.values.provenance,
      dryRun: parsed.values['dry-run'] === true,
    });
    if (isRcfError(result)) {
      stderr.write(`[error] standards add: ${result.message}\n`);
      return 2;
    }
    if (!parsed.values.quiet) {
      const shape = result.copyPath ? `copied to ${result.copyPath}` : `referenced in place at ${result.entry.sourcePath}`;
      const state = result.alreadyRegistered ? 'already registered (no change)' : 'registered';
      stdout.write(`[standards] '${result.entry.slug}' ${state} (${shape}).\n`);
    }
    return 0;
  }

  if (verb === 'list') {
    const rows = listStandards(tree);
    if (rows.length === 0) {
      if (!parsed.values.quiet) stdout.write('[standards] no standards packs registered on this project.\n');
      return 0;
    }
    for (const row of rows) {
      const shape = row.copyPath ? 'copied' : 'referenced';
      stdout.write(`${row.slug}\t${row.testsProvidedBy}\t${row.provenance}\t${shape}\t${(row.tags ?? []).join(',')}\n`);
    }
    return 0;
  }

  stderr.write(`[error] standards: unknown verb '${verb}'\n`);
  stderr.write(HELP);
  return 2;
}
