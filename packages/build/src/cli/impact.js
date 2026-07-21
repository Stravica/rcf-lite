// `rcf impact <id>` subcommand handler. Reports "if this id changes,
// what should we re-verify / re-approve". Phase 5 §D7.
//
// Impact = trace-forward (down to test-leaves) + trace-back (up to
// root PRD / TAD / BS) + a labelled `actionNeeded` column per node,
// driven by static (kind, role) rules per D7.

import { parseArgs } from 'node:util';

import { formatErrors } from '@stravica-ai/rcf-lite-core/errors';
import { walkTree } from '@stravica-ai/rcf-lite-core/store';
import { findProjectRoot } from '../view/index.js';
import {
  computeImpact,
  formatJson,
  formatMermaid,
  formatTable,
  kindOf,
} from '../query/index.js';

const OPTION_SPEC = {
  format: { type: 'string' },
  help: { type: 'boolean' },
  // Phase 10 (X2 CodeNode bridge): extend the forward fan-out into the code
  // layer (AC -> implementing Code Nodes -> transitively dependent CNs).
  'to-code': { type: 'boolean' },
};

const HELP = `Usage: rcf impact <id> [options]

Report the fan-out for 'if <id> changes'. Emits ancestors (up to the
root PRD / TAD / BS) plus descendants (down to test-leaves) with a
per-node action label:
  re-run          test needs to be re-executed
  re-verify       suite ownership; check whether the change invalidates
  re-approve      the AC or PRD approval scope needs re-signing
  review-scope    US / REQ scope needs re-checking
  review-arch     TAD architectural context needs revisiting
  review-plan     BS build queue may need re-ordering
  re-execute      FBS delivery re-runs against updated AC
  review-context  TAC / ADR referenced by an affected FBS
  re-verify-code  code node reached from a spec change (--to-code)

Options:
  --format <format>         table (default) | json | mermaid
  --to-code                 Extend the forward fan-out into Code Nodes
  --help                    Print this help
`;

const VALID_FORMATS = new Set(['table', 'json', 'mermaid']);

/**
 * @param {string[]} argv - argv slice after `impact`
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

  const format = flags.format ?? 'table';
  if (!VALID_FORMATS.has(format)) {
    stderr.write(`[error] usage impact: unknown --format ${format} (expected table | json | mermaid)\n`);
    return 2;
  }

  if (positionals.length === 0) {
    stderr.write('[error] usage impact: expected exactly one <id>\n');
    stderr.write(HELP);
    return 2;
  }
  if (positionals.length > 1) {
    stderr.write('[error] usage impact: multiple positional ids are not supported\n');
    return 2;
  }
  const id = positionals[0];
  if (id.includes('*') || id.includes('?')) {
    stderr.write('[error] usage impact: wildcard / glob positional not supported\n');
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
    return 3;
  }

  if (!kindOf(tree, id)) {
    stderr.write(`[error] usage impact: id ${id} not found\n`);
    return 2;
  }

  const result = computeImpact(tree, { id, includeCode: Boolean(flags['to-code']) });

  let output;
  if (format === 'json') output = formatJson(result, 'impact');
  else if (format === 'mermaid') output = formatMermaid(result, 'impact');
  else output = formatTable(result, 'impact');
  stdout.write(output);
  return 0;
}
