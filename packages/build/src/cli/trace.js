// `rcf trace <id>` subcommand handler. Walks the graph from a pivot
// id in one direction or both. Phase 5 §D8 / §D9.
//
// --forward walks parent-child children + cross-link children (D7).
// --back walks parent-child ancestors only (D8: cross-links are NOT
// traversed by --back). --both emits {pivot, ancestors, descendants}.

import { parseArgs } from 'node:util';

import { formatErrors } from '@stravica-ai/rcf-lite-core/errors';
import { walkTree } from '@stravica-ai/rcf-lite-core/store';
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
  // Phase 10 (X2 CodeNode bridge): extend a forward/both trace into the
  // code layer. A backward trace from a <path> reaches code automatically.
  'to-code': { type: 'boolean' },
};

const HELP = `Usage: rcf trace <id|path> [options]

Walk the graph from <id> forward (descendants), backward (ancestors),
or both. Default is --forward. When <id> is not a known document id, it
is tried as a source path (optionally #symbol-suffixed) and traced
backward from the matching Code Node(s) up to the root PRD / TAD / BS.

Options:
  --forward                 Walk descendants (default)
  --back                    Walk ancestors up to the root PRD / TAD / BS
  --both                    Emit ancestors + descendants around <id>
  --format <format>         table (default) | json | mermaid
  --to-code                 Extend the forward fan-out into Code Nodes
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
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
    return 3;
  }

  const includeCode = Boolean(flags['to-code']);

  // Phase 10 (X2 CodeNode bridge): path mode. If the positional is not a
  // known document id, try resolving it as a source path to one or more
  // Code Nodes, then trace each backward (path -> CN -> AC -> US -> REQ ->
  // PRD). This is the `rcf trace <path>` blast-radius-from-code query.
  if (!kindOf(tree, id)) {
    const cnIds = resolveCodeNodesForPath(tree, id);
    if (cnIds.length === 0) {
      stderr.write(`[error] usage trace: id ${id} not found (no document or code node matches)\n`);
      return 2;
    }
    const chunks = [];
    for (const cnId of cnIds) {
      const cn = tree.byId.get(cnId);
      const res = computeTrace(tree, { id: cnId, direction: 'back' });
      let out;
      if (format === 'json') out = formatJson(res, 'trace');
      else if (format === 'mermaid') out = formatMermaid(res, 'trace');
      else out = `# ${cnId}  (${cn?.path ?? '?'})\n${formatTable(res, 'trace')}`;
      chunks.push(out);
    }
    stdout.write(chunks.join('\n'));
    return 0;
  }

  const result = computeTrace(tree, { id, direction, includeCode });

  let output;
  if (format === 'json') output = formatJson(result, 'trace');
  else if (format === 'mermaid') output = formatMermaid(result, 'trace');
  else output = formatTable(result, 'trace');
  stdout.write(output);
  return 0;
}

/**
 * Phase 10: resolve a source-path query to Code Node ids. Matches a CN
 * when its `path` equals the query (file-level or file#symbol form) or
 * when the query names the file that a symbol-level CN lives in.
 *
 * @param {object} tree - walker TreeModel
 * @param {string} query - a repo-relative path, optionally #symbol-suffixed
 * @returns {string[]} matching CN ids, sorted
 */
function resolveCodeNodesForPath(tree, query) {
  const out = [];
  for (const cn of tree.codeNodes ?? []) {
    const cnPath = cn.path ?? '';
    const cnFile = cnPath.split('#')[0];
    if (cnPath === query || cnFile === query) out.push(cn.cnId);
  }
  return out.sort();
}
