// `rcf ui-baseline <verb>` handler (ui-design-gate-0.7.0-spec §5.5).
//
// Three sub-verbs:
//   init [--prd <prdId>] [--input <file>] [--dry-run] [--reset]
//     Present the ruled defaults, take operator ack + any opt-outs,
//     write the uiBaseline record (with --reset appending the prior
//     record to uiBaselineHistory[]).
//   show [--json]
//     Print the current baseline record.
//   opt-out --field <path> --reason "..."
//     Append an entry to operatorOptOuts[] on the existing baseline.
//
// The init verb also applies the preflight seam pickup (spec §3.2):
// preflight-recorded design-shape answers whose uiBaselineWritePath
// targets defaults.* land as defaults on the fresh record. The Track A
// finalised `skippedUiBaseline` seam is the interlock; the opt-out
// ledger entries stay in place either way.

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';

import { walkTree } from '@stravica-ai/rcf-lite-core/store';
import { writeUnexpectedFailure, rcfError } from '@stravica-ai/rcf-lite-core/errors';

import { findProjectRoot } from '../view/index.js';
import {
  UI_BASELINE_DEFAULTS_V1,
  composeUiBaselineRecord,
  isKnownBaselinePath,
  normaliseNonInteractiveInput,
  preflightSeamOverrides,
  runInteractiveSession,
  writeUiBaselineOptOut,
  writeUiBaselineRecord,
} from '../ui-baseline/index.js';

const OPTION_SPEC = {
  prd: { type: 'string' },
  input: { type: 'string' },
  'dry-run': { type: 'boolean' },
  reset: { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  field: { type: 'string' },
  reason: { type: 'string' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf ui-baseline <verb> [options]

Manage the project's ruled UI defaults (theme, layout, contrast,
components, auth flow). Written once per project as a uiBaseline record
on the manifest; every UI-bearing FBS inherits from it. Every opt-out
is explicit; silence is never an opt-out.

Sub-verbs:
  init                      Present the ruled defaults and write the
                            uiBaseline record. Interactive by default;
                            --input reads a pre-filled JSON file for CI.
  show                      Print the current baseline record.
  opt-out                   Append an entry to operatorOptOuts[].

Options:
  --prd <prd-id>            PRD id to attach to the baseline (default:
                            the project's PRD).
  --input <path>            Non-interactive init: read a JSON file with
                            { optOuts: [], overrides: {} } shape.
  --dry-run                 init only: print the composed record; do not
                            write.
  --reset                   init only: append the previous baseline to
                            uiBaselineHistory[] before writing.
  --json                    show only: emit JSON.
  --field <path>            opt-out only: dot-path into defaults (for
                            example 'themeMode' or 'componentVocabulary.declaredComponents').
  --reason "..."            opt-out only: plain-text reason (>= 20 chars).
  --quiet                   Suppress non-error confirmations.
  --help                    Print this help.

Exit codes:
  0  success
  1  IO / unexpected runtime failure
  2  usage error
  3  schema or tree validation failure
  4  session cancelled by operator (init only)
`;

/**
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const stdin = deps.stdin ?? process.stdin;
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
  if (flags.help) { stdout.write(HELP); return 0; }
  if (parsed.positionals.length !== 1) {
    stderr.write('[error] usage ui-baseline: expected one sub-verb (init | show | opt-out)\n');
    return 2;
  }
  const sub = parsed.positionals[0];
  if (!['init', 'show', 'opt-out'].includes(sub)) {
    stderr.write(`[error] usage ui-baseline: unknown sub-verb '${sub}' (expected init | show | opt-out)\n`);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `rcf init` first.\n');
    return 2;
  }
  const walkResult = await walkTree({ projectRoot });
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding\n`);
  }
  const { tree } = walkResult;

  if (sub === 'show') return runShow({ tree, stdout, flags });
  if (sub === 'opt-out') return await runOptOut({ tree, projectRoot, stdout, stderr, flags, now: deps.now });
  return await runInit({ tree, projectRoot, stdin, stdout, stderr, flags, now: deps.now });
}

function runShow({ tree, stdout, flags }) {
  const record = tree.manifest?.uiBaseline;
  if (!record) {
    stdout.write('ui-baseline: no baseline recorded. Run \'rcf ui-baseline init\'.\n');
    return 0;
  }
  if (flags.json) {
    stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return 0;
  }
  stdout.write(`ui-baseline ${record.id} (prd=${record.prdId}, ackedAt=${record.operatorAckAt})\n`);
  const defaults = record.defaults ?? {};
  const optOuts = new Set((record.operatorOptOuts ?? []).map((o) => o.field));
  for (const spec of UI_BASELINE_DEFAULTS_V1) {
    const value = readDot(defaults, spec.path);
    const marker = optOuts.has(spec.path) ? '*' : ' ';
    stdout.write(`  ${marker} ${spec.path}: ${formatValue(value)}\n`);
  }
  if ((record.operatorOptOuts ?? []).length > 0) {
    stdout.write('opt-outs:\n');
    for (const o of record.operatorOptOuts) {
      stdout.write(`  * ${o.field} - ${o.reason} (ack ${o.operatorAckAt})\n`);
    }
  }
  return 0;
}

