// `rcf validate` subcommand handler. Wraps walker + validator + broken-
// reference machinery. Exits 0 clean, 2 on usage failure, 3 on validation
// or broken-references. Phase 4 §D3.

import { parseArgs } from 'node:util';

import { formatErrors } from '../errors/index.js';
import { checkCodeNodeResolution, walkTree } from '../store/index.js';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
  quiet: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
  // Phase 10 (X2 CodeNode bridge, spec D8): skip the Code Node staleness
  // pass (spec-graph checks only). The default remains full validation -
  // the staleCode floor is only a floor if it runs by default.
  'no-code': { type: 'boolean' },
};

const HELP = `Usage: rcf validate [options]

Options:
  --quiet                   Only summary line + first 3 issues
  --json                    Emit machine-readable envelope
  --no-code                 Skip the Code Node staleness pass (spec-graph
                             checks only; the default runs full validation)
  --help                    Print this help
`;

// Case-insensitive whole-word TODO match. Word-bounded so incidental
// substrings (e.g. "autodoc") do not trip the scan.
const TODO_RE = /\btodo\b/i;

/**
 * Recursively collect dot-paths of string fields containing TODO
 * placeholder text.
 * @param {unknown} value
 * @param {string} path
 * @param {string[]} out
 */
function findTodoFields(value, path, out) {
  if (typeof value === 'string') {
    if (TODO_RE.test(value)) out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findTodoFields(v, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      findTodoFields(v, path ? `${path}.${k}` : k, out);
    }
  }
}

/**
 * Scan every loaded document (roots + children; inline ACs / TCs ride
 * inside their parent doc's fields) for TODO placeholder text left over
 * from `rcf init` scaffolding. Cheap by design (B4): one string sweep,
 * one entry per affected doc.
 * @param {object} tree - walker TreeModel
 * @returns {Array<{ id: string, fields: string[] }>}
 */
function collectTodoNotices(tree) {
  const docs = [
    ...(tree.prd ? [{ id: tree.prd.prdId, doc: tree.prd }] : []),
    ...(tree.tad ? [{ id: tree.tad.tadId, doc: tree.tad }] : []),
    ...(tree.bs ? [{ id: tree.bs.bsId, doc: tree.bs }] : []),
    ...tree.requirements.map((d) => ({ id: d.reqId, doc: d })),
    ...tree.userStories.map((d) => ({ id: d.usId, doc: d })),
    ...tree.tacs.map((d) => ({ id: d.tacId, doc: d })),
    ...tree.adrs.map((d) => ({ id: d.adrId, doc: d })),
    ...tree.fbsItems.map((d) => ({ id: d.fbsId, doc: d })),
    ...tree.testSuites.map((d) => ({ id: d.id, doc: d })),
  ];
  const notices = [];
  for (const { id, doc } of docs) {
    /** @type {string[]} */
    const fields = [];
    findTodoFields(doc, '', fields);
    if (fields.length > 0) notices.push({ id: id ?? '(unknown id)', fields });
  }
  return notices;
}

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
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  // Phase 10 (X2 CodeNode bridge, spec D6): staleness pass. Every Code
  // Node's declared path/symbol is checked against the working tree;
  // unresolved ones surface as `staleCode` errors folded into the same
  // exit path as schema / referential-integrity errors. This is the X2
  // detection claim: links that break visibly.
  if (!flags['no-code']) {
    const staleErrors = await checkCodeNodeResolution({ projectRoot, tree });
    errors.push(...staleErrors);
  }
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
    if (!flags.quiet) {
      stdout.write('rcf validate: tree is clean.\n');
      // B4 (E2E matrix 2026-07-06-003): scaffold TODO placeholders were
      // surviving to otherwise-valid trees unflagged. Non-blocking notice
      // only - the exit code is unchanged.
      const notices = collectTodoNotices(tree);
      if (notices.length > 0) {
        stdout.write(`notice: ${notices.length} document(s) still carry scaffold TODO placeholder text (informational; exit code unaffected):\n`);
        for (const n of notices) {
          stdout.write(`  ${n.id}: ${n.fields.join(', ')}\n`);
        }
      }
    }
    return 0;
  }
  if (flags.quiet) {
    const first = errors.slice(0, 3);
    // BUG-004 fix: `--quiet` used to render `errors.length` (== 3) as the
    // summary count. Pass the true total through so the summary reads
    // "N errors found" for the whole tree, not just the shown subset.
    stderr.write(`${formatErrors(first, { verbose: false, strict: false, total: errors.length })}\n`);
    if (errors.length > 3) stderr.write(`... ${errors.length - 3} more issue(s) suppressed by --quiet\n`);
  } else {
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
  }
  return 3;
}
