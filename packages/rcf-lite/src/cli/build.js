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

import { formatErrors, isRcfError, rcfError, writeUnexpectedFailure } from '#core/errors';
import { updateDocument, walkTree } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import { kindOf } from '../query/index.js';
import { scanUnbackedServices } from '../query/attestation.js';
import {
  assembleBundle,
  checkCodeNodeGate,
  checkContrastBeforePaletteGate,
  checkDesignGate,
  computeQueue,
  formatJson,
  formatMarkdown,
  hasNoCodeNodesDeclaration,
  planMark,
  selectNext,
} from '../build/index.js';
import { classifyFbs } from '../ui-detection/classifier.js';
import { firstBaselineDisagreement } from '../design/index.js';
import { writeBrowserVerificationAck } from '../browser-verify/index.js';
// Track C+D §5.4 Stage-1 refusal gate.
import { fbsRefusalForOpenSweep } from '../req-baseline/gate.js';

const OPTION_SPEC = {
  next: { type: 'boolean' },
  mark: { type: 'string' },
  format: { type: 'string' },
  out: { type: 'string' },
  strict: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
  // Phase 10 (X2 CodeNode bridge, D17): declare a build spec as genuinely
  // producing no traceable code (docs-only, config-only), exempting it
  // from the mark-complete CN gate. Combines only with `--mark complete`.
  'no-code-nodes': { type: 'boolean' },
  // Track B (ui-design-gate-0.7.0-spec §8.6): ship-without-verified
  // escape hatch on --mark complete for a browserVerification record
  // whose verdict is `block`. Records the operator's reason on the
  // browserVerification record.
  'accept-block': { type: 'boolean' },
  reason: { type: 'string' },
};

