// `rcf create <kind>` subcommand handler. Delegates to writer.js for
// the actual persistence; this file handles CLI parsing + defaults +
// pre-run tree walk. Phase 4 §D6 (revised).

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { formatErrors } from '../errors/index.js';
import { createDocument, deriveSlug, walkTree } from '../store/index.js';
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
};

const HELP = `Usage: rcf create <kind> [options]

Kinds: req | us | ac | tac | adr | fbs | ts | tc

See 'rcf help create' for the full option list.
`;

const VALID_KINDS = new Set(['req', 'us', 'ac', 'tac', 'adr', 'fbs', 'ts', 'tc']);

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
  if (positionals.length !== 1 || !VALID_KINDS.has(positionals[0])) {
    stderr.write("[error] usage create: expected exactly one <kind> from req|us|ac|tac|adr|fbs|ts|tc\n");
    stderr.write(HELP);
    return 2;
  }
  const kind = positionals[0];

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }

  const walkResult = await walkTree({ projectRoot });
  if (walkResult.errors.length > 0) {
    stderr.write(`${formatErrors(walkResult.errors, { verbose: false, strict: false })}\n`);
    return 3;
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
  if (flags.acs !== undefined) body.acIds = flags.acs.split(',').map((s) => s.trim()).filter(Boolean);

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
    projectRoot, tree: walkResult.tree, kind, body, options,
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
  stderr.write(`[error] ${kind} ${err.message}\n`);
  if (kind === 'usage') return 2;
  if (kind === 'validation' || kind === 'brokenReference') return 3;
  if (kind === 'missingFile' || kind === 'parseFailure') return 2;
  if (kind === 'ioFailure') return 1;
  return 1;
}
