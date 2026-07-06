// `rcf build` subcommand handler (Phase 6 §D1). One verb, four modes:
//
//   rcf build                          queue overview
//   rcf build <fbs-id>                 spec bundle for one FBS item
//   rcf build --next                   bundle for the next actionable item
//   rcf build <fbs-id> --mark <status> record a lifecycle transition
//
// Positional is an FBS id ONLY: the FBS is the queue unit (one US's
// ACs can span multiple FBS items, so US addressing is ambiguous by
// construction). US ids exit 2 with a pointer at `rcf trace`.
//
// Deterministic-only boundary (§D13): this verb assembles what the
// tree says. It does not score bundle quality, detect under-specified
// FBS items, or generate spec prose - that non-deterministic judgement
// belongs to the Phase 7+ prompting + MCP resources surface.

import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { formatErrors, isRcfError, rcfError, writeUnexpectedFailure } from '../errors/index.js';
import { updateDocument, walkTree } from '../store/index.js';
import { findProjectRoot } from '../view/index.js';
import { kindOf } from '../query/index.js';
import {
  assembleBundle,
  computeQueue,
  formatJson,
  formatMarkdown,
  planMark,
  selectNext,
} from '../build/index.js';

const OPTION_SPEC = {
  next: { type: 'boolean' },
  mark: { type: 'string' },
  format: { type: 'string' },
  out: { type: 'string' },
  strict: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf build [fbs-id] [options]

Assemble FBS spec bundles and drive the build queue (the SDD adapter).
Four modes:

  rcf build                          Queue overview (the FBS queue as a table)
  rcf build <fbs-id>                 Spec bundle for one FBS item
  rcf build --next                   Bundle for the next actionable item
  rcf build <fbs-id> --mark <status> Record a lifecycle transition

The positional is an FBS id only. For 'which FBS items implement this
story', use: rcf trace <us-id> --forward --format json

Lifecycle (forward-only): notStarted -> inProgress -> complete -> verified.
Backward transitions are refused (exit 4); the deliberate-correction
escape hatch is: rcf update <fbs-id> --set executionStatus=<status>

Bundle assembly is mechanical and deterministic: it projects what the
tree says. It does NOT judge whether the FBS is well-specified or the
bundle sufficient - that belongs to a later prompting + MCP phase.

Options:
  --next                    Select the next actionable FBS item (lowest
                            buildOrder, notStarted, all dependencies
                            satisfied) and emit its bundle
  --mark <status>           Record a lifecycle transition (combines only
                            with the positional and --quiet)
  --format <format>         md (default) | json (queue + bundle modes)
  --out <path>              Write the bundle to a file (bundle modes)
  --strict                  Refuse (exit 4) a bundle for a blocked item;
                            no effect with --next (it never selects
                            blocked items)
  --quiet                   Suppress non-error confirmations
  --help                    Print this help
`;

const VALID_FORMATS = new Set(['md', 'json']);

/**
 * @param {string[]} argv - argv slice after `build`
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

  // Positional discipline (§D1): at most one, no globs.
  if (positionals.length > 1) {
    stderr.write('[error] usage build: multiple positional ids are not supported\n');
    return 2;
  }
  const positional = positionals[0] ?? null;
  if (positional && (positional.includes('*') || positional.includes('?'))) {
    stderr.write('[error] usage build: wildcard / glob positional not supported\n');
    return 2;
  }

  // Mode detection + flag-conflict rules (§D1 / §D9).
  const usage = (message) => {
    stderr.write(`[error] usage build: ${message}\n`);
    return 2;
  };
  if (flags.next && positional) return usage('--next takes no positional');
  if (flags.mark !== undefined) {
    if (!positional) return usage('--mark requires an <fbs-id> positional');
    if (flags.next) return usage('--mark cannot combine with --next');
    if (flags.format !== undefined) return usage('--mark cannot combine with --format');
    if (flags.out !== undefined) return usage('--out is invalid in mark mode');
    if (flags.strict) return usage('--mark cannot combine with --strict');
  }
  const mode = flags.mark !== undefined
    ? 'mark'
    : flags.next
      ? 'next'
      : positional
        ? 'bundle'
        : 'queue';
  if (mode === 'queue') {
    if (flags.out !== undefined) return usage('--out is invalid in queue mode');
    if (flags.strict) return usage('--strict applies to bundle modes only');
  }
  const format = flags.format ?? 'md';
  if (!VALID_FORMATS.has(format)) {
    return usage(`unknown --format ${format} (expected md | json)`);
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }
  // Single walkTree call; walker errors block every mode, including
  // --mark - no status write lands on a tree that fails validation (§D6).
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
    return 3;
  }

  const io = { stdout, stderr, quiet: Boolean(flags.quiet), out: flags.out ?? null };

  if (mode === 'mark') {
    return await runMark({ tree, projectRoot, fbsId: positional, status: flags.mark, io });
  }
  if (mode === 'queue') {
    const queue = computeQueue(tree);
    const output = format === 'json' ? formatJson(queue, 'queue') : formatMarkdown(queue, 'queue');
    stdout.write(output);
    return 0;
  }
  if (mode === 'next') {
    return await emitNext({ tree, format, io });
  }
  return await emitBundle({
    tree, fbsId: positional, format, strict: Boolean(flags.strict), io,
  });
}

/**
 * Classify a positional id (§D1): FBS ids proceed; US ids exit 2 with
 * the trace pointer; other ids exit 2.
 */
function classifyPositional(tree, id) {
  const kind = kindOf(tree, id);
  if (kind === 'fbs') return null;
  if (kind === 'userStory') {
    return rcfError({
      kind: 'usage',
      message: `build: ${id} is a user story, not an FBS id; the FBS is the queue unit. `
        + `To list the FBS items linked to this story: rcf trace ${id} --forward --format json`,
      documentId: id,
    });
  }
  if (kind) {
    return rcfError({
      kind: 'usage',
      message: `build: ${id} is a ${kind} id; rcf build addresses FBS items only`,
      documentId: id,
    });
  }
  return rcfError({ kind: 'usage', message: `build: id ${id} not found`, documentId: id });
}

async function emitBundle({ tree, fbsId, format, strict, io }) {
  const classification = classifyPositional(tree, fbsId);
  if (classification) {
    io.stderr.write(`[error] usage ${classification.message}\n`);
    return 2;
  }
  const bundle = assembleBundle(tree, { fbsId });
  // Blocked-dependency gate (§D12): warn by default (the BLOCKED block
  // in section 2), refuse under --strict.
  if (strict && bundle.blockedBy.length > 0) {
    const blocking = bundle.dependencies
      .filter((d) => bundle.blockedBy.includes(d.fbsId))
      .map((d) => `${d.fbsId} (${d.executionStatus ?? 'unknown'})`)
      .join(', ');
    io.stderr.write(`[error] refused build: ${fbsId} is blocked by ${blocking}\n`);
    return 4;
  }
  const output = format === 'json' ? formatJson(bundle, 'bundle') : formatMarkdown(bundle, 'bundle');
  return await emitToSink(output, io);
}

async function emitNext({ tree, format, io }) {
  const queue = computeQueue(tree);
  const next = selectNext(queue);
  if (next) {
    const bundle = assembleBundle(tree, { fbsId: next.fbsId });
    const output = format === 'json' ? formatJson(bundle, 'next') : formatMarkdown(bundle, 'next');
    return await emitToSink(output, io);
  }
  // Nothing actionable is a valid answer, exit 0 (§D2 / OQ-P6-2): the
  // envelope distinguishes "done" (queueEmpty) from "stuck".
  const envelope = {
    queueEmpty: queue.totals.notStarted === 0 && queue.totals.inProgress === 0,
    totals: queue.totals,
    blocked: queue.items.filter((i) => i.state === 'blocked').map((i) => i.fbsId),
    inProgress: queue.items.filter((i) => i.state === 'inProgress').map((i) => i.fbsId),
  };
  const output = format === 'json' ? formatJson(envelope, 'next') : formatMarkdown(envelope, 'next');
  return await emitToSink(output, io);
}

/**
 * Default sink is stdout (pipe-friendly for the harness loop); `--out`
 * writes to a file instead - parent directory must exist, plain
 * overwrite, single writeFile (§D4). Write failures exit 1.
 */
async function emitToSink(output, io) {
  if (!io.out) {
    io.stdout.write(output);
    return 0;
  }
  try {
    await writeFile(io.out, output, 'utf8');
  } catch (err) {
    writeUnexpectedFailure(
      rcfError({ kind: 'ioFailure', message: `build: --out write failed: ${err.message}`, stack: err.stack }),
      io.stderr,
    );
    return 1;
  }
  if (!io.quiet) io.stdout.write(`bundle written to ${io.out}\n`);
  return 0;
}

/**
 * Mark mode (§D5): plan via the pure transition table, execute via the
 * Phase 4 `updateDocument` path (single executionStatus set; the
 * writer schema-validates and bumps updatedAt). Output is a fixed
 * one-line confirmation - exit codes carry the outcome (OQ-P6-4).
 */
async function runMark({ tree, projectRoot, fbsId, status, io }) {
  const plan = planMark(tree, { fbsId, status });
  if (isRcfError(plan)) {
    io.stderr.write(`[error] usage ${plan.message}\n`);
    return 2;
  }
  if (plan.refused) {
    io.stderr.write(`[error] refused ${plan.message}\n`);
    return 4;
  }
  if (plan.noOp) {
    // Idempotent no-op: a retried harness step does not fail the loop.
    if (!io.quiet) io.stdout.write(`${plan.fbsId} already ${plan.to}\n`);
    return 0;
  }
  const result = await updateDocument({
    projectRoot,
    tree,
    id: plan.fbsId,
    sets: [{ path: 'executionStatus', value: plan.to }],
    options: {},
  });
  if (isRcfError(result)) {
    if (result.kind === 'ioFailure') {
      writeUnexpectedFailure(result, io.stderr);
      return 1;
    }
    io.stderr.write(`[error] ${result.kind} ${result.message}\n`);
    if (result.kind === 'usage') return 2;
    if (result.kind === 'validation' || result.kind === 'brokenReference') return 3;
    return 1;
  }
  if (!io.quiet) io.stdout.write(`marked ${plan.fbsId} ${plan.from} -> ${plan.to}\n`);
  return 0;
}
