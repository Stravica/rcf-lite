// `rcf create <kind>` subcommand handler. Delegates to writer.js for
// the actual persistence; this file handles CLI parsing + defaults +
// pre-run tree walk. Phase 4 §D6 (revised).

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { writeUnexpectedFailure } from '@stravica-ai/rcf-lite-core/errors';
import { createDocument, deriveSlug, splitCnPath, walkTree } from '@stravica-ai/rcf-lite-core/store';
import { deriveFileDeps, mapDerivedDepsToCnIds } from '@stravica-ai/rcf-lite-core/store/derive-deps.js';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
  parent: { type: 'string' },
  id: { type: 'string' },
  title: { type: 'string' },
  description: { type: 'string' },
  acs: { type: 'string' },
  ac: { type: 'string' },
  purpose: { type: 'string' },
  'test-level': { type: 'string' },
  slug: { type: 'string' },
  'test-pointer': { type: 'string' },
  'build-order': { type: 'string' },
  'from-file': { type: 'string' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
  // Phase 10 (X2 CodeNode bridge): `rcf create cn` flags.
  path: { type: 'string' },
  deps: { type: 'string' },
  'derive-deps': { type: 'boolean' },
};

const HELP = `Usage: rcf create <kind> [options]

Kinds: req | us | ac | tac | adr | fbs | ts | tc | cn

See 'rcf help create' for the full option list.

Code Node (cn) options:
  --path <path>             Repo-relative source path, optionally
                            #symbol-suffixed (required)
  --acs <ids>               Comma-separated AC ids this node implements
                            (may be empty - an orphan CN is legitimate)
  --deps <ids>              Comma-separated CN ids this node depends on
  --derive-deps             Assist --deps with dependency-cruiser file-level
                            analysis (dev-time only; never a runtime dep -
                            errors helpfully when the tool is not resolvable)
`;

const VALID_KINDS = new Set(['req', 'us', 'ac', 'tac', 'adr', 'fbs', 'ts', 'tc', 'cn']);
// Root-singleton kinds: created by `rcf init`, not by `rcf create`. When
// a user reaches for `rcf create prd|tad|bs|manifest`, we return a clearer
// message that points them at `rcf init` (BUG-010).
const SINGLETON_KINDS = new Set(['prd', 'tad', 'bs', 'manifest']);

