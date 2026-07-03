// `rcf validate` subcommand handler. Wraps walker + validator + broken-
// reference machinery. Exits 0 clean, 2 on usage failure, 3 on validation
// or broken-references. Phase 4 §D3.

import { parseArgs } from 'node:util';

import { formatErrors } from '../errors/index.js';
import { walkTree } from '../store/index.js';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
  quiet: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
};

const HELP = `Usage: rcf validate [options]

Options:
  --quiet                   Only summary line + first 3 issues
  --json                    Emit machine-readable envelope
  --help                    Print this help
`;

/**
 * @param {string[]} argv - argv slice after `validate`
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
  if (flags.help) {
    stdout.write(HELP);
    return 0;
  }
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }
  const { errors } = await walkTree({ projectRoot });
  if (flags.json) {
    const issues = errors.map((e) => ({
      id: e.documentId ?? null,
      kind: e.kind,
      rule: e.rule ?? null,
      filePath: e.filePath ?? null,
      field: e.field ?? null,
      message: e.message,
    }));
    stdout.write(`${JSON.stringify({ ok: errors.length === 0, issues }, null, 2)}\n`);
    return errors.length === 0 ? 0 : 3;
  }
  if (errors.length === 0) {
    if (!flags.quiet) stdout.write('rcf validate: tree is clean.\n');
    return 0;
  }
  if (flags.quiet) {
    const first = errors.slice(0, 3);
    stderr.write(`${formatErrors(first, { verbose: false, strict: false })}\n`);
    if (errors.length > 3) stderr.write(`... ${errors.length - 3} more issue(s) suppressed by --quiet\n`);
  } else {
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
  }
  return 3;
}
