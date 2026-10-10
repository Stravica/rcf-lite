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

import { walkTree, validateComposedRecord } from '#core/store';
import { FIDELITY_LEVELS } from '../intake/fidelity.js';

import { findProjectRoot } from '../view/index.js';
import {
  runIntakePhases,
  writeIntakeRecord,
} from '../intake/index.js';
import {
  JOURNEY_FILE,
  JourneyRecordError,
  emptyJourneyRecord,
  readJourneyRecord,
  serialiseJourneyRecord,
  writeJourneyRecord,
} from '../discovery/record.js';
import { matchUiSignals } from '#core/patterns/ui-shapes';

// FBS-211 proposal rule (ADR-4143): translate a UI-signal match set into
// one advisory posture value. Any central-shape noun (dashboard, admin,
// nav, navigation, layout, sidebar, modal, component, table, header,
// footer) proposes 'central'; any other signal proposes 'light'; no
// signal proposes 'none'. The matcher's output is the floor; the
// operator's answer is still what gets written (AC-18901-3).
const CENTRAL_PROPOSAL_TOKENS = new Set([
  'dashboard', 'admin', 'nav', 'navigation', 'layout', 'sidebar',
  'modal', 'component', 'table', 'header', 'footer',
]);

function proposalFromSignals(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return 'none';
  for (const s of signals) {
    const token = typeof s?.match === 'string' ? s.match.toLowerCase() : '';
    if (CENTRAL_PROPOSAL_TOKENS.has(token)) return 'central';
  }
  return 'light';
}

