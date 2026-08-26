// `rcf intake` subcommand handler
// (elicitation-and-playbook-hardening-0.7.0-spec §6).
//
// Variable-fidelity intake stage. Classifies the supplied artefacts by
// fidelity (none | napkin | briefLight | briefStrong | prd | prdPlusTad
// per spec §3.7), applies elicitation-integrity discipline (§6.4 phase 2
// scans: impliedButNotStated, contradiction, missingLoadBearingConstraint),
// records validation findings, and writes an intakeClassification record
// to the manifest. Elicitation of gaps handed off to the standard
// playbook §3-§7 (this verb closes at phase 2).

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { walkTree } from '#core/store';

import { findProjectRoot } from '../view/index.js';
import {
  runIntakePhases,
  writeIntakeRecord,
} from '../intake/index.js';

const OPTION_SPEC = {
  artefact: { type: 'string', multiple: true },
  kind: { type: 'string' },
  input: { type: 'string' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf discover intake [--artefact <path>[,path]] [--kind <kind>] [--dry-run]
       rcf intake --input <config.json> [--dry-run]

Variable-fidelity intake: read what the operator supplied, classify its
fidelity, validate it against elicitation integrity, and record an
intakeClassification block on the manifest. Runs BEFORE the standard
elicitation playbook when the operator has any starting material.

Options:
  --artefact <path>[,path]   One or more artefact file paths (repeatable
                             or comma-separated)
  --kind <kind>              Hint the artefact kind: napkin |
                             productBrief | prd | prdPlusTad | other
  --input <config.json>      Non-interactive mode: pre-filled artefacts
                             + findings + acknowledgements
  --dry-run                  Print the plan without writing the record
  --json                     Emit the intakeClassification block as JSON
  --quiet                    Suppress non-error confirmations
  --help                     Print this help

Exit codes:
  0  success
  2  usage error (missing --artefact/--input, unreadable file)
  3  validation failure on the written manifest
`;

/**
 * @param {string[]} argv
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
  if (flags.help) { stdout.write(HELP); return 0; }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  let input = null;
  if (flags.input) {
    try {
      input = JSON.parse(await readFile(flags.input, 'utf8'));
    } catch (err) {
      stderr.write(`[error] usage intake: cannot read --input file: ${err.message}\n`);
      return 2;
    }
  }

  const artefactPaths = [];
  if (input?.artefacts) {
    for (const a of input.artefacts) {
      if (typeof a?.path === 'string' && a.path.length > 0) artefactPaths.push(a.path);
    }
  }
  for (const raw of flags.artefact ?? []) {
    for (const p of raw.split(',').map((s) => s.trim()).filter(Boolean)) artefactPaths.push(p);
  }
  if (artefactPaths.length === 0 && !input?.fidelity) {
    stderr.write('[error] usage intake: at least one --artefact <path> is required (or an --input config with artefacts or a bare fidelity)\n');
    return 2;
  }

  const walkResult = await walkTree({ projectRoot });
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding - writes are validated against the post-write state (run 'rcf validate' for details)\n`);
  }

  const outcome = await runIntakePhases({
    projectRoot,
    artefactPaths,
    kindHint: flags.kind ?? null,
    input,
  });
  if (outcome && outcome.kind && typeof outcome.message === 'string') {
    stderr.write(`[error] ${outcome.kind} ${outcome.message}\n`);
    return outcome.kind === 'usage' ? 2 : 3;
  }

  if (flags['dry-run']) {
    if (flags.json) {
      stdout.write(`${JSON.stringify(outcome.record, null, 2)}\n`);
    } else {
      stdout.write(`[dry-run] would write intakeClassification ${outcome.record.id} (fidelity=${outcome.record.fidelity}, findings=${outcome.record.validationFindings.length})\n`);
    }
    return 0;
  }

  const result = await writeIntakeRecord({
    projectRoot,
    tree: walkResult.tree,
    record: outcome.record,
  });
  if (result && result.kind && typeof result.message === 'string') {
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    return 3;
  }

  if (flags.json) {
    stdout.write(`${JSON.stringify(outcome.record, null, 2)}\n`);
    return 0;
  }
  if (!flags.quiet) {
    stdout.write(`intake: ${outcome.record.id} fidelity=${outcome.record.fidelity} findings=${outcome.record.validationFindings.length}\n`);
  }
  return 0;
}