/**
 * @param {string[]} argv - argv slice after `create`
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
  // BUG-009 fix: split the two distinct usage errors so the operator can
  // tell "kind missing" apart from "kind unknown". BUG-010 fix: singleton
  // kinds (prd / tad / bs / manifest) get a clarifying "use rcf init"
  // hint rather than the generic "unknown kind" line.
  if (positionals.length === 0) {
    stderr.write('[error] usage create: <kind> is required (one of req|us|ac|tac|adr|fbs|ts|tc)\n');
    stderr.write(HELP);
    return 2;
  }
  if (positionals.length > 1) {
    stderr.write(`[error] usage create: expected exactly one <kind>, got ${positionals.length}\n`);
    stderr.write(HELP);
    return 2;
  }
  const rawKind = positionals[0];
  if (SINGLETON_KINDS.has(rawKind)) {
    stderr.write(`[error] usage create: ${rawKind} is a root singleton — use \`rcf init\` to create it\n`);
    return 2;
  }
  if (!VALID_KINDS.has(rawKind)) {
    stderr.write(
      `[error] usage create: unknown kind: ${rawKind} (expected one of req|us|ac|tac|adr|fbs|ts|tc)\n`,
    );
    stderr.write(HELP);
    return 2;
  }
  const kind = rawKind;

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  const walkResult = await walkTree({ projectRoot });
  // B5: pre-existing tree breakage no longer blocks write verbs - the
  // write is gated on the POST-write tree state inside the writer, so
  // repairing a broken tree is possible while net-new breakage is still
  // refused.
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding - writes are validated against the post-write state (run 'rcf validate' for details)\n`);
  }

  let fileBody = null;
  if (flags['from-file']) {
    try {
      const raw = await readFile(flags['from-file'], 'utf8');
      fileBody = JSON.parse(raw);
    } catch (err) {
      stderr.write(`[error] usage create: cannot read --from-file: ${err.message}\n`);
      return 2;
    }
  }

  const body = { ...(fileBody ?? {}) };
  // CLI wins on conflict.
  if (flags.title !== undefined) body.title = flags.title;
  if (flags.description !== undefined) body.description = flags.description;
  if (flags.purpose !== undefined) body.purpose = flags.purpose;
  if (flags['test-level'] !== undefined) body.testLevel = flags['test-level'];
  // Phase 10: `cn`'s AC cross-link field is `implementsAcIds`, not `acIds`
  // (fbs/ts share `acIds`) - --acs maps to whichever the kind expects.
  if (flags.acs !== undefined) {
    const ids = flags.acs.split(',').map((s) => s.trim()).filter(Boolean);
    if (kind === 'cn') body.implementsAcIds = ids;
    else body.acIds = ids;
  }
  if (kind === 'cn') {
    if (flags.path !== undefined) body.path = flags.path;
    if (flags.deps !== undefined) body.dependencies = flags.deps.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const options = {
    id: flags.id,
    parentId: flags.parent,
    dryRun: Boolean(flags['dry-run']),
  };

  // Per-kind mandatory-title / mandatory-description checks.
  if (kind === 'ac' || kind === 'tc') {
    if (!body.description) {
      stderr.write(`[error] usage create ${kind}: --description is required\n`);
      return 2;
    }
  } else if (kind === 'cn') {
    if (!body.path) {
      stderr.write('[error] usage create cn: --path is required\n');
      return 2;
    }
    // Phase 10 D5: --derive-deps assist. Optional, dev-time only, never a
    // runtime dependency - errors helpfully (exit 2) when the tool cannot
    // be resolved rather than silently degrading or reaching for the
    // network to install it.
    if (flags['derive-deps']) {
      const { file } = splitCnPath(body.path);
      const derived = await deriveFileDeps({ projectRoot, filePath: file });
      if (!derived.ok) {
        stderr.write(`[error] usage create cn: --derive-deps: ${derived.message}\n`);
        return 2;
      }
      const { cnIds, unmatched } = mapDerivedDepsToCnIds(walkResult.tree, derived.deps);
      const existing = Array.isArray(body.dependencies) ? body.dependencies : [];
      body.dependencies = [...new Set([...existing, ...cnIds])].sort();
      if (unmatched.length > 0 && !flags.quiet) {
        stdout.write(`[info] --derive-deps: ${unmatched.length} file-level import(s) have no matching CN yet, skipped: ${unmatched.join(', ')}\n`);
      }
    }
  } else if (!body.title) {
    stderr.write(`[error] usage create ${kind}: --title is required\n`);
    return 2;
  }

  if (kind === 'ts') {
    if (!body.purpose) { stderr.write('[error] usage create ts: --purpose is required\n'); return 2; }
    if (!body.testLevel) { stderr.write('[error] usage create ts: --test-level is required\n'); return 2; }
    if (!Array.isArray(body.acIds) || body.acIds.length === 0) {
      stderr.write('[error] usage create ts: --acs is required (one or more AC ids)\n');
      return 2;
    }
  }
  if (kind === 'fbs') {
    if (!Array.isArray(body.acIds) || body.acIds.length === 0) {
      stderr.write('[error] usage create fbs: --acs is required (one or more AC ids)\n');
      return 2;
    }
    if (flags['build-order'] !== undefined) {
      const n = Number(flags['build-order']);
      if (!Number.isInteger(n) || n < 1) {
        stderr.write(`[error] usage create fbs: --build-order expects a positive integer, got ${flags['build-order']}\n`);
        return 2;
      }
      options.buildOrder = n;
    }
  }
  if (kind === 'tc') {
    if (!flags.ac) { stderr.write('[error] usage create tc: --ac is required\n'); return 2; }
    body.acId = flags.ac;
    options.slug = flags.slug ?? deriveSlug(body.description);
    if (flags['test-pointer'] !== undefined) options.testPointer = flags['test-pointer'];
  }

  const result = await createDocument({
    projectRoot, tree: walkResult.tree, kind, body, options, walkErrors: walkResult.errors,
  });
  if (isRcfError(result)) {
    return handleWriterError(result, stderr);
  }
  if (options.dryRun) {
    if (!flags.quiet) stdout.write(`[dry-run] would create ${result.id} at ${result.filePath}\n`);
    return 0;
  }
  if (!flags.quiet) {
    stdout.write(`${result.id} created at ${result.filePath}\n`);
  }
  return 0;
}

const ERROR_KINDS = new Set([
  'validation',
  'missingFile',
  'brokenReference',
  'parseFailure',
  'ioFailure',
  'usage',
]);

function isRcfError(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.kind === 'string'
    && ERROR_KINDS.has(value.kind) && typeof value.message === 'string';
}

function handleWriterError(err, stderr) {
  const kind = err.kind;
  // BUG-007 fix: spec §D15 mandates exit-1 emit
  // `[rcf] unexpected failure: <msg>\n<stack>` — even under --quiet.
  if (kind === 'ioFailure') {
    writeUnexpectedFailure(err, stderr);
    return 1;
  }
  stderr.write(`[error] ${kind} ${err.message}\n`);
  if (kind === 'usage') return 2;
  if (kind === 'validation' || kind === 'brokenReference') return 3;
  if (kind === 'missingFile' || kind === 'parseFailure') return 2;
  return 1;
}