const OPTION_SPEC = {
  artefact: { type: 'string', multiple: true },
  kind: { type: 'string' },
  input: { type: 'string' },
  ui: { type: 'string' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

const UI_VALUES = ['none', 'light', 'central'];

export const HELP = `Usage: rcf discover intake [--artefact <path>[,path]] [--kind <kind>] [--dry-run]
       rcf discover intake --input <config.json> [--dry-run]

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
                             + findings + acknowledgements. The
                             fidelity in the input file must be one
                             of the allowed values below. The input
                             file carries ui (none|light|central) too
                             in non-interactive mode; its absence
                             exits 2 and writes nothing (ADR-4143).
  --ui <none|light|central>  Declare the UI posture for this intake run.
                             Writes the discovery journey record with
                             declaredVia 'intake'. In interactive mode
                             intake asks for a value when omitted.
  --dry-run                  Print the plan without writing the record;
                             the composed record is still run through
                             the same manifest schema pass the write
                             path runs (0.28.2 fix for #230), so a
                             preview fails on the same schema misses.
  --json                     Emit the intakeClassification block as JSON
  --quiet                    Suppress non-error confirmations
  --help                     Print this help

Fidelity enum (allowed values on --input.fidelity):
  ${FIDELITY_LEVELS.join(', ')}

Exit codes:
  0  success
  2  usage error (missing --artefact/--input, unreadable file)
  3  validation failure on the composed record (including --dry-run)
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

  // ADR-4143 UI declaration gate: intake must land a declaration on
  // the discovery journey record. In --input mode a missing ui field
  // exits 2 with no writes (AC-18901-4). On the command line, --ui
  // supplies the value; omitted on an interactive stdin we ask (and
  // print the matcher signals as advice). An absent flag with no TTY
  // and no --input is a usage error. Mixing --input (which already
  // carries a ui field) with a CLI --ui is a usage error so an
  // operator never silently loses one of the two.
  if (input !== null && typeof flags.ui === 'string') {
    stderr.write('[error] usage intake: --ui and --input both set a ui field; pass only one.\n');
    return 2;
  }
  let uiDeclaration = null;
  if (input !== null) {
    if (typeof input.ui !== 'string') {
      stderr.write('[error] usage intake: --input is missing the ui field (one of none|light|central); nothing written.\n');
      return 2;
    }
    if (!UI_VALUES.includes(input.ui)) {
      stderr.write(`[error] usage intake: --input ui must be one of ${UI_VALUES.join(', ')} (got ${JSON.stringify(input.ui)}); nothing written.\n`);
      return 2;
    }
    uiDeclaration = input.ui;
  } else if (typeof flags.ui === 'string') {
    if (!UI_VALUES.includes(flags.ui)) {
      stderr.write(`[error] usage intake: --ui must be one of ${UI_VALUES.join(', ')} (got ${JSON.stringify(flags.ui)})\n`);
      return 2;
    }
    uiDeclaration = flags.ui;
  } else {
    const stdin = deps.stdin ?? process.stdin;
    const interactive = Boolean(stdout.isTTY && stdin.isTTY);
    if (!interactive) {
      stderr.write('[error] usage intake: --ui <none|light|central> is required (no TTY to ask)\n');
      return 2;
    }
    uiDeclaration = await promptForUi({ artefactPaths, projectRoot, stdin, stdout });
    if (uiDeclaration === null) {
      stderr.write('[error] usage intake: no ui value was supplied; nothing written.\n');
      return 2;
    }
  }

  const walkResult = await walkTree({ projectRoot });
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding - writes are validated against the post-write state (run 'rcf define validate' for details)\n`);
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

  // ADR-4143 (FBS-211): compose the next JourneyRecord BEFORE any
  // write. A parse / schema failure on the existing record surfaces
  // as exit 3 and nothing is written; an io failure surfaces as exit
  // 1. Only a readJourneyRecord that returns null (the grandfathered
  // state, ADR-4145) seeds from empty - a swallowed read error used
  // to overwrite a healthy record with an empty one (FBS-211 review
  // F5), which is now a hard refusal.
  let currentJourney;
  try {
    currentJourney = await readJourneyRecord(projectRoot);
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      const prefix = err.code === 'ioFailure' ? 'io' : 'refused define:';
      stderr.write(`[error] ${prefix} ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    throw err;
  }
  const baseJourney = currentJourney ?? emptyJourneyRecord();
  const nowIso = new Date().toISOString();
  /** @type {import('../discovery/record.js').JourneyRecord} */
  const nextJourney = {
    ...baseJourney,
    ui: uiDeclaration,
    declaredAt: nowIso,
    declaredVia: 'intake',
  };
  // Validate the composed journey record now so a bad write cannot
  // get past the next couple of steps and leave an intakeClassification
  // without its declaration (FBS-211 review F4).
  let plannedJourneyBytes;
  try {
    plannedJourneyBytes = serialiseJourneyRecord(nextJourney);
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      stderr.write(`[error] refused define: ${err.message}\n`);
      return 3;
    }
    throw err;
  }

  if (flags['dry-run']) {
    // 0.28.2 (issue #230): run the same schema pass the writer runs so
    // a preview no longer passes on a value the real run refuses.
    const dryValidation = validateComposedRecord({
      tree: walkResult.tree,
      record: outcome.record,
      verb: 'intake',
    });
    if (dryValidation) {
      stderr.write(`[error] ${dryValidation.kind} ${dryValidation.message}\n`);
      return 3;
    }
    if (flags.json) {
      stdout.write(`${JSON.stringify({
        verb: 'intake',
        dryRun: true,
        intakeClassification: outcome.record,
        journeyRecord: nextJourney,
      }, null, 2)}\n`);
    } else {
      stdout.write(`[dry-run] would write intakeClassification ${outcome.record.id} (fidelity=${outcome.record.fidelity}, findings=${outcome.record.validationFindings.length}, ui=${uiDeclaration})\n`);
      stdout.write(`[dry-run] would write ${JOURNEY_FILE}:\n`);
      stdout.write(plannedJourneyBytes);
    }
    return 0;
  }

  // Write the journey record first so an io failure never leaves a
  // lone intakeClassification without its declaration (FBS-211 review
  // F4). The journey write exits 1 on io failure (write path) and 3
  // on a schema failure (already caught above by serialiseJourneyRecord).
  try {
    await writeJourneyRecord({ projectRoot, record: nextJourney });
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      stderr.write(`[error] ${err.code === 'ioFailure' ? 'io' : 'refused define:'} ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    // Node fs errors do not come as JourneyRecordError - the writer's
    // mkdir / writeFile call surfaces them raw. Treat as io failure.
    stderr.write(`[error] io failed to write journey record: ${err && err.message ? err.message : String(err)}\n`);
    return 1;
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


export async function promptForUi({ artefactPaths, projectRoot, stdin, stdout }) {
  // Advice over the artefact text: run the shared matcher so the
  // operator sees the UI signals (if any) before answering, together
  // with a concrete proposal computed from those signals under a
  // documented rule. The signals never become the answer: the
  // operator's input is the declaration (AC-18901-3).
  let signals = [];
  if (Array.isArray(artefactPaths) && artefactPaths.length > 0) {
    try {
      let text = '';
      for (const raw of artefactPaths) {
        const abs = raw.startsWith('/') ? raw : `${projectRoot}/${raw}`;
        try {
          text += `\n${await readFile(abs, 'utf8')}`;
        } catch {
          // skipped: unreadable paths were already surfaced earlier
        }
      }
      signals = matchUiSignals(text);
    } catch {
      signals = [];
    }
  }
  const proposal = proposalFromSignals(signals);
  // C1 fold-in: show the actual matched text (deduped, lower-cased),
  // not the regex source. 'shows?' and friends read as noise; 'shows'
  // reads as a signal.
  const unique = Array.from(new Set(signals.map((s) => (typeof s?.match === 'string' ? s.match.toLowerCase() : null))
    .filter((t) => typeof t === 'string' && t.length > 0))).slice(0, 12);
  stdout.write(`UI signals in artefact text: ${unique.length === 0 ? '(none)' : unique.join(', ')}\n`);
  stdout.write(`Proposed: ${proposal}\n`);
  stdout.write('Declare the UI posture [none|light|central]: ');
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: stdin, output: stdout });
  let answer = null;
  try {
    const raw = await rl.question('');
    answer = typeof raw === 'string' ? raw.trim().toLowerCase() : null;
  } catch {
    // EOF (Ctrl+D) or AbortError on a closed stdin: no answer. Map to
    // null so main() returns exit 2 with nothing written (FBS-211
    // review F7). Any other failure folds the same way; a blown-up
    // readline is still 'the operator did not answer'.
    answer = null;
  } finally {
    try { rl.close(); } catch { /* already closed */ }
  }
  if (!answer || !UI_VALUES.includes(answer)) return null;
  return answer;
}
