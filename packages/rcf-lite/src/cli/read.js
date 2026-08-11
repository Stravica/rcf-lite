// `rcf read <id>` subcommand handler. Prints the document body (or a
// dot-path field). Inline AC / TC ids resolve to the addressed inline
// entry inside the parent US / TS body. Phase 4 §D7.

import { parseArgs } from 'node:util';

import { walkTree } from '#core/store';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
  field: { type: 'string' },
  raw: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf read <id> [options]

Prints the document body to stdout and a schema-validity report to
stderr: a valid document is reported as valid; an invalid-but-present
document is still returned, together with its validation errors, so the
caller sees both the content and the problem. The exit code stays 0
either way - read is a retrieval verb, not a gate (that is rcf validate).

Options:
  --field <dotPath>         Print only the addressed field
  --raw                     Emit unformatted (single-line) JSON
  --help                    Print this help
`;

/**
 * @param {string[]} argv - argv slice after `read`
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
    stderr.write('[error] usage read: expected exactly one <id>\n');
    stderr.write(HELP);
    return 2;
  }
  const id = positionals[0];
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  const target = resolveTarget(tree, id);
  if (!target) {
    stderr.write(`[error] usage read: id ${id} not found\n`);
    return 2;
  }
  let value = target.doc;
  if (flags.field) {
    value = extractField(target.doc, flags.field);
    if (value === undefined) {
      stderr.write(`[error] usage read: field ${flags.field} not present on ${id}\n`);
      return 2;
    }
  }
  const out = flags.raw ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  stdout.write(`${out}\n`);
  // Validity report (AC-301-1 / AC-301-3): the body went to stdout; the
  // schema verdict goes to stderr so piped output stays pure JSON. An
  // invalid-but-present document is returned WITH its validation errors -
  // content and problem together. Read never gates on validity (exit 0);
  // rcf validate is the gate.
  if (target.invalid) {
    stderr.write(`[warn] read: ${target.containerId} fails schema validation; body returned together with the errors:\n`);
    const validationErrors = (errors ?? []).filter(
      (e) => e.kind === 'validation' && e.documentId === target.containerId,
    );
    for (const e of validationErrors) {
      stderr.write(`[warn] validation ${target.containerId}: ${e.message}\n`);
    }
  } else {
    stderr.write(`[ok] read: ${id} is valid against its schema\n`);
  }
  return 0;
}

/**
 * Resolve a target id against the tree. Supports:
 *   - root docs (PRD, TAD, BS, MANIFEST)
 *   - child docs (REQ, US, TAC, ADR, FBS, TS)
 *   - inline AC (`AC-XXX-N`) -> returns the AC entry from parent US
 *   - inline TC (`TC-XXX-slug`) -> returns the TC entry from parent TS
 */
function resolveTarget(tree, id) {
  if (id === 'MANIFEST' && tree.manifest) {
    return { doc: tree.manifest, containerId: 'MANIFEST', invalid: false };
  }
  const doc = tree.byId.get(id);
  if (doc) return { doc, containerId: id, invalid: false };
  // B5: schema-invalid docs stay addressable (tree.invalidDocs) - read
  // returns the body together with the validation errors (AC-301-3).
  const invalidEntry = tree.invalidDocs?.get(id);
  if (invalidEntry) return { doc: invalidEntry.doc, containerId: id, invalid: true };
  if (/^AC-\d+(-\d+)?$/.test(id)) {
    const parentId = tree.parentByChild.get(id);
    if (!parentId) return null;
    const us = tree.byId.get(parentId);
    if (!us) return null;
    const entry = (us.acceptanceCriteria ?? []).find((ac) => ac.id === id);
    return entry ? { doc: entry, containerId: parentId, invalid: false } : null;
  }
  if (/^TC-\d{3}-[a-z0-9-]+$/.test(id)) {
    const parentId = tree.parentByChild.get(id);
    if (!parentId) return null;
    const ts = tree.byId.get(parentId);
    if (!ts) return null;
    const entry = (ts.testCases ?? []).find((tc) => tc.id === id);
    return entry ? { doc: entry, containerId: parentId, invalid: false } : null;
  }
  return null;
}

function extractField(root, path) {
  const parts = parseDotPath(path);
  if (!parts) return undefined;
  let cur = root;
  for (const seg of parts) {
    if (cur === undefined || cur === null) return undefined;
    if (seg.kind === 'index') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg.value];
    } else {
      cur = cur[seg.value];
    }
  }
  return cur;
}

function parseDotPath(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const parts = [];
  for (const seg of path.split('.')) {
    const m = /^([^\[\]]+)((?:\[\d+\])*)$/.exec(seg);
    if (!m) return null;
    parts.push({ kind: 'prop', value: m[1] });
    if (m[2]) {
      const indices = m[2].match(/\d+/g) ?? [];
      for (const n of indices) parts.push({ kind: 'index', value: Number(n) });
    }
  }
  return parts;
}
