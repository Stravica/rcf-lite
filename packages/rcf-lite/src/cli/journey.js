// `rcf discover journey <add|import|show|declare|check|review>` sub-dispatcher
// (REQ-189, TAC-4142, FBS-210, FBS-211, FBS-212, FBS-213; US-18902,
// US-18903, US-18904).
//
// Verbs that live in this file:
//
//   add     : parse a line-grammar source, mint, write the record (FBS-210)
//   import  : parse a prose-shape journey map, mint, write the record (FBS-210)
//   show    : print the record, --json emits the JourneyRecord verbatim (FBS-210)
//   declare : record the UI posture (ADR-4143), with --as-built and
//             --reason semantics for lowering a prior value (FBS-211)
//   check   : run the pure discovery check list and print one line per check (FBS-212)
//   review  : run the structural checks, print the one-line summary, and
//             stamp ReviewStamp sealed by the discoveryHash (FBS-213)
//
// FBS-213's review verb never writes a stamp when any structural
// check fails; see ADR-4146 for the single-reviewer D0 door.
//
// Exit codes:
//   0 ok (check: every check passes OR notApplicable; review: stamp written)
//   1 io failure
//   2 usage
//   3 grammar OR local-schema validation failure (write path or --dry-run)
//   4 check refused: discovery check verb (FBS-212) returned a failing check,
//     or review verb refused because a structural check failed (FBS-213)
//
// The write path and --dry-run run the SAME local-schema pass, so a
// preview can never pass what the write would refuse (AC-18902-6).
//
// Node built-ins only.

import { readFile, realpath } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { relative, resolve, isAbsolute, join } from 'node:path';

import {
  GrammarError,
  parseJourneyLines,
  parseJourneyMap,
} from '../discovery/grammar.js';
import {
  MintError,
  mintJourney,
  refuseHandSuppliedIds,
} from '../discovery/mint.js';
import {
  JOURNEY_FILE,
  JourneyRecordError,
  emptyJourneyRecord,
  readJourneyRecord,
  serialiseJourneyRecord,
  writeJourneyRecord,
} from '../discovery/record.js';
import { checkDiscovery } from '../discovery/check.js';
import { discoveryHash, fileSha256 } from '../discovery/hash.js';
import { findProjectRoot } from '../view/index.js';

export const HELP = `Usage: rcf discover journey <verb> [options]

Author and inspect the journey record (rcf/discovery/journey.json).
The ux-designer and product-owner roles write journey sources; this
verb reads them, mints JNY/SCR ids by slug (never from a flag) and
writes the record through the one canonical-JSON writer.

Verbs:
  add --from <path> [--dry-run] [--json]
                            Parse one journey source in the line
                            grammar and mint it into the record.
  import --from <path> [--dry-run] [--json]
                            Parse one journey-map document in the
                            ux-designer prose shape and mint it.
  show [--json]             Print every journey with its steps,
                            interruption answers and review state.
                            --json emits the JourneyRecord verbatim.
  declare --ui <none|light|central> [--as-built] [--reason <text>]
                            Record the UI posture on the project.
                            Lowering a prior declaration (central to
                            light, or either to none) is refused
                            without --reason. --as-built flips the
                            asBuilt flag to true; omitting it leaves
                            the flag as it was.
  check [--json]            Run the pure discovery check list
                            (journeyPresent, stepsNameScreens,
                            reachable with dead-end distinction,
                            interruptions, wireframePerStep for
                            central only, wireframeFormat,
                            wireframeSelfContained, reviewed) and
                            print one line per check. Exit 0 when
                            every check passes or is notApplicable;
                            exit 4 on any failing check.
  review --by <name> [--note <text>] [--dry-run]
                            Run the structural check list; on a full
                            pass, print the one-line summary
                            (journeys, steps, screens, interruptions
                            mapped) and stamp ReviewStamp sealed by
                            the discoveryHash. Exit 0 on stamp
                            written, 4 when any structural check
                            fails (no stamp is written in that case).
                            --dry-run prints the summary and the hash
                            that would be stamped, but writes nothing.

Options common to add / import:
  --from <path>             Repo-relative or absolute path of the
                            authored source file.
  --dry-run                 Print the planned mints and the schema
                            verdict; write nothing. The composed
                            record is still run through the local
                            schema the write path uses.
  --json                    Emit a machine-readable envelope.

Exit codes:
  0  success (check: every check passes or is notApplicable)
  1  io failure
  2  usage error
  3  grammar failure (naming file, line, rule) or local-schema failure
  4  check refused: any discovery:* check failed

Notes:
  - Ids are minted by rcf-lite. The verb never accepts a hand-supplied
    JNY, JNY-step or SCR id, and never records a Figma or Confluence
    URL as Screen.wireframe.
  - rcf/discovery/ is invisible to the dogfood walker (loader
    subdirFor returns null for 'discovery'); journey.json is a
    sidecar like rcf/define/*.json.
`;

