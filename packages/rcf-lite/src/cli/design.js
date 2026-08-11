// `rcf design <fbs-id> [<sub-verb> ...]` handler
// (ui-design-gate-0.7.0-spec §5.5).
//
// Verb shapes:
//   rcf design <fbs-id>                          Dispatch the Design worker (no-op stub in v1; injection point).
//   rcf design <fbs-id> journeys add ...         Append a journey.
//   rcf design <fbs-id> nav set ...              Overwrite navModel.
//   rcf design <fbs-id> theme-a11y set ...       Overwrite themeAndA11y.
//   rcf design <fbs-id> --mark-complete          Set designStageComplete: true.
//
// Sub-verb positional-grammar constraint (spec §5.5): FBS ids match
// `/^FBS-\d+$/`, so no operator-typed slug can collide with a sub-verb
// noun. The parser enforces the pattern on the FBS positional: any
// positional in slot 0 that does not match /^FBS-\d+$/ is a usage
// error, not an FBS lookup miss. This closes the door on future
// refactors that accept slugs whose namespace could overlap with the
// sub-verb set.
//
// Design-worker dispatch: v1 does not spawn a subagent in-process (the
// dispatch pattern is deferred to the CLI harness or the operator);
// `rcf design <fbs-id>` with no sub-verb prints the current state and
// the operator's next-move options. This matches the Track A pattern
// where `rcf review` runs a deterministic audit and dispatches the
// mutation runner only via an injected dependency; wiring the Design
// worker's live dispatcher would enlarge scope beyond spec §5.3.

import { parseArgs } from 'node:util';
import process from 'node:process';

import { walkTree } from '#core/store';
import { writeUnexpectedFailure, rcfError } from '#core/errors';

import { findProjectRoot } from '../view/index.js';
import {
  missingDesignStageArtefacts,
  writeJourneyAdd,
  writeMarkComplete,
  writeNavSet,
  writeThemeA11ySet,
} from '../design/index.js';

const KNOWN_SUB_VERBS = new Set(['journeys', 'nav', 'theme-a11y']);
const FBS_ID_PATTERN = /^FBS-\d+$/;

