// `rcf preflight` subcommand handler
// (verification-integrity-cluster-spec §4, ADDENDUM §A).
//
// Runs the pre-flight config elicitation session and writes a
// `preFlightConfig` record onto the manifest. Interactive mode by
// default when stdin + stdout are TTYs; non-interactive mode reads a
// pre-filled JSON file (--input) for CI / automation. The session
// composes:
//   - one per-service ruling per candidate the scanner surfaced (§4.5),
//     plus operator additions;
//   - one design-shape answer per applicable REQ + catalogue question
//     (ADDENDUM §A.1);
//   - one baselineAcOptOuts entry per design-shape answer that triggers
//     an opt-out (ADDENDUM §A.2).
//
// Credentials never enter the chain: the session records only env-var
// NAMES + presence booleans, via the gitignored
// `.rcf/preflight-secrets.local.json` side-file whose gitignore path
// rides the 0.6.0 aggregator seam (§4.6).

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';

import { walkTree } from '@stravica-ai/rcf-lite-core/store';
import { writeUnexpectedFailure, rcfError } from '@stravica-ai/rcf-lite-core/errors';

import { findProjectRoot } from '../view/index.js';
import {
  composeDesignShapeOptOuts,
  composePreflightRecord,
  normaliseNonInteractiveInput,
  runInteractiveSession,
  scanForServiceCandidates,
  writePreflightRecord,
} from '../preflight/index.js';

const OPTION_SPEC = {
  prd: { type: 'string' },
  'from-tad': { type: 'string' },
  input: { type: 'string' },
  'non-interactive': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf preflight [options]

Elicit the pre-flight configuration record: for every third-party
service the PRD or TAD names, force one of the five attestation modes,
and record the operator's ruling on the manifest. Also poses any
applicable design-shape questions (v1 catalogue: auth.htmlLoginPage).

Interactive by default when running on a TTY. Non-interactive mode
reads a JSON file matching the session-summary shape.

Options:
  --prd <prd-id>            PRD to scan (default: the project's PRD)
  --from-tad <tad-id>       Also scan this TAD (default: the project's TAD)
  --input <path>            Non-interactive: read pre-filled session
  --non-interactive         Force non-interactive mode (default when
                            not on a TTY or when piped)
  --dry-run                 Print the composed record; do not write
  --json                    Emit the composed record as JSON to stdout
  --quiet                   Suppress non-error stdout
  --help                    Print this help

Credentials NEVER enter the chain. The session prompts for env var
NAMES only; values are read from the shell at test / finalise time.
The name-metadata is written to .rcf/preflight-secrets.local.json,
which is gitignored via the managed block written by rcf init.

Exit codes:
  0  success
  1  IO / unexpected runtime failure
  2  usage error (bad flags, unresolvable PRD id)
  3  schema validation on the composed record
  4  operator cancelled the session at the confirm step
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
  if (parsed.positionals.length > 0) {
    stderr.write('[error] usage preflight: no positional arguments (use --prd / --from-tad)\n');
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` first.\n');
    return 2;
  }

  const walkResult = await walkTree({ projectRoot });
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding — run 'rcf validate' for details\n`);
  }
  const { tree } = walkResult;

  const prdId = flags.prd ?? tree.prd?.prdId;
  if (!prdId) {
    stderr.write('[error] usage preflight: no --prd given and no PRD found on the tree\n');
    return 2;
  }
  const tadId = flags['from-tad'] ?? tree.tad?.tadId ?? null;

  const scan = scanForServiceCandidates({ tree, prdId, tadId });
  if (scan.skippedDocIds.length > 0) {
    stderr.write(`[warn] preflight: skipped ids not found on the tree: ${scan.skippedDocIds.join(', ')}\n`);
  }

  const isTty = Boolean(stdout.isTTY && stdin.isTTY);
  const forceNonInteractive = Boolean(flags['non-interactive']) || Boolean(flags.input);
  const interactive = !forceNonInteractive && isTty;

  let sessionResult;
  try {
    if (interactive) {
      const rl = createInterface({ input: stdin, output: stdout });
      const prompt = (q) => rl.question(q);
      const write = (line) => stdout.write(`${line}\n`);
      try {
        sessionResult = await runInteractiveSession({
          projectRoot,
          scan,
          reqsForDesignShapes: tree.requirements ?? [],
          prompt,
          write,
          env: deps.env ?? process.env,
        });
      } finally {
        rl.close();
      }
    } else if (flags.input) {
      const raw = await readFile(flags.input, 'utf8');
      const parsedInput = JSON.parse(raw);
      sessionResult = normaliseNonInteractiveInput(parsedInput);
    } else {
      stderr.write('[error] usage preflight: not on a TTY and no --input file given\n');
      return 2;
    }
  } catch (err) {
    if (err.message === 'preflight: session cancelled by operator') {
      stderr.write('[error] preflight: session cancelled; no record written.\n');
      return 4;
    }
    writeUnexpectedFailure(
      rcfError({ kind: 'ioFailure', message: `preflight: ${err.message}`, stack: err.stack }),
      stderr,
    );
    return 1;
  }

  const now = deps.now ? new Date(deps.now()) : new Date();
  const record = composePreflightRecord({
    manifest: tree.manifest,
    prdId,
    services: sessionResult.services,
    designShapeAnswers: sessionResult.designShapeAnswers,
    now,
  });
  const optOuts = composeDesignShapeOptOuts({
    manifest: tree.manifest,
    preflightRecord: record,
    designShapeAnswers: sessionResult.designShapeAnswers,
    now,
  });

  if (flags['dry-run']) {
    if (flags.json) stdout.write(`${JSON.stringify({ record, optOuts }, null, 2)}\n`);
    if (!flags.quiet) {
      stdout.write(`[dry-run] preflight would write record ${record.id} (${record.servicesInScope.length} services, ${record.designShapeAnswers?.length ?? 0} design-shape answers, ${optOuts.length} opt-outs)\n`);
    }
    return 0;
  }

  const writeResult = await writePreflightRecord({
    projectRoot, tree, record, optOuts, options: {},
  });
  if (writeResult && 'kind' in writeResult && 'message' in writeResult) {
    if (writeResult.kind === 'ioFailure') { writeUnexpectedFailure(writeResult, stderr); return 1; }
    stderr.write(`[error] ${writeResult.kind} ${writeResult.message}\n`);
    if (writeResult.kind === 'usage') return 2;
    if (writeResult.kind === 'validation' || writeResult.kind === 'brokenReference') return 3;
    return 1;
  }

  if (flags.json) stdout.write(`${JSON.stringify({ record, optOuts }, null, 2)}\n`);
  if (!flags.quiet) {
    stdout.write(`preflight: wrote ${record.id} to rcf/manifest.json (${record.servicesInScope.length} services, ${record.designShapeAnswers?.length ?? 0} design-shape answers)`);
    if (optOuts.length > 0) stdout.write(` and ${optOuts.length} baseline opt-out(s)`);
    stdout.write('.\n');
    if (writeResult.skippedUiBaseline && (record.designShapeAnswers ?? []).length > 0) {
      stdout.write('  Note: uiBaseline defaults writes are fenced pending Track B (UI design gate). The opt-out ledger carries the linkedPreFlightConfigRef for Track B to consume when it lands.\n');
    }
  }
  return 0;
}