async function runOptOut({ tree, projectRoot, stdout, stderr, flags, now }) {
  if (typeof flags.field !== 'string' || flags.field.length === 0) {
    stderr.write('[error] usage ui-baseline opt-out: --field is required\n');
    return 2;
  }
  if (typeof flags.reason !== 'string' || flags.reason.length < 20) {
    stderr.write('[error] usage ui-baseline opt-out: --reason is required and must be at least 20 characters\n');
    return 2;
  }
  const normalisedField = flags.field.startsWith('defaults.') ? flags.field.slice('defaults.'.length) : flags.field;
  if (!isKnownBaselinePath(normalisedField)) {
    stderr.write(`[error] usage ui-baseline opt-out: unknown baseline field '${normalisedField}' (see 'rcf ui-baseline show' for the field list)\n`);
    return 2;
  }
  const result = await writeUiBaselineOptOut({
    projectRoot,
    tree,
    field: normalisedField,
    reason: flags.reason,
    isKnownField: isKnownBaselinePath,
    now: now ? new Date(now()) : new Date(),
  });
  if (result && 'kind' in result && 'message' in result) {
    if (result.kind === 'ioFailure') { writeUnexpectedFailure(result, stderr); return 1; }
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    if (result.kind === 'usage') return 2;
    if (result.kind === 'validation') return 3;
    return 1;
  }
  if (!flags.quiet) stdout.write(`ui-baseline: recorded opt-out for ${normalisedField}.\n`);
  return 0;
}

async function runInit({ tree, projectRoot, stdin, stdout, stderr, flags, now }) {
  const prdId = flags.prd ?? tree.prd?.prdId;
  if (!prdId) {
    stderr.write('[error] usage ui-baseline init: no --prd given and no PRD found on the tree\n');
    return 2;
  }
  const priorBaseline = tree.manifest?.uiBaseline ?? null;
  if (priorBaseline && !flags.reset && !flags['dry-run']) {
    stderr.write(`[error] refused ui-baseline init: a baseline (${priorBaseline.id}) already exists; pass --reset to author a fresh one (the prior lands under uiBaselineHistory[]).\n`);
    return 2;
  }

  const preflightOverrides = preflightSeamOverrides(tree.manifest);
  const isTty = Boolean(stdout.isTTY && stdin.isTTY);

  let session;
  try {
    if (flags.input) {
      const raw = await readFile(flags.input, 'utf8');
      const parsed = JSON.parse(raw);
      session = normaliseNonInteractiveInput(parsed);
      // Merge preflight overrides UNDER the input overrides: input wins.
      session.overrides = { ...preflightOverrides, ...session.overrides };
    } else if (isTty) {
      const rl = createInterface({ input: stdin, output: stdout });
      const prompt = (q) => rl.question(q);
      const write = (line) => stdout.write(`${line}\n`);
      try {
        session = await runInteractiveSession({ prompt, write, preflightOverrides });
      } finally {
        rl.close();
      }
    } else {
      stderr.write('[error] usage ui-baseline init: not on a TTY and no --input file given\n');
      return 2;
    }
  } catch (err) {
    if (err && String(err.message).includes('session cancelled by operator')) {
      stderr.write('[error] ui-baseline init: session cancelled; no record written.\n');
      return 4;
    }
    writeUnexpectedFailure(
      rcfError({ kind: 'ioFailure', message: `ui-baseline init: ${err.message}`, stack: err.stack }),
      stderr,
    );
    return 1;
  }

  const record = composeUiBaselineRecord({
    manifest: tree.manifest,
    prdId,
    optOuts: session.optOuts,
    overrides: session.overrides,
    now: now ? new Date(now()) : new Date(),
  });

  if (flags['dry-run']) {
    stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    if (!flags.quiet) stdout.write(`[dry-run] ui-baseline init: would write ${record.id} (${session.optOuts.length} opt-outs).\n`);
    return 0;
  }

  const result = await writeUiBaselineRecord({
    projectRoot, tree, record, options: { reset: Boolean(flags.reset) },
  });
  if (result && 'kind' in result && 'message' in result) {
    if (result.kind === 'ioFailure') { writeUnexpectedFailure(result, stderr); return 1; }
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    if (result.kind === 'usage') return 2;
    if (result.kind === 'validation') return 3;
    return 1;
  }
  if (!flags.quiet) {
    stdout.write(`ui-baseline init: wrote ${record.id} to rcf/manifest.json (${session.optOuts.length} opt-out(s)).\n`);
    if (Object.keys(preflightOverrides).length > 0) {
      stdout.write(`  Applied ${Object.keys(preflightOverrides).length} preflight seam pickup(s): ${Object.keys(preflightOverrides).join(', ')}\n`);
    }
  }
  return 0;
}

function readDot(obj, path) {
  const parts = String(path).split('.');
  let cursor = obj;
  for (const key of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function formatValue(v) {
  if (v === undefined) return '(unset)';
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