const OPTION_SPEC = {
  // journeys add
  id: { type: 'string' },
  actor: { type: 'string' },
  goal: { type: 'string' },
  step: { type: 'string', multiple: true },
  // nav set
  shape: { type: 'string' },
  route: { type: 'string', multiple: true },
  'signed-in-as-affordance': { type: 'string' },
  notes: { type: 'string' },
  // theme-a11y set
  mode: { type: 'string' },
  tokens: { type: 'string' },
  'contrast-targets': { type: 'string' },
  'contrast-test': { type: 'string' },
  'contrast-before-palette': { type: 'string' },
  // mark-complete
  'mark-complete': { type: 'boolean' },
  // shared
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf design <fbs-id> [<sub-verb> ...] [options]

Design substage verbs for a UI-bearing FBS. FBS positional is required
and must match /^FBS-\\d+$/ (any other positional in that slot is a
usage error, not an FBS lookup miss).

Verb shapes:
  rcf design <fbs-id>                            Print the current design
                                                 state and next-move options.
  rcf design <fbs-id> journeys add ...           Append a journey.
  rcf design <fbs-id> nav set ...                Overwrite navModel.
  rcf design <fbs-id> theme-a11y set ...         Overwrite themeAndA11y.
  rcf design <fbs-id> --mark-complete            Set designStageComplete: true.

journeys add options:
  --id <slug>               Lowercase slug (a-z0-9-), unique within the FBS.
  --actor "..."             Short actor label.
  --goal "..."              One-line goal statement.
  --step "..." (2-8 times)  Walk-through steps.

nav set options:
  --shape <shape>           shared-persistent | shared-per-section | none-single-page | operator-declared-other
  --route <path=label:auth> One entry per route (auth is true|false); repeatable.
  --signed-in-as-affordance true|false   Whether authenticated routes show signed-in-as.
  --notes "..."             Free text; required in practice for operator-declared-other.

theme-a11y set options:
  --mode <themeMode>        light-default-with-toggle | dark-default-with-toggle | single-theme-declared
  --tokens <path>           Project-relative path to the design tokens module.
  --contrast-targets "..."  Short target statement (default: WCAG AA).
  --contrast-test <path>    Project-relative path to the contrast test.
  --contrast-before-palette true|false   Operator attestation on ordering.

--mark-complete options:
  --dry-run                 Print the intended change; do not write.

Common options:
  --json                    Emit the FBS's designStage block as JSON on success.
  --quiet                   Suppress non-error confirmations.
  --help                    Print this help.

Refusal shapes (spec §6.2):
  * FBS.uiBearing is true but no uiBaseline record on the manifest.
  * designStage baseline-vs-designStage disagreement without an opt-out.
  * --mark-complete when any of the three artefacts is missing or empty.

Exit codes:
  0  success
  1  IO / unexpected runtime failure
  2  usage error
  3  schema or tree validation failure
  4  refused (mark-complete or baseline disagreement)
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

  if (argv.length === 0) {
    stderr.write('[error] usage design: expected an <fbs-id> positional (e.g. FBS-016)\n');
    return 2;
  }
  if (argv[0] === '--help' || argv[0] === '-h') { stdout.write(HELP); return 0; }

  // Sub-verb positional grammar (§5.5): slot 0 MUST be an FBS id or
  // an error. Sub-verb collision is guarded by the FBS-id pattern
  // never matching a lowercase sub-verb noun.
  const fbsId = argv[0];
  if (!FBS_ID_PATTERN.test(fbsId)) {
    stderr.write(`[error] usage design: expected an FBS id like FBS-011 as the first positional, got '${fbsId}' (sub-verbs like ${[...KNOWN_SUB_VERBS].join(' | ')} follow the FBS id).\n`);
    return 2;
  }

  // Parse remainder. `parseArgs` handles the sub-verb + sub-sub-verb
  // positionals uniformly.
  let parsed;
  try {
    parsed = parseArgs({ args: argv.slice(1), options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }
  const subs = parsed.positionals;

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
  const fbs = tree.byId.get(fbsId);
  if (!fbs || tree.kindById.get(fbsId) !== 'fbs') {
    stderr.write(`[error] usage design: ${fbsId} not found or not an FBS\n`);
    return 2;
  }
  if (fbs.uiBearing !== true) {
    stderr.write(`[warn] design: ${fbsId} is not uiBearing (fbs.uiBearing is ${JSON.stringify(fbs.uiBearing)}); the Design substage is a no-op for non-UI FBS. Set uiBearing=true first (see 'rcf ui-classify ${fbsId}').\n`);
  }
  // Refuse Design substage writes when the baseline is missing (§6.2).
  if (fbs.uiBearing === true && !tree.manifest?.uiBaseline && subs.length > 0) {
    stderr.write(`[error] refused: ${fbsId} is uiBearing but no uiBaseline record exists on the manifest. Run: rcf ui-baseline init\n`);
    return 4;
  }

  const now = deps.now ? new Date(deps.now()) : new Date();

  if (flags['mark-complete']) {
    return await runMarkComplete({ tree, projectRoot, fbs, fbsId, stdout, stderr, flags, now });
  }
  if (subs.length === 0) return runShow({ tree, fbs, fbsId, stdout, flags });

  const first = subs[0];
  const second = subs[1];
  if (!KNOWN_SUB_VERBS.has(first)) {
    stderr.write(`[error] usage design: unknown sub-verb '${first}' (expected ${[...KNOWN_SUB_VERBS].join(' | ')}, or --mark-complete)\n`);
    return 2;
  }
  if (first === 'journeys' && second === 'add') {
    return await runJourneysAdd({ tree, projectRoot, fbsId, stdout, stderr, flags, now });
  }
  if (first === 'nav' && second === 'set') {
    return await runNavSet({ tree, projectRoot, fbsId, stdout, stderr, flags, now });
  }
  if (first === 'theme-a11y' && second === 'set') {
    return await runThemeA11ySet({ tree, projectRoot, fbsId, stdout, stderr, flags, now });
  }
  stderr.write(`[error] usage design: unknown sub-verb combination '${[first, second].filter(Boolean).join(' ')}'\n`);
  return 2;
}

function runShow({ tree, fbs, fbsId, stdout, flags }) {
  const stage = fbs.designStage ?? null;
  if (flags.json) {
    stdout.write(`${JSON.stringify(stage, null, 2)}\n`);
    return 0;
  }
  stdout.write(`design ${fbsId}: uiBearing=${JSON.stringify(fbs.uiBearing)} designStageComplete=${JSON.stringify(fbs.designStageComplete)}\n`);
  const missing = missingDesignStageArtefacts(fbs);
  if (!stage) {
    stdout.write('  designStage: (none)\n');
  } else {
    stdout.write(`  journeys: ${(stage.journeys ?? []).length}\n`);
    stdout.write(`  navModel: ${stage.navModel ? stage.navModel.shape + ' (' + (stage.navModel.routes ?? []).length + ' routes)' : '(none)'}\n`);
    stdout.write(`  themeAndA11y: ${stage.themeAndA11y ? stage.themeAndA11y.themeMode : '(none)'}\n`);
  }
  if (missing.length > 0) {
    stdout.write(`  next: author the missing artefact(s): ${missing.join(', ')}\n`);
  } else if (fbs.designStageComplete !== true) {
    stdout.write('  next: rcf design ' + fbsId + ' --mark-complete\n');
  }
  const baseline = tree.manifest?.uiBaseline;
  if (fbs.uiBearing === true && !baseline) {
    stdout.write('  refused (once you begin authoring): rcf ui-baseline init must run first.\n');
  }
  return 0;
}

async function runJourneysAdd({ tree, projectRoot, fbsId, stdout, stderr, flags, now }) {
  const journey = {
    id: flags.id,
    actor: flags.actor,
    goal: flags.goal,
    steps: Array.isArray(flags.step) ? flags.step : [],
  };
  const result = await writeJourneyAdd({ projectRoot, tree, fbsId, journey, now });
  return handleWriteResult({ result, stdout, stderr, quiet: Boolean(flags.quiet), verb: 'journeys add', ok: `journey '${journey.id}' added to ${fbsId}` });
}

async function runNavSet({ tree, projectRoot, fbsId, stdout, stderr, flags, now }) {
  const routes = parseRouteEntries(flags.route ?? []);
  if ('error' in routes) {
    stderr.write(`[error] usage design nav set: ${routes.error}\n`);
    return 2;
  }
  let signedInAsAffordance;
  if (typeof flags['signed-in-as-affordance'] === 'string') {
    if (flags['signed-in-as-affordance'] === 'true') signedInAsAffordance = true;
    else if (flags['signed-in-as-affordance'] === 'false') signedInAsAffordance = false;
    else {
      stderr.write(`[error] usage design nav set: --signed-in-as-affordance must be true or false, got '${flags['signed-in-as-affordance']}'\n`);
      return 2;
    }
  }
  const result = await writeNavSet({
    projectRoot, tree, fbsId,
    shape: flags.shape,
    routes: routes.routes,
    signedInAsAffordance,
    notes: flags.notes,
    now,
  });
  return handleWriteResult({ result, stdout, stderr, quiet: Boolean(flags.quiet), verb: 'nav set', ok: `navModel written on ${fbsId} (${routes.routes.length} route(s))` });
}

async function runThemeA11ySet({ tree, projectRoot, fbsId, stdout, stderr, flags, now }) {
  let cbp;
  if (typeof flags['contrast-before-palette'] === 'string') {
    if (flags['contrast-before-palette'] === 'true') cbp = true;
    else if (flags['contrast-before-palette'] === 'false') cbp = false;
    else {
      stderr.write(`[error] usage design theme-a11y set: --contrast-before-palette must be true or false, got '${flags['contrast-before-palette']}'\n`);
      return 2;
    }
  }
  const result = await writeThemeA11ySet({
    projectRoot, tree, fbsId,
    themeMode: flags.mode,
    themeTokensModule: flags.tokens,
    contrastTargets: flags['contrast-targets'],
    contrastTestPath: flags['contrast-test'],
    contrastTestAuthoredBeforePalette: cbp,
    now,
  });
  return handleWriteResult({ result, stdout, stderr, quiet: Boolean(flags.quiet), verb: 'theme-a11y set', ok: `themeAndA11y written on ${fbsId} (mode=${flags.mode})` });
}

async function runMarkComplete({ tree, projectRoot, fbs, fbsId, stdout, stderr, flags, now }) {
  if (flags['dry-run']) {
    const missing = missingDesignStageArtefacts(fbs);
    if (missing.length > 0) {
      stdout.write(`[dry-run] design --mark-complete: would refuse (${fbsId} designStage missing: ${missing.join(', ')})\n`);
      return 0;
    }
    stdout.write(`[dry-run] design --mark-complete: would set designStageComplete=true on ${fbsId}\n`);
    return 0;
  }
  const result = await writeMarkComplete({ projectRoot, tree, fbsId, now });
  if (result && 'kind' in result && 'message' in result) {
    if (result.kind === 'ioFailure') { writeUnexpectedFailure(result, stderr); return 1; }
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    if (result.kind === 'usage') return 4; // refused per §6.2
    if (result.kind === 'validation') return 3;
    return 1;
  }
  if (!flags.quiet) stdout.write(`design --mark-complete: ${fbsId} designStageComplete=true.\n`);
  return 0;
}

function handleWriteResult({ result, stdout, stderr, quiet, verb, ok }) {
  if (result && 'kind' in result && 'message' in result) {
    if (result.kind === 'ioFailure') { writeUnexpectedFailure(result, stderr); return 1; }
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    if (result.kind === 'usage') return 2;
    if (result.kind === 'validation' || result.kind === 'brokenReference') return 3;
    return 1;
  }
  if (!quiet) stdout.write(`design ${verb}: ${ok}.\n`);
  return 0;
}

function parseRouteEntries(entries) {
  const routes = [];
  for (const raw of entries) {
    // Shape: path=label:authRequired. `path` can contain `/`; `label`
    // MUST NOT contain `:`, and `authRequired` is the last colon-slice.
    const eq = raw.indexOf('=');
    if (eq < 0) return { error: `bad --route '${raw}'; expected path=label:authRequired` };
    const path = raw.slice(0, eq);
    const rhs = raw.slice(eq + 1);
    const lastColon = rhs.lastIndexOf(':');
    if (lastColon < 0) return { error: `bad --route '${raw}'; expected path=label:authRequired` };
    const label = rhs.slice(0, lastColon);
    const authString = rhs.slice(lastColon + 1);
    if (authString !== 'true' && authString !== 'false') {
      return { error: `bad --route '${raw}'; authRequired must be true or false` };
    }
    routes.push({ path, label, authRequired: authString === 'true' });
  }
  return { routes };
}