const COMMON_OPTIONS = {
  from: { type: 'string' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
};

/**
 * @param {string[]} argv - argv slice after `journey`
 * @param {object} [deps]
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    stdout.write(HELP);
    return argv.length === 0 ? 2 : 0;
  }
  const verb = argv[0];
  const rest = argv.slice(1);
  switch (verb) {
    case 'add': return await runAddOrImport({ argv: rest, deps: { stdout, stderr, cwd }, mode: 'add' });
    case 'import': return await runAddOrImport({ argv: rest, deps: { stdout, stderr, cwd }, mode: 'import' });
    case 'show': return await runShow({ argv: rest, deps: { stdout, stderr, cwd } });
    case 'declare': return await runDeclare({ argv: rest, deps: { stdout, stderr, cwd } });
    case 'check': return await runCheck({ argv: rest, deps: { stdout, stderr, cwd } });
    case 'review': return await runReview({ argv: rest, deps: { stdout, stderr, cwd } });
    default: {
      stderr.write(`[error] usage unknown sub-verb '${verb}' under 'discover journey'.\n`);
      stderr.write(HELP);
      return 2;
    }
  }
}

async function runAddOrImport({ argv, deps, mode }) {
  const { stdout, stderr, cwd } = deps;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: COMMON_OPTIONS, strict: true, allowPositionals: false });
  } catch (err) {
    stderr.write(`[error] usage journey ${mode}: ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(HELP);
    return 0;
  }
  if (!parsed.values.from) {
    stderr.write(`[error] usage journey ${mode}: --from <path> is required\n`);
    return 2;
  }
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write(`[error] usage journey ${mode}: no rcf/manifest.json found in '${cwd}' or any ancestor. Run 'rcf init' first.\n`);
    return 2;
  }
  const srcAbs = isAbsolute(parsed.values.from)
    ? parsed.values.from
    : resolve(cwd, parsed.values.from);
  // Normalise both paths through realpath so a macOS /var -> /private/var
  // symlink mismatch between cwd and the --from argument does not drag
  // a '..' prefix into Journey.source. The source file must exist for
  // realpath to work, so this doubles as an early readability check.
  let srcCanonical;
  try {
    srcCanonical = await realpath(srcAbs);
  } catch (err) {
    stderr.write(`[error] io journey ${mode}: cannot resolve ${srcAbs}: ${/** @type {Error} */ (err).message}\n`);
    return 1;
  }
  const rootCanonical = await realpath(projectRoot);
  const srcRel = relRepoPath(rootCanonical, srcCanonical);
  let srcText;
  try {
    srcText = await readFile(srcCanonical, 'utf8');
  } catch (err) {
    stderr.write(`[error] io journey ${mode}: cannot read ${srcRel}: ${/** @type {Error} */ (err).message}\n`);
    return 1;
  }

  let draft;
  try {
    draft = mode === 'add'
      ? parseJourneyLines(srcText, srcRel)
      : parseJourneyMap(srcText, srcCanonical, { displaySource: srcRel });
  } catch (err) {
    if (err instanceof GrammarError) {
      stderr.write(`[error] refused define: ${err.message}\n`);
      return 3;
    }
    throw err;
  }
  // After parseJourneyMap, the source stored on the draft is the
  // absolute path (so the wireframe side-car check runs against the
  // real directory). Replace it with the repo-relative path before
  // minting so Journey.source matches the AC-18902-1 expectation.
  if (mode === 'import') draft.source = srcRel;

  // Defence in depth for AC-18902-7: refuse any hand-supplied id.
  try {
    refuseHandSuppliedIds(draft);
  } catch (err) {
    stderr.write(`[error] refused define: ${/** @type {Error} */ (err).message}\n`);
    return 3;
  }

  let currentRecord;
  try {
    currentRecord = await readJourneyRecord(rootCanonical);
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      stderr.write(`[error] refused define: ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    throw err;
  }
  const baseRecord = currentRecord ?? emptyJourneyRecord();
  // If a wireframe path was resolved by the prose parser, normalise it
  // to repo-relative before it lands on the Screen record.
  await normaliseWireframePaths(draft, rootCanonical);

  let minted;
  try {
    minted = mintJourney({ record: baseRecord, draft });
  } catch (err) {
    if (err instanceof MintError) {
      stderr.write(`[error] refused define: ${err.message}\n`);
      return 3;
    }
    throw err;
  }

  // Dry-run: validate the composed record through the same local
  // schema the write path runs (AC-18902-6). Writes nothing.
  if (parsed.values['dry-run']) {
    let planned;
    try {
      planned = serialiseJourneyRecord(minted.record);
    } catch (err) {
      if (err instanceof JourneyRecordError) {
        stderr.write(`[error] refused define: ${err.message}\n`);
        return 3;
      }
      throw err;
    }
    const bytesBefore = currentRecord ? serialiseJourneyRecord(currentRecord) : '';
    const bytesIdentical = currentRecord !== null && planned === bytesBefore;
    if (parsed.values.json) {
      stdout.write(`${JSON.stringify({
        verb: mode,
        from: srcRel,
        dryRun: true,
        mintedJourney: minted.mintedJourney,
        newSlugs: minted.newSlugs,
        bytesIdentical,
      }, null, 2)}\n`);
    } else {
      stdout.write(`[dry-run] journey ${mode} would ${minted.newSlugs.journey ? 'mint' : 're-mint'} ${minted.mintedJourney.id} (${minted.mintedJourney.slug}).\n`);
      stdout.write(`  new screens: ${minted.newSlugs.screens.length === 0 ? '(none)' : minted.newSlugs.screens.join(', ')}\n`);
      stdout.write(`  new steps:   ${minted.newSlugs.steps.length === 0 ? '(none)' : minted.newSlugs.steps.join(', ')}\n`);
      stdout.write(`  ${bytesIdentical ? `${JOURNEY_FILE} would be byte-identical to the current file.` : `${JOURNEY_FILE} would change.`}\n`);
      stdout.write(`  local-schema: ok\n`);
    }
    return 0;
  }

  let result;
  try {
    result = await writeJourneyRecord({ projectRoot: rootCanonical, record: minted.record });
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      stderr.write(`[error] refused define: ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    throw err;
  }

  if (parsed.values.json) {
    stdout.write(`${JSON.stringify({
      verb: mode,
      from: srcRel,
      written: relRepoPath(rootCanonical, result.filePath),
      mintedJourney: minted.mintedJourney,
      newSlugs: minted.newSlugs,
    }, null, 2)}\n`);
  } else {
    stdout.write(`[ok] journey ${mode}: ${minted.newSlugs.journey ? 'minted' : 're-minted'} ${minted.mintedJourney.id} (${minted.mintedJourney.slug}) from ${srcRel}\n`);
    if (minted.newSlugs.screens.length > 0) {
      stdout.write(`  new screens: ${minted.newSlugs.screens.join(', ')}\n`);
    }
    if (minted.newSlugs.steps.length > 0) {
      stdout.write(`  new steps:   ${minted.newSlugs.steps.join(', ')}\n`);
    }
    stdout.write(`  written to:  ${relRepoPath(rootCanonical, result.filePath)}\n`);
  }
  return 0;
}

async function runShow({ argv, deps }) {
  const { stdout, stderr, cwd } = deps;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { json: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true, allowPositionals: false });
  } catch (err) {
    stderr.write(`[error] usage journey show: ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(HELP);
    return 0;
  }
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write(`[error] usage journey show: no rcf/manifest.json found in '${cwd}' or any ancestor.\n`);
    return 2;
  }
  const rootCanonical = await realpath(projectRoot);
  let record;
  try {
    record = await readJourneyRecord(rootCanonical);
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      // TAC-4142 exit-code family: 1 for I/O failures, 3 for schema or
      // parse failures. readJourneyRecord tags filesystem errors with
      // code ioFailure; keep that distinction so a permission or disk
      // problem does not read as a validation refusal.
      const prefix = err.code === 'ioFailure' ? 'io' : 'refused define:';
      stderr.write(`[error] ${prefix} ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    throw err;
  }
  if (record === null) {
    if (parsed.values.json) {
      stdout.write(`${JSON.stringify({ record: null, note: 'no rcf/discovery/journey.json (the grandfathered state)' })}\n`);
    } else {
      stdout.write(`[notice] no ${JOURNEY_FILE}: this project has no journey record yet.\n`);
      stdout.write(`  Author one through the journey authoring verbs on this command, or declare the UI posture to seed a record on an existing tree.\n`);
      // TAC-4142 interfaces[show]: an absent record folds to
      // notApplicable with a reason (FBS-211 review F11).
      stdout.write(`notApplicable: no journey record on this tree (grandfathered, ADR-4145); discovery checks fold to notApplicable until a declare run or an intake run seeds the record.\n`);
    }
    return 0;
  }
  if (parsed.values.json) {
    stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return 0;
  }
  renderRecord(record, stdout);
  // TAC-4142 interfaces[show]: a none product folds to notApplicable
  // with a reason in the text output (FBS-211 review F11); --json
  // round-trips the record verbatim and so does not carry this line.
  if (record.ui === 'none') {
    stdout.write(`notApplicable: ui=none means this product has no UI surface; discovery journey checks fold to notApplicable for the whole tree.\n`);
  }
  return 0;
}

const DECLARE_OPTIONS = {
  ui: { type: 'string' },
  'as-built': { type: 'boolean' },
  reason: { type: 'string' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
};

const UI_RANK = new Map([['none', 0], ['light', 1], ['central', 2]]);

async function runDeclare({ argv, deps }) {
  const { stdout, stderr, cwd } = deps;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: DECLARE_OPTIONS, strict: true, allowPositionals: false });
  } catch (err) {
    stderr.write(`[error] usage journey declare: ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(HELP);
    return 0;
  }
  const ui = parsed.values.ui;
  if (!ui) {
    stderr.write(`[error] usage journey declare: --ui <none|light|central> is required\n`);
    return 2;
  }
  if (!UI_RANK.has(ui)) {
    stderr.write(`[error] usage journey declare: --ui must be one of none, light, central (got ${JSON.stringify(ui)})\n`);
    return 2;
  }
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write(`[error] usage journey declare: no rcf/manifest.json found in '${cwd}' or any ancestor. Run 'rcf init' first.\n`);
    return 2;
  }
  const rootCanonical = await realpath(projectRoot);
  let current;
  try {
    current = await readJourneyRecord(rootCanonical);
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      const prefix = err.code === 'ioFailure' ? 'io' : 'refused define:';
      stderr.write(`[error] ${prefix} ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    throw err;
  }
  // Lowering check against the prior declared value. A null prior
  // (grandfathered tree, or an init seed with ui === null) never
  // counts as a lowering since the operator has not previously
  // declared a value they are now walking back.
  const priorUi = current && current.ui ? current.ui : null;
  const nextRank = UI_RANK.get(ui);
  const priorRank = priorUi ? UI_RANK.get(priorUi) : null;
  const isLowering = priorRank !== null && nextRank < priorRank;
  // The --reason text must carry something after trim; a whitespace-
  // only reason used to satisfy the lowering rule and left blank
  // characters on disk (FBS-211 review F8).
  const reasonText = typeof parsed.values.reason === 'string' ? parsed.values.reason.trim() : '';
  if (isLowering && reasonText.length === 0) {
    stderr.write(`[error] usage journey declare: lowering ${priorUi} to ${ui} requires --reason <text>\n`);
    return 2;
  }
  const base = current ?? emptyJourneyRecord();
  const asBuilt = parsed.values['as-built'] === true ? true : Boolean(base.asBuilt);
  const nowIso = new Date().toISOString();
  // declaredReason is set ONLY on a declare that lowers the posture.
  // A declare that is not a lowering clears any prior reason, so a
  // central -> light --reason "..." declare followed by central
  // --as-built does not leave the earlier reason stale on the record
  // (FBS-211 review F9).
  /** @type {import('../discovery/record.js').JourneyRecord} */
  const next = {
    ...base,
    ui,
    declaredAt: nowIso,
    declaredBy: base.declaredBy ?? null,
    declaredReason: isLowering ? reasonText : null,
    declaredVia: 'declare',
    asBuilt,
  };
  if (parsed.values['dry-run']) {
    let planned;
    try {
      planned = serialiseJourneyRecord(next);
    } catch (err) {
      if (err instanceof JourneyRecordError) {
        stderr.write(`[error] refused define: ${err.message}\n`);
        return 3;
      }
      throw err;
    }
    const bytesBefore = current ? serialiseJourneyRecord(current) : '';
    const bytesIdentical = current !== null && planned === bytesBefore;
    if (parsed.values.json) {
      stdout.write(`${JSON.stringify({
        verb: 'declare',
        ui,
        asBuilt,
        declaredVia: 'declare',
        dryRun: true,
        bytesIdentical,
        journeyRecord: next,
      }, null, 2)}\n`);
    } else {
      stdout.write(`[dry-run] journey declare would set ui=${ui}, asBuilt=${asBuilt}, declaredVia=declare.\n`);
      stdout.write(`  ${bytesIdentical ? `${JOURNEY_FILE} would be byte-identical to the current file.` : `${JOURNEY_FILE} would change.`}\n`);
      stdout.write(`  local-schema: ok\n`);
      stdout.write(`[dry-run] would write ${JOURNEY_FILE}:\n`);
      stdout.write(planned);
    }
    return 0;
  }
  try {
    await writeJourneyRecord({ projectRoot: rootCanonical, record: next });
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      stderr.write(`[error] refused define: ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    throw err;
  }
  if (parsed.values.json) {
    stdout.write(`${JSON.stringify({
      verb: 'declare',
      ui,
      asBuilt,
      declaredVia: 'declare',
      declaredAt: nowIso,
    }, null, 2)}\n`);
  } else {
    stdout.write(`[ok] journey declare: ui=${ui}, asBuilt=${asBuilt}, declaredVia=declare (at ${nowIso}).\n`);
  }
  return 0;
}

