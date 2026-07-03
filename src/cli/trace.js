// `rcf trace <id>` subcommand handler. Walks the graph from a pivot
// id in one direction or both. Phase 5 §D8 / §D9.
//
// --forward walks parent-child children + cross-link children (D7).
// --back walks parent-child ancestors only (D8: cross-links are NOT
// traversed by --back). --both emits {pivot, ancestors, descendants}.

import { parseArgs } from 'node:util';

import { formatErrors } from '../errors/index.js';
import { walkTree } from '../store/index.js';
import { findProjectRoot } from '../view/index.js';
import {
  computeTrace,
  formatJson,
  formatMermaid,
  formatTable,
  kindOf,
} from '../query/index.js';

const OPTION_SPEC = {
  forward: { type: 'boolean' },
  back: { type: 'boolean' },
  both: { type: 'boolean' },
  format: { type: 'string' },
  help: { type: 'boolean' },
};

const HELP = `Usage: rcf trace <id> [options]

Walk the graph from <id> forward (descendants), backward (ancestors),
or both. Default is --forward.

Options:
  --forward                 Walk descendants (default)
  --back                    Walk ancestors up to the root PRD / TAD / BS
  --both                    Emit ancestors + descendants around <id>
  --format <format>         table (default) | json | mermaid
  --help                    Print this help

Notes:
  --forward, --back and --both are mutually exclusive.
  Cross-links are NOT traversed by --back (fan-out is what 'impact' is for).
`;

const VALID_FORMATS = new Set(['table', 'json', 'mermaid']);

/**
 * @param {string[]} argv - argv slice after `trace`
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

  // Direction: default forward; --forward | --back | --both mutually
  // exclusive (spec §D9 test surface).
  const set = ['forward', 'back', 'both'].filter((k) => flags[k]);
  if (set.length > 1) {
    stderr.write('[error] usage trace: --forward, --back and --both are mutually exclusive\n');
    return 2;
  }
  let direction = 'forward';
  if (flags.back) direction = 'back';
  if (flags.both) direction = 'both';

  const format = flags.format ?? 'table';
  if (!VALID_FORMATS.has(format)) {
    stderr.write(`[error] usage trace: unknown --format ${format} (expected table | json | mermaid)\n`);
    return 2;
  }

  if (positionals.length === 0) {
    stderr.write('[error] usage trace: expected exactly one <id>\n');
    stderr.write(HELP);
    return 2;
  }
  if (positionals.length > 1) {
    stderr.write('[error] usage trace: multiple positional ids are not supported\n');
    return 2;
  }
  const id = positionals[0];
  if (id.includes('*') || id.includes('?')) {
    stderr.write('[error] usage trace: wildcard / glob positional not supported\n');
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
    return 3;
  }

  if (!kindOf(tree, id)) {
    stderr.write(`[error] usage trace: id ${id} not found\n`);
    return 2;
  }

  const result = computeTrace(tree, { id, direction });

  let output;
  if (format === 'json') output = formatJson(result, 'trace');
  else if (format === 'mermaid') output = formatMermaid(result, 'trace');
  else output = formatTable(result, 'trace');
  stdout.write(output);
  return 0;
}
