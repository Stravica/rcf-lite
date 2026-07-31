// `rcf req-classify <req-id>` subcommand handler
// (elicitation-and-playbook-hardening-0.7.0-spec §4.4).
//
// Reruns the REQ-shape classifier for one REQ (or all REQs when
// --all is passed) and writes the resulting shapeClassification block
// back onto the REQ. Useful after the pattern-set version bumps or when
// the operator has updated a description and wants to re-check.

import { parseArgs } from 'node:util';

import { formatErrors, writeUnexpectedFailure, rcfError } from '@stravica-ai/rcf-lite-core/errors';
import { walkTree } from '@stravica-ai/rcf-lite-core/store';

import { findProjectRoot } from '../view/index.js';
import { classifyAndPersistReq } from '../req-detection/index.js';

const OPTION_SPEC = {
  all: { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf req-classify <req-id> [options]
       rcf req-classify --all [options]

Rerun the REQ-shape classifier for one requirement (or every requirement
in the tree with --all) and write the resulting shapeClassification
block back onto the REQ.

Reads REQ title, description and rationale plus the parent PRD's intent
and problem as fallback context; matches against the versioned pattern
set in @stravica-ai/rcf-lite-core/patterns/req-shapes and writes shapes,
signals and classifiedAt. Preserves any prior operatorOverride block.

Options:
  --all             Classify every REQ in the tree
  --json            Emit the classification block as JSON on stdout
  --quiet           Suppress non-error confirmations
  --help            Print this help

Exit codes:
  0  success (or nothing to classify)
  2  usage error (unknown id, no project root, bad flags)
  3  validation failure on the merged REQ document
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
  const positionals = parsed.positionals;
  if (flags.help) { stdout.write(HELP); return 0; }

  const useAll = Boolean(flags.all);
  if (useAll && positionals.length > 0) {
    stderr.write('[error] usage req-classify: --all takes no positional\n');
    return 2;
  }
  if (!useAll && positionals.length !== 1) {
    stderr.write('[error] usage req-classify: expected exactly one <req-id> (or --all)\n');
    stderr.write(HELP);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  const walkResult = await walkTree({ projectRoot });
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding - writes are validated against the post-write state (run 'rcf validate' for details)\n`);
  }

  const reqIds = [];
  if (useAll) {
    for (const [id, kind] of walkResult.tree.kindById) {
      if (kind === 'requirement') reqIds.push(id);
    }
    reqIds.sort();
  } else {
    reqIds.push(positionals[0]);
  }

  /** @type {Array<{ reqId: string, block: object|null, changed: boolean }>} */
  const results = [];
  for (const reqId of reqIds) {
    const outcome = await classifyAndPersistReq({
      projectRoot,
      tree: walkResult.tree,
      reqId,
    });
    if (!outcome.ok) {
      stderr.write(`[error] ${outcome.message}\n`);
      return 3;
    }
    results.push({ reqId, block: outcome.block, changed: outcome.changed });
  }

  if (flags.json) {
    stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }
  if (!flags.quiet) {
    for (const r of results) {
      const verdict = r.block?.shapes?.join(', ') || 'none';
      const reason = r.block?.reason ?? 'unknown';
      const state = r.changed ? 'classified' : 'unchanged';
      stdout.write(`${r.reqId}: shapes=[${verdict}] reason=${reason} (${state})\n`);
    }
  }
  return 0;
}

// Silence linter on unused imports where the CLI helper does not need
// the RcfError formatters directly today; they are the canonical import
// surface for future error-path expansion.
void formatErrors; void writeUnexpectedFailure; void rcfError;