export const HELP = `Usage: rcf build [fbs-id] [options]

Assemble FBS spec bundles and drive the build queue (the SDD adapter).
Four modes:

  rcf build                          Queue overview (the FBS queue as a table,
                                     with parallel-safe tier groups)
  rcf build <fbs-id>                 Spec bundle for one FBS item
  rcf build --next                   Bundle for the next actionable item
  rcf build <fbs-id> --mark <status> Record a lifecycle transition

The positional is an FBS id only. For 'which FBS items implement this
story', use: rcf trace <us-id> --forward --format json

Lifecycle (forward-only): notStarted -> inProgress -> complete -> verified.
The --mark ladder caps at 'complete': --mark verified is refused (exit 4)
because 'verified' is written only by the finalise gate (rcf finalise) after
an independent verify run. Backward transitions are also refused (exit 4);
the deliberate-correction / manual-override escape hatch is:
rcf update <fbs-id> --set executionStatus=<status>

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
  --no-code-nodes           With --mark complete: declare this FBS as
                            genuinely producing no traceable code
                            (docs-only, config-only), recorded on the FBS
                            and exempting it from the mark-complete CN gate
  --accept-block            With --mark complete on a uiBearing FBS: accept
                            a browserVerification block (or a missing record)
                            and ship the FBS at complete. Requires --reason
                            "..." (>= 20 chars). Records the reason on the
                            browserVerification.operatorShipDespiteBlockReason
                            field. Track B ship-without-verified (spec §8.6).
  --reason "..."            Reason string for --accept-block.
  --quiet                   Suppress non-error confirmations
  --help                    Print this help

Mark-complete CN gate (D17): marking an FBS complete refuses (exit 3,
missingCodeNodes) when any of its ACs carries no Code Node. Author CN
coverage first, or pass --no-code-nodes for a genuinely no-code spec.
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
  // Phase 10 (X2 CodeNode bridge, D17): --no-code-nodes only makes sense
  // declaring a spec complete with no traceable code.
  if (flags['no-code-nodes'] && flags.mark !== 'complete') {
    return usage('--no-code-nodes only combines with --mark complete');
  }
  // Track B (§8.6): --accept-block only makes sense with --mark complete
  // and requires --reason "...".
  if (flags['accept-block'] && flags.mark !== 'complete') {
    return usage('--accept-block only combines with --mark complete');
  }
  if (flags['accept-block'] && (typeof flags.reason !== 'string' || flags.reason.length < 20)) {
    return usage('--accept-block requires --reason "..." with at least 20 characters');
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
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
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
    return await runMark({
      tree, projectRoot, fbsId: positional, status: flags.mark, io,
      noCodeNodes: Boolean(flags['no-code-nodes']),
      acceptBlock: Boolean(flags['accept-block']),
      acceptReason: typeof flags.reason === 'string' ? flags.reason : null,
    });
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
  // Track C+D §5.4: single-FBS bundle emission also refuses when the
  // bound US has open baseline sweep candidates. Same shape as --next
  // so a caller can rely on one refusal semantics regardless of entry.
  const openSweep = fbsRefusalForOpenSweep(tree, fbsId);
  if (openSweep) {
    io.stderr.write(`[error] ${openSweep.message}\n`);
    return 4;
  }
  // Track B (spec §4.4): classifier signal alongside the single-FBS
  // bundle. Same transparency rule as --next.
  emitClassifierSignal(io, tree, fbsId);
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
    // Track C+D §5.4: Stage-1 (Define) refuses to enter Build for any
    // FBS binding an AC on a US that still has open baseline sweep
    // candidates. Fires before any classifier signal so the operator
    // sees the refusal ahead of noise.
    const openSweep = fbsRefusalForOpenSweep(tree, next.fbsId);
    if (openSweep) {
      io.stderr.write(`[error] ${openSweep.message}\n`);
      return 4;
    }
    // Spec section 4.2 / review N-1: warn when the selected FBS names
    // dependsOnServices that no preFlightConfig record covers, so the
    // operator sees the same signal the elicitation and build-cycle
    // playbooks already advertise for `rcf build --next`. Warn-only
    // (not exit-4) matches the spec's Stage 1 warn-only ruling; the
    // hard refuse lives at Stage 4 via `coverage --strict`.
    const unbacked = scanUnbackedServices(tree, next.fbsId);
    if (unbacked.length > 0) {
      const names = unbacked.map((u) => u.serviceId).join(', ');
      io.stderr.write(`[warn] build --next: ${next.fbsId} touches services not covered by any preFlightConfig (${names}); run 'rcf preflight' before Stage 4.\n`);
    }
    // Track B (spec §4.4): always print the classifier verdict + signals
    // for the selected FBS. Transparent-by-default so a `notUi` verdict
    // on prose that visibly contains UI keywords is still visible to the
    // operator; missing the transparency would re-enable the silent
    // shortcut pattern the cold-run "Skip RCF" wobble called out.
    emitClassifierSignal(io, tree, next.fbsId);
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
async function runMark({ tree, projectRoot, fbsId, status, io, noCodeNodes = false, acceptBlock = false, acceptReason = null }) {
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

  const sets = [{ path: 'executionStatus', value: plan.to }];

  // Track B (§5.2): soft warning on --mark inProgress for uiBearing
  // FBS that has no designStage authored yet. Warn-only per spec.
  if (plan.to === 'inProgress') {
    const fbs = tree.byId.get(plan.fbsId);
    if (fbs?.uiBearing === true && !fbs?.designStage) {
      io.stderr.write(`[warn] build --mark inProgress: ${plan.fbsId} is uiBearing but has no designStage yet. Consider running 'rcf design ${plan.fbsId}' before Stage 2 build begins. Not a refusal; the hard gate fires at --mark complete.\n`);
    }
  }

  // Phase 10 (X2 CodeNode bridge, D17, operator ruling): the mark-complete
  // CN gate. Refuses (exit 3, structured missingCodeNodes) when any AC of
  // the completed spec carries no Code Node, unless the FBS already
  // carries the no-code-nodes declaration or this invocation supplies it.
  if (plan.to === 'complete') {
    const fbs = tree.byId.get(plan.fbsId);

    // Track B (§5.5): the Design gate. Refuses --mark complete when
    // the FBS is uiBearing=true and designStageComplete is not true.
    // Fires before the CN gate so operators do not have to fix CN
    // coverage on an FBS that also needs a design pass.
    const designGate = checkDesignGate(fbs);
    if (!designGate.ok) {
      io.stderr.write(`[error] refused build: ${plan.fbsId} is uiBearing but designStageComplete is not true on the FBS record.\n`
        + '  Complete the Design substage first:\n'
        + `    rcf design ${plan.fbsId}              (dispatches the Design worker)\n`
        + `    rcf design ${plan.fbsId} --mark-complete   (hand-authored equivalent, once all three artefacts are present)\n`);
      return 4;
    }

    // Track B (§7 mandate 10, §6.2): contrast-before-palette gate.
    // The boolean is the primary attestation (§12 O-5); git history
    // corroboration is deferred to a future spec release (§7 mandate
    // 10 permits this when history is inconclusive, and a fresh clone
    // is the default posture for the sub-process runner). The pure
    // gate refuses on the boolean alone.
    const cbpGate = checkContrastBeforePaletteGate(fbs);
    if (!cbpGate.ok) {
      io.stderr.write(`[error] refused ${cbpGate.message}\n`);
      return 4;
    }

    // Track B (§6.2): belt-and-braces baseline-vs-designStage
    // disagreement refusal, in case the design --mark-complete path
    // was bypassed (e.g. rcf update wrote the disagreement after
    // design --mark-complete succeeded).
    if (fbs?.uiBearing === true) {
      const disagreement = firstBaselineDisagreement(tree, fbs);
      if (disagreement) {
        io.stderr.write(`[error] refused build: ${plan.fbsId} designStage.${disagreement.designStagePath} = ${JSON.stringify(disagreement.designValue)} conflicts with uiBaseline.defaults.${disagreement.path} = ${JSON.stringify(disagreement.baselineValue)} and there is no operatorOptOuts entry.\n`
          + '  Options:\n'
          + `    1) Change designStage.${disagreement.designStagePath} to match the baseline.\n`
          + `    2) rcf ui-baseline opt-out --field ${disagreement.path} --reason "..." (project-wide override).\n`
          + `    3) rcf update ${plan.fbsId} --set designStage.${disagreement.designStagePath}=... (per-FBS override; records ack).\n`);
        return 4;
      }
    }

    // Track B (§8.5, §8.6): browser-verification verdict gate.
    // Reads the latest browserVerification record for the FBS and
    // gates by verdict:
    //   pass -> permitted
    //   warn -> permitted only when operatorAckAt is populated
    //   block -> refused unless --accept-block --reason "..."
    // Absent record -> refused (finalise still refuses via the verify
    //   `BROWSER-VERIFICATION-MISSING` verdict class, which lives in
    //   the verify car; the build-side refusal here catches the same
    //   defect earlier so the operator does not push the FBS to
    //   complete without any evidence).
    if (fbs?.uiBearing === true) {
      const bvRecord = latestBrowserVerification(tree.manifest, plan.fbsId);
      if (!bvRecord) {
        // Track B review B-1 (2026-07-31): refuse cleanly when no
        // browserVerification record exists, even with --accept-block.
        // Previously acceptBlock let execution fall through past the
        // ack-writer (which is guarded on bvRecord being truthy),
        // marking the FBS complete with only an ephemeral stderr line
        // as evidence of the operator's reason. That is the exact
        // "durable record or it did not happen" defect Track A's B-1
        // closed for --ship-without-verified. Composing a synthetic
        // browserVerification record here would invent evidence for a
        // gate the operator never actually ran; the honest posture is
        // to make the operator run the gate (the stub driver produces
        // a warn record, which then legitimately anchors the ack) or
        // ratify a real record. Two-command dance: acknowledged and
        // preferred.
        io.stderr.write(`[error] refused build: ${plan.fbsId} is uiBearing but no browserVerification record exists on the manifest.\n`
          + `  Run: rcf browser-verify ${plan.fbsId}\n`
          + `  Then, if the resulting record is block or warn and you have decided to ship anyway, rerun with --accept-block --reason "..." on that record.\n`
          + '  (--accept-block requires an existing browserVerification record; it acknowledges a real verdict rather than skipping the gate.)\n');
        return 4;
      } else if (bvRecord.verdict === 'block' && !acceptBlock) {
        io.stderr.write(`[error] refused build: ${plan.fbsId} browserVerification ${bvRecord.id} verdict is 'block'.\n`
          + '  Re-run browser-verify after fixing the failures, or acknowledge with:\n'
          + `    rcf build ${plan.fbsId} --mark complete --accept-block --reason "..."\n`);
        return 4;
      } else if (bvRecord.verdict === 'warn' && !bvRecord.operatorAckAt) {
        io.stderr.write(`[error] refused build: ${plan.fbsId} browserVerification ${bvRecord.id} verdict is 'warn' but operatorAckAt is not set.\n`
          + '  Ack the warn verdict with:\n'
          + `    rcf browser-verify ${plan.fbsId} --ack\n`);
        return 4;
      }
      // Ship-without-verified: record the operator's reason on the bv
      // record when they used --accept-block. Only fires on `block`
      // because the earlier `warn` guard already returned 4 when the
      // record was warn-without-ack; the sanctioned warn clear is
      // `rcf browser-verify <id> --ack`, not `--accept-block`.
      if (acceptBlock && bvRecord && bvRecord.verdict === 'block') {
        const ackResult = await writeBrowserVerificationAck({
          projectRoot, tree, fbsId: plan.fbsId,
          operatorAckAt: true,
          operatorShipDespiteBlockReason: acceptReason,
        });
        if (ackResult && 'kind' in ackResult && 'message' in ackResult) {
          if (ackResult.kind === 'ioFailure') { writeUnexpectedFailure(ackResult, io.stderr); return 1; }
          io.stderr.write(`[error] ${ackResult.kind} ${ackResult.message}\n`);
          return 3;
        }
      }
    }

    const alreadyDeclared = hasNoCodeNodesDeclaration(fbs);
    if (noCodeNodes && !alreadyDeclared) {
      sets.push({ path: 'noCodeNodes', value: true });
    } else if (!alreadyDeclared) {
      const gate = checkCodeNodeGate(tree, fbs);
      if (!gate.ok) {
        const err = rcfError({
          kind: 'missingCodeNodes',
          message: `build --mark complete: refused - ${plan.fbsId} has AC(s) with no Code Node: ${gate.missingAcIds.join(', ')}. `
            + 'Author CN coverage for these ACs, or pass --no-code-nodes for a genuinely no-code (docs-only, config-only) spec.',
          documentId: plan.fbsId,
          field: 'acIds',
          rule: 'missingCodeNodes',
        });
        io.stderr.write(`[error] ${err.kind} ${err.message}\n`);
        return 3;
      }
    }
  }

  const result = await updateDocument({
    projectRoot,
    tree,
    id: plan.fbsId,
    sets,
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

/**
 * Print the UI-bearing classifier verdict for an FBS on the bundle
 * runbook (Track B, ui-design-gate-0.7.0-spec §4.4). Emits nothing when
 * the FBS document is missing (defensive; the caller has already
 * classified). Not enough to gate on its own; the operator ratifies
 * via `rcf update <fbs-id> --set uiBearing=true|false`.
 *
 * @param {object} io
 * @param {object} tree
 * @param {string} fbsId
 */
function emitClassifierSignal(io, tree, fbsId) {
  const fbs = tree.byId.get(fbsId);
  if (!fbs) return;
  const block = classifyFbs(tree, fbsId);
  if (!block) return;
  const signalCount = Array.isArray(block.signals) ? block.signals.length : 0;
  const suffix = fbs.uiBearing === true ? ' [ratified: uiBearing=true]'
    : fbs.uiBearing === false ? ' [ratified: uiBearing=false]'
      : ' [not yet ratified]';
  io.stderr.write(`[info] build: ui-classifier verdict=${block.verdict} reason=${block.reason} (${signalCount} signal(s))${suffix}\n`);
  if (block.verdict === 'ui' && fbs.uiBearing !== true) {
    io.stderr.write(`       Classified as UI-bearing. Ratify with: rcf update ${fbsId} --set uiBearing=true\n`);
    io.stderr.write(`       Override with: rcf update ${fbsId} --set uiBearing=false (if the classifier is wrong).\n`);
  }
}

/**
 * Latest browserVerification record for an FBS. Returns null when
 * none exists.
 *
 * @param {object|null} manifest
 * @param {string} fbsId
 * @returns {object|null}
 */
function latestBrowserVerification(manifest, fbsId) {
  const records = Array.isArray(manifest?.browserVerification) ? manifest.browserVerification : [];
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (records[i]?.fbsId === fbsId) return records[i];
  }
  return null;
}