function renderRecord(record, stdout) {
  const ui = record.ui === null ? 'not declared' : record.ui;
  stdout.write(`UI: ${ui}`);
  if (record.declaredVia) stdout.write(` (via ${record.declaredVia}`);
  if (record.declaredBy) stdout.write(`, by ${record.declaredBy}`);
  if (record.declaredVia) stdout.write(`)`);
  stdout.write('\n');
  stdout.write(`asBuilt: ${record.asBuilt}\n`);
  stdout.write(`screens: ${record.screens.length}\n`);
  stdout.write(`journeys: ${record.journeys.length}\n`);
  for (const j of record.journeys) {
    stdout.write(`\n${j.id} ${j.slug}`);
    if (j.actor) stdout.write(` (actor: ${j.actor})`);
    if (j.goal) stdout.write(` (goal: ${j.goal})`);
    stdout.write(`\n  source: ${j.source}\n`);
    for (const step of j.steps) {
      const screen = record.screens.find((s) => s.id === step.screenId);
      const screenSlug = screen ? screen.slug : step.screenId;
      const label = step.label ? ` - ${step.label}` : '';
      const next = step.next.length === 0 ? '' : `  next: ${step.next.join(', ')}`;
      const returns = step.returnsTo ? `  returnsTo: ${step.returnsTo}` : '';
      stdout.write(`  ${step.id} ${step.kind} ${step.slug} @${screenSlug}${label}${next}${returns}\n`);
    }
    if (j.interruptions && Object.keys(j.interruptions).length > 0) {
      stdout.write(`  interruptions:\n`);
      for (const [entry, value] of Object.entries(j.interruptions)) {
        stdout.write(`    ${entry} = ${value}\n`);
      }
    }
  }
  const review = record.review;
  stdout.write(`\nreview: ${review === null ? 'none' : review.state}\n`);
}

