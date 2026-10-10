// `rcf discover journey <add|import|show|check>` sub-dispatcher
// (REQ-189, TAC-4142, FBS-210 and FBS-212, US-18902 and US-18903).
//
// Verbs that live in this file:
//
//   add    : parse a line-grammar source, mint, write the record (FBS-210)
//   import : parse a prose-shape journey map, mint, write the record (FBS-210)
//   show   : print the record, --json emits the JourneyRecord verbatim (FBS-210)
//   check  : run the pure discovery check list and print one line per check (FBS-212)
//
// Later FBS add siblings alongside: `declare` arrives with FBS-211,
// `review` with FBS-214. FBS-211 and FBS-212 can be built in parallel
// because they add verb branches to the one dispatch table.
//
// Exit codes:
//   0 ok (check: every check passes OR notApplicable)
//   1 io failure
//   2 usage
//   3 grammar OR local-schema validation failure (write path or --dry-run)
//   4 check refused: discovery check verb (FBS-212) returned a failing check
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
  check [--json]            Run the pure discovery check list
                            (journeyPresent, stepsNameScreens,
                            reachable with dead-end distinction,
                            interruptions, wireframePerStep for
                            central only, wireframeFormat,
                            wireframeSelfContained) and print one
                            line per check. Exit 0 when every check
                            passes or is notApplicable; exit 4 on
                            any failing check.

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
    case 'check': return await runCheck({ argv: rest, deps: { stdout, stderr, cwd } });
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
      : parseJourneyMap(srcText, srcCanonical);
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
      stdout.write(`  Author one with 'rcf discover journey add --from <path>' or 'rcf discover journey import --from <path>'.\n`);
    }
    return 0;
  }
  if (parsed.values.json) {
    stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return 0;
  }
  renderRecord(record, stdout);
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