function relRepoPath(projectRoot, absPath) {
  const rel = relative(projectRoot, absPath);
  return rel.split('\\').join('/');
}

/**
 * `rcf discover journey check` (FBS-212, US-18903). Runs the pure
 * discovery check list and prints one line per check. The verb owns
 * every filesystem read the check needs: it loads the record, loads
 * every wireframe file the record names, and hands the bytes to
 * checkDiscovery which is pure.
 *
 * AC-18903-7 contract: a declared none product or an absent record
 * reads no wireframe file. checkDiscovery folds those two cases to
 * one notApplicable entry before any wireframe path is examined;
 * this function therefore skips the wireframe read loop entirely
 * when the record is absent, and when the record declares ui none
 * it still calls checkDiscovery with an empty wireframes map (the
 * fold happens there).
 */
async function runCheck({ argv, deps }) {
  const { stdout, stderr, cwd } = deps;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { json: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true, allowPositionals: false });
  } catch (err) {
    stderr.write(`[error] usage journey check: ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(HELP);
    return 0;
  }
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write(`[error] usage journey check: no rcf/manifest.json found in '${cwd}' or any ancestor.\n`);
    return 2;
  }
  const rootCanonical = await realpath(projectRoot);
  let record;
  try {
    record = await readJourneyRecord(rootCanonical);
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      const prefix = err.code === 'ioFailure' ? 'io' : 'refused define:';
      stderr.write(`[error] ${prefix} ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    throw err;
  }

  // AC-18903-7: an absent record folds to notApplicable without
  // reading any wireframe file. We hand checkDiscovery a null record
  // and skip the file-load loop entirely.
  if (record === null) {
    const results = checkDiscovery({ record: null, ui: null, wireframes: new Map() });
    return printCheckResults(results, parsed.values.json, stdout);
  }
  // AC-18903-7: an init-seeded undeclared record (ui null, declaredVia
  // 'init', zero journeys) is the same grandfathered state as an
  // absent file (ADR-4145). The fold happens in checkDiscovery when
  // ui is null; we also skip the wireframe load to honour the "reads
  // no wireframe file" contract.
  if (record.ui === null) {
    const results = checkDiscovery({ record, ui: null, wireframes: new Map() });
    return printCheckResults(results, parsed.values.json, stdout);
  }
  // AC-18903-7: declared none also folds; checkDiscovery handles that
  // but we still skip the wireframe load to honour the "reads no
  // wireframe file" contract.
  if (record.ui === 'none') {
    const results = checkDiscovery({ record, ui: 'none', wireframes: new Map() });
    return printCheckResults(results, parsed.values.json, stdout);
  }

  // Load wireframe files. The caller passes bytes (and utf-8 text for
  // .html) in the shape checkDiscovery expects. A missing file is
  // recorded by its absence from the map, which lets the pure check
  // report wireframePerStep correctly without this loader deciding
  // what central vs light means.
  const wireframes = new Map();
  for (const screen of record.screens) {
    if (!screen.wireframe) continue;
    const absPath = join(rootCanonical, screen.wireframe);
    let bytes;
    try {
      bytes = await readFile(absPath);
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (code === 'ENOENT') {
        // Absent: do not add to the map (wireframePerStep reports it
        // for central; a light product does not fail).
        continue;
      }
      stderr.write(`[error] io journey check: cannot read ${screen.wireframe}: ${/** @type {Error} */ (err).message}\n`);
      return 1;
    }
    const entry = { bytes };
    const ext = screen.wireframe.toLowerCase();
    if (ext.endsWith('.html')) entry.text = bytes.toString('utf8');
    wireframes.set(screen.wireframe, entry);
  }

  const results = checkDiscovery({ record, ui: record.ui, wireframes });
  return printCheckResults(results, parsed.values.json, stdout);
}

/**
 * Print the check results in text or JSON form. Returns the exit code
 * the check verb should return (0 when every result is pass or
 * notApplicable, 4 when any is fail).
 *
 * @param {Array<{id:string,state:'pass'|'fail'|'notApplicable',why:string,failingIds?:string[]}>} results
 * @param {boolean | undefined} asJson
 * @param {{ write: (s:string)=>void }} stdout
 * @returns {number}
 */
function printCheckResults(results, asJson, stdout) {
  const anyFail = results.some((r) => r.state === 'fail');
  if (asJson) {
    stdout.write(`${JSON.stringify({ exit: anyFail ? 4 : 0, results }, null, 2)}\n`);
    return anyFail ? 4 : 0;
  }
  for (const r of results) {
    const tag = r.state === 'pass' ? 'ok' : r.state === 'notApplicable' ? 'n/a' : 'fail';
    const line = r.why ? `[${tag}] ${r.id}: ${r.why}` : `[${tag}] ${r.id}`;
    stdout.write(`${line}\n`);
  }
  if (anyFail) {
    stdout.write(`[refused] discovery check failed; see failing lines above.\n`);
  } else {
    stdout.write(`[ok] discovery check passed.\n`);
  }
  return anyFail ? 4 : 0;
}

async function normaliseWireframePaths(draft, projectRoot) {
  const map = draft.__wireframeBySlug;
  if (!(map instanceof Map)) return;
  for (const [slug, absPath] of map.entries()) {
    let canonical = absPath;
    try { canonical = await realpath(absPath); } catch { /* keep as-is */ }
    map.set(slug, relRepoPath(projectRoot, canonical));
  }
}

/**
 * `rcf discover journey review` (FBS-213, US-18904). Runs the structural
 * discovery check list; on a full pass computes the discoveryHash and
 * the per-wireframe sha256 hashes, prints the one-line summary, and
 * writes ReviewStamp onto the record.
 *
 * AC-18904-3: on any failing check the verb exits 4 and writes no
 * ReviewStamp.
 * AC-18904-2: the one-line summary (journeys, steps, screens,
 * interruptions mapped) is printed BEFORE the write.
 * AC-18904-5: ReviewStamp is written only by this verb. Other verbs
 * (add, import, declare) never set record.review; the managed
 * agent-instructions block names this discipline so the harness never
 * runs review on its own.
 */
async function runReview({ argv, deps }) {
  const { stdout, stderr, cwd } = deps;
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        by: { type: 'string' },
        note: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    stderr.write(`[error] usage journey review: ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(HELP);
    return 0;
  }
  const by = typeof parsed.values.by === 'string' ? parsed.values.by.trim() : '';
  if (by.length === 0) {
    stderr.write(`[error] usage journey review: --by <name> is required\n`);
    return 2;
  }
  const note = typeof parsed.values.note === 'string' ? parsed.values.note.trim() : '';
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write(`[error] usage journey review: no rcf/manifest.json found in '${cwd}' or any ancestor.\n`);
    return 2;
  }
  const rootCanonical = await realpath(projectRoot);
  let record;
  try {
    record = await readJourneyRecord(rootCanonical);
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      const prefix = err.code === 'ioFailure' ? 'io' : 'refused define:';
      stderr.write(`[error] ${prefix} ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    throw err;
  }
  if (record === null) {
    stderr.write(`[error] refused define: no ${JOURNEY_FILE}: author a record with 'rcf discover journey add' or 'rcf discover journey import' before review.\n`);
    return 3;
  }
  if (record.ui === 'none') {
    stderr.write(`[error] refused define: ui is declared none; nothing to review (no journey, wireframes or review required on a none product).\n`);
    return 3;
  }

  // Load wireframes; same loader shape as runCheck.
  const wireframes = new Map();
  for (const screen of record.screens) {
    if (!screen.wireframe) continue;
    const absPath = join(rootCanonical, screen.wireframe);
    let bytes;
    try {
      bytes = await readFile(absPath);
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (code === 'ENOENT') continue;
      stderr.write(`[error] io journey review: cannot read ${screen.wireframe}: ${/** @type {Error} */ (err).message}\n`);
      return 1;
    }
    const entry = { bytes };
    const ext = screen.wireframe.toLowerCase();
    if (ext.endsWith('.html')) entry.text = bytes.toString('utf8');
    wireframes.set(screen.wireframe, entry);
  }

  const results = checkDiscovery({ record, ui: record.ui, wireframes });
  // Structural view = every check EXCEPT discovery:reviewed. A fail on
  // discovery:reviewed is caused by this very stamp being absent or
  // stale, which the review verb is here to replace; it never blocks
  // the write.
  const structural = results.filter((r) => r.id !== 'discovery:reviewed');
  const failing = structural.filter((r) => r.state === 'fail');
  if (failing.length > 0) {
    if (parsed.values.json) {
      stdout.write(`${JSON.stringify({ exit: 4, written: false, failing: failing.map((f) => ({ id: f.id, why: f.why, failingIds: f.failingIds ?? [] })) }, null, 2)}\n`);
    } else {
      for (const r of structural) {
        const tag = r.state === 'pass' ? 'ok' : r.state === 'notApplicable' ? 'n/a' : 'fail';
        const line = r.why ? `[${tag}] ${r.id}: ${r.why}` : `[${tag}] ${r.id}`;
        stdout.write(`${line}\n`);
      }
      stdout.write(`[refused] journey review refused: ${failing.length} failing structural check(s); no ReviewStamp written.\n`);
    }
    return 4;
  }

  // Compute the summary counts and the stamp.
  const journeyCount = record.journeys.length;
  const stepCount = record.journeys.reduce((n, j) => n + j.steps.length, 0);
  const screenCount = record.screens.length;
  const interruptionsMapped = countInterruptionsMapped(record);
  const summary = `${journeyCount} journey${journeyCount === 1 ? '' : 's'}, ${stepCount} step${stepCount === 1 ? '' : 's'}, ${screenCount} screen${screenCount === 1 ? '' : 's'}, ${interruptionsMapped} interruption${interruptionsMapped === 1 ? '' : 's'} mapped`;
  stdout.write(`[ok] discovery review: ${summary}.\n`);

  const wireframePairs = [];
  for (const [path, entry] of wireframes.entries()) {
    if (entry && entry.bytes) wireframePairs.push({ path, sha256: fileSha256(entry.bytes) });
  }
  wireframePairs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = discoveryHash(record, wireframePairs);
  const wireframeHashes = {};
  for (const pair of wireframePairs) wireframeHashes[pair.path] = pair.sha256;

  const stamped = {
    ...record,
    review: {
      state: 'reviewed',
      by,
      ...(note.length > 0 ? { note } : {}),
      at: { time: new Date().toISOString(), hash },
      wireframeHashes,
    },
  };

  try {
    await writeJourneyRecord({ projectRoot: rootCanonical, record: stamped });
  } catch (err) {
    if (err instanceof JourneyRecordError) {
      stderr.write(`[error] refused define: ${err.message}\n`);
      return err.code === 'ioFailure' ? 1 : 3;
    }
    throw err;
  }

  if (parsed.values.json) {
    stdout.write(`${JSON.stringify({
      verb: 'review',
      written: true,
      by,
      note: note.length > 0 ? note : null,
      summary: {
        journeys: journeyCount,
        steps: stepCount,
        screens: screenCount,
        interruptionsMapped,
      },
      discoveryHash: hash,
      wireframeHashes,
    }, null, 2)}\n`);
  } else {
    stdout.write(`  stamped by: ${by}\n`);
    stdout.write(`  discoveryHash: ${hash}\n`);
  }
  return 0;
}

/**
 * Count interruption catalogue entries that are mapped to a step
 * across every journey (i.e. the catalogue entries whose answer is a
 * step id, not a notApplicable reason).
 *
 * @param {import('../discovery/record.js').JourneyRecord} record
 * @returns {number}
 */
function countInterruptionsMapped(record) {
  let mapped = 0;
  for (const j of record.journeys) {
    const answers = j.interruptions && typeof j.interruptions === 'object' ? j.interruptions : {};
    for (const value of Object.values(answers)) {
      if (typeof value === 'string' && !value.startsWith('notApplicable:')) mapped += 1;
    }
  }
  return mapped;
}
