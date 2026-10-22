// `rcf build finalise` subcommand handler. Administrative Finalise
// (FBS-220, US-19002, ADR-4148): verification is a Test-stage act, so
// Finalise promotes an FBS from `complete` to `verified` by ingesting the
// VerifyReport v1 the verifier hand committed under
// rcf/verify-reports/<fbs-id>/. Since FBS-230 (US-19005, ADR-4151) it runs
// on the PR branch before the merge, and the merge carries `verified`.
//
//   rcf build finalise <fbs-id> --ci-run <ref> [--report <path>] [--max-report-age <days>]
//
// Hard contract points:
//   - Finalise reads the report; it never spawns rcf verify run, the
//     verifier package or the agent CLI, and never writes under
//     rcf/verify-reports/. Its only child processes are git lookups;
//   - preconditions (CI evidence, complete status, Code Nodes), the
//     report's VerifyReport v1 shape, that it is committed at HEAD, and its
//     provenance (head contained in HEAD, a loopback target naming its
//     engine, port and served sha, hand separation, age) are checked before
//     any write; every refusal leaves the FBS byte-identical;
//   - the ship-authority rule (0.4.0) and the per-AC refusals (0.7.0,
//     0.20.0, 0.28.0) are kept, read from the ingested report;
//   - --mode and --url are retired: they belong to rcf verify run.

import { resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { isRcfError, writeUnexpectedFailure } from '#core/errors';
import { updateDocument, walkTree } from '#core/store';

import { findProjectRoot } from '../view/index.js';
import { kindOf } from '../query/index.js';
import { checkCodeNodeGate, hasNoCodeNodesDeclaration } from '../build/mark.js';
import {
  checkReportProvenance,
  composeShipWithoutVerifiedRecord,
  composeShipWithoutEvalRecord,
  findBrowserVerificationMissingAcs,
  findEvalRefusalAcs,
  findMockOnlyDeclaredAcs,
  findScopeMismatchAcs,
  findUiBaselineUnmetAcs,
  loadVerifyReport,
  writeShipWithoutEvalRecord,
  writeShipWithoutVerifiedRecord,
} from '../finalise/index.js';

// The finalise gate only makes sense on a built item; verified re-ingest is
// allowed and confirms the status without a write.
const FINALISABLE_STATUSES = new Set(['complete', 'verified']);
// ADR-4148: a report older than this many days is refused unless
// --max-report-age widens the window.
const DEFAULT_MAX_REPORT_AGE_DAYS = 7;

const OPTION_SPEC = {
  // CI evidence for the PR head the report names (required).
  'ci-run': { type: 'string' },
  // An explicit report path instead of rcf/verify-reports/<fbs-id>/.
  report: { type: 'string' },
  'max-report-age': { type: 'string' },
  // Retired (AC-19002-7): parsed only so the usage error can name the
  // Test-stage command that replaced them.
  url: { type: 'string' },
  mode: { type: 'string' },
  // 0.7.0 verification-integrity: acknowledge MOCK-ONLY-DECLARED /
  // BLOCKED-BY-DECLARATION per-AC verdicts on the ingested report and
  // ship the FBS 'complete' without promoting to 'verified'. Records
  // the operator's ack on the manifest.
  'ship-without-verified': { type: 'boolean' },
  // rcf-eval-node spec 2026-09-04 sections 5.2 + 8: acknowledge
  // EVAL-MISSING / EVAL-BELOW-THRESHOLD with a mandatory reason string
  // (missing reason exits 2); the ack lands on the manifest and the
  // promotion proceeds.
  'ship-without-eval': { type: 'string' },
  // FBS-230 (AC-19005-9): accepted as a no-op that prints one
  // deprecation line; Finalise runs on any branch.
  'allow-pre-merge': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf build finalise <fbs-id> --ci-run <ref> [--report <path>] [--max-report-age <days>]

Administrative Finalise, run on the PR branch before the merge. Promotes an
FBS at status complete to verified by ingesting the Test-stage verify report
the verifier hand committed on the PR branch (rcf verify run --fbs <fbs-id>
--hand verifier writes it to rcf/verify-reports/<fbs-id>/<head12>.json).
The verified status is written on the branch and the merge carries it; on
the default branch after a merge commit a re-run is a read-only confirm
(a squash merge is not promised). Finalise reads the report and spawns
nothing but git lookups; it never runs verify itself.

Promotion needs every one of:
  - --ci-run <ref> naming the CI run that passed on the PR head the report
    names (recorded on the verified line, never fetched);
  - the FBS at complete and a Code Node on every bound acceptance
    criterion;
  - a valid VerifyReport v1 committed at HEAD with its bytes on disk
    unchanged, whose head is contained in HEAD (an ancestor, or tree-equal
    to a commit HEAD contains outside rcf/verify-reports/), whose hand is
    verifier with a verifierId no builder commit carries as its Hand-Id,
    and which finished within --max-report-age days;
  - a loopback target (localhost, *.localhost, 127.0.0.0/8, ::1, 0.0.0.0)
    is accepted only when the report names target.engine (for example
    "wrangler dev"), target.port and the served sha (target.servedSha)
    equal to its head; rcf verify run --engine <name> --served-sha <sha>
    records them;
  - verdict PASS with ship authority and no blocking per-AC verdict
    (MOCK-ONLY-DECLARED, EVAL-MISSING, EVAL-BELOW-THRESHOLD,
    UI-BASELINE-UNMET, BROWSER-VERIFICATION-MISSING, SCOPE-MISMATCH).

Required:
  <fbs-id>                  The FBS item to finalise (must be 'complete')
  --ci-run <ref>            The CI run that passed on the PR head the
                            report names

Options:
  --report <path>           Ingest this report instead of the newest one
                            under rcf/verify-reports/<fbs-id>/
  --max-report-age <days>   Refuse a report that finished longer ago than
                            this (default: ${DEFAULT_MAX_REPORT_AGE_DAYS})
  --ship-without-verified   Acknowledge MOCK-ONLY-DECLARED /
                            BLOCKED-BY-DECLARATION per-AC verdicts and
                            ship the FBS 'complete' without promoting to
                            'verified'; the ack lands on the manifest.
  --ship-without-eval "..."  Acknowledge EVAL-MISSING /
                            EVAL-BELOW-THRESHOLD per-AC verdicts with a
                            mandatory reason; the ack lands on the
                            manifest under shipWithoutEval[] and the
                            promotion proceeds. A missing reason exits 2.
  --allow-pre-merge         Deprecated and changes nothing: Finalise runs
                            on any branch. Prints one deprecation line.
  --quiet                   Suppress non-error confirmations
  --help                    Print this help

Retired:
  --mode, --url             Verification is a Test-stage act: run
                            rcf verify run --fbs <fbs-id> --hand verifier
                            before the merge. Either flag exits 2.

Exit codes:
  0  promoted to verified, confirmed already verified with no write, or an
     acknowledged ship-without-verified
  1  IO / unexpected runtime failure
  2  usage error (bad flags, retired flag, unknown / non-FBS id)
  3  schema validation or broken references (tree unreadable, missing Code
     Nodes, a report that is not a valid VerifyReport v1, write refused)
  4  refused - CI evidence missing, not complete, no report, report not
     committed at HEAD or differing from its committed bytes, a report
     read through a symlink below the repo root, report head
     not contained in HEAD, a loopback target naming no target.engine,
     target.port or target.servedSha, or a served sha that is not the
     report head, hand not separate from the builder, report too old,
     verdict not PASS or not ship authority, or a blocking per-AC verdict;
     the FBS is left unchanged
`;

/**
 * @param {string[]} argv - argv slice after `finalise`
 * @param {object} [deps] - injectable seams (stdout / stderr / cwd / git / now)
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
  // FBS-230 (ADR-4151): Finalise runs on the PR branch before the merge, so
  // no branch is refused; --allow-pre-merge changes nothing.
  if (flags['allow-pre-merge']) {
    stderr.write('[warn] finalise: --allow-pre-merge is deprecated and changes nothing; Finalise runs on the PR branch before the merge\n');
  }


  const usage = (message) => {
    stderr.write(`[error] usage finalise: ${message}\n`);
    return 2;
  };

  if (positionals.length === 0) return usage('an <fbs-id> positional is required');
  if (positionals.length > 1) return usage('multiple positional ids are not supported');
  const fbsId = positionals[0];
  if (fbsId.includes('*') || fbsId.includes('?')) {
    return usage('wildcard / glob positional not supported');
  }

  // AC-19002-7: --mode and --url belong to rcf verify run at the Test stage.
  if (flags.mode !== undefined || flags.url !== undefined) {
    return usage(`finalise no longer runs verify; run rcf verify run --fbs ${fbsId} --hand verifier at the Test stage`);
  }
  // A --ship-without-eval that looks like a flag is a swallowed next option.
  const swe = flags['ship-without-eval'];
  if (swe !== undefined && (swe.startsWith('-') || swe.trim().length === 0)) {
    return usage('--ship-without-eval requires a reason string');
  }
  let maxReportAgeDays = DEFAULT_MAX_REPORT_AGE_DAYS;
  if (flags['max-report-age'] !== undefined) {
    maxReportAgeDays = Number(flags['max-report-age']);
    if (!Number.isFinite(maxReportAgeDays) || maxReportAgeDays <= 0) {
      return usage(`--max-report-age takes a positive number of days (got "${flags['max-report-age']}")`);
    }
  }
  const ciRun = flags['ci-run'];
  if (typeof ciRun !== 'string' || ciRun.trim().length === 0 || ciRun.startsWith('-')) {
    stderr.write('[error] refused finalise: ci evidence missing: pass --ci-run <ref>\n');
    return 4;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  // Walker errors block finalise entirely - no gate runs against a tree that
  // fails validation, and no status write lands (mirrors build --mark, §D6).
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    const emptyBinding = errors.find((e) => e?.documentId === fbsId && /acIds/.test(e?.message ?? ''));
    if (emptyBinding) {
      stderr.write(`[error] refused finalise: ${fbsId} has no bound acceptance criteria; there is nothing to verify. `
        + 'Bind at least one AC to the FBS (acIds) before finalising it.\n');
      return 3;
    }
    stderr.write('[error] validation the RCF tree does not validate; fix it before finalising.\n');
    return 3;
  }

  // The positional must be an FBS at a finalisable status.
  const kind = kindOf(tree, fbsId);
  if (kind !== 'fbs') {
    if (!kind) return usage(`id ${fbsId} not found`);
    return usage(`${fbsId} is a ${kind} id; finalise addresses FBS items only`);
  }
  const fbs = tree.byId.get(fbsId);
  const currentStatus = fbs.executionStatus;
  if (!FINALISABLE_STATUSES.has(currentStatus)) {
    stderr.write(`[error] refused finalise: ${fbsId} is '${currentStatus}'; the finalise gate promotes 'complete' -> 'verified'. `
      + `Mark it complete first: rcf build mark ${fbsId} complete\n`);
    return 4;
  }
  if (!hasNoCodeNodesDeclaration(fbs)) {
    const cnGate = checkCodeNodeGate(tree, fbs);
    if (!cnGate.ok) {
      stderr.write(`[error] refused finalise: missing Code Nodes: ${cnGate.missingAcIds.join(', ')}; ${fbsId} left '${currentStatus}'.\n`);
      return 3;
    }
  }

  const quiet = Boolean(flags.quiet);

  // --- ingest the Test-stage report (ADR-4148) ----------------------------
  const loaded = await loadVerifyReport({
    projectRoot,
    fbsId,
    reportPath: flags.report === undefined ? undefined : resolvePath(cwd, flags.report),
  }, deps);
  if (!loaded.ok) {
    stderr.write(`[error] ${loaded.message}\n`);
    return loaded.code;
  }
  const { report, path: reportPath } = loaded;
  const provenance = await checkReportProvenance(
    { report, cwd: projectRoot, maxReportAgeDays, now: deps.now ?? Date.now() },
    deps,
  );
  if (!provenance.ok) {
    stderr.write(`[error] ${provenance.message}; ${fbsId} left '${currentStatus}'.\n`);
    return provenance.code;
  }

  // Ship-authority rule (0.4.0): only a PASS carrying ship authority promotes.
  if (report.verdict !== 'PASS') {
    stderr.write(`[finalise] gate NOT promoted: the verify report's verdict is ${report.verdict}, not PASS; ${fbsId} left '${currentStatus}'. Report: ${reportPath}\n`);
    return 4;
  }
  if (report.verdictAuthority !== 'ship') {
    stderr.write(`[finalise] HOLD: the verify report passed but carries '${report.verdictAuthority}' authority, not 'ship'; ${fbsId} left '${currentStatus}'. Report: ${reportPath}\n`);
    return 4;
  }

  // Per-AC refusals (0.7.0, 0.20.0, 0.28.0), read from the report's perAc rows.
  const verdicts = {
    perAcVerdicts: report.perAc
      .filter((row) => typeof row.verdict === 'string')
      .map((row) => ({ acId: row.acId, verdict: row.verdict })),
  };
  const acList = (rows) => rows.map((a) => a.acId).filter(Boolean).join(', ');
  const writeAck = async (write, record) => {
    const result = await write({ projectRoot, tree, record });
    if (!isRcfError(result)) return 0;
    if (result.kind === 'ioFailure') { writeUnexpectedFailure(result, stderr); return 1; }
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    return (result.kind === 'validation' || result.kind === 'brokenReference') ? 3 : 1;
  };

  const declared = findMockOnlyDeclaredAcs(verdicts);
  if (declared.length > 0) {
    if (!flags['ship-without-verified']) {
      stderr.write(`[finalise] gate NOT promoted: ${declared.length} AC(s) came back MOCK-ONLY-DECLARED / BLOCKED-BY-DECLARATION on the report (${acList(declared)}); ${fbsId} left '${currentStatus}'.\n`);
      stderr.write('Only a run where every service-bound AC verifies with a live-attested profile promotes to verified. To ship the FBS at complete anyway, re-run with --ship-without-verified (the ack lands on the record).\n');
      stderr.write(`Report: ${reportPath}\n`);
      return 4;
    }
    const ackRecord = composeShipWithoutVerifiedRecord({ manifest: tree.manifest, fbsId, declaredAcs: declared, reportPath });
    const ackCode = await writeAck(writeShipWithoutVerifiedRecord, ackRecord);
    if (ackCode !== 0) return ackCode;
    if (!quiet) {
      stdout.write(`[finalise] ${declared.length} AC(s) came back with declared mock-only verdicts; --ship-without-verified acknowledged (${ackRecord.id} on rcf/manifest.json); ${fbsId} left '${currentStatus}'. Report: ${reportPath}\n`);
    }
    return 0;
  }

  const evalDeclared = findEvalRefusalAcs(verdicts);
  let evalAck = null;
  if (evalDeclared.length > 0) {
    if (swe === undefined) {
      const missingAcIds = evalDeclared.filter((e) => e.verdict === 'EVAL-MISSING').map((e) => e.acId);
      const belowAcIds = evalDeclared.filter((e) => e.verdict === 'EVAL-BELOW-THRESHOLD').map((e) => e.acId);
      if (missingAcIds.length > 0) {
        stderr.write(`finalise refused: EVAL missing on AC(s) ${missingAcIds.join(', ')}; author an EVAL or --ship-without-eval "reason"\n`);
      }
      if (belowAcIds.length > 0) {
        stderr.write(`finalise refused: EVAL below threshold on AC(s) ${belowAcIds.join(', ')}; investigate the run record or --ship-without-eval "reason"\n`);
      }
      stderr.write(`${fbsId} left '${currentStatus}'. Report: ${reportPath}\n`);
      return 4;
    }
    evalAck = composeShipWithoutEvalRecord({ manifest: tree.manifest, fbsId, reason: swe, declaredAcs: evalDeclared, reportPath });
  }

  // Referee-guarantee train (REQ-165 / US-16501, docs claims C-28, C-29,
  // C-30, C-36): no ack path for these three.
  const uiUnmet = findUiBaselineUnmetAcs(verdicts);
  if (uiUnmet.length > 0) {
    stderr.write(`[finalise] gate NOT promoted: ${uiUnmet.length} AC(s) came back UI-BASELINE-UNMET on the report (${acList(uiUnmet)}); ${fbsId} left '${currentStatus}'.\n`);
    stderr.write('The deployed UI failed at least one bound baseline invariant; a block-severity probe-pack failure aggregates into the same verdict. Fix the UI or the baseline, re-verify at the Test stage, then re-run finalise. Referee-guarantees claims C-28 and C-36.\n');
    stderr.write(`Report: ${reportPath}\n`);
    return 4;
  }
  const bvMissing = findBrowserVerificationMissingAcs(verdicts);
  if (bvMissing.length > 0) {
    stderr.write(`[finalise] gate NOT promoted: ${bvMissing.length} AC(s) came back BROWSER-VERIFICATION-MISSING on the report (${acList(bvMissing)}); ${fbsId} left '${currentStatus}'.\n`);
    stderr.write('A UI-bearing FBS has no browserVerification record on the manifest. Run rcf verify browser <fbs-id> to lay the record down, re-verify at the Test stage, then re-run finalise. Referee-guarantees claim C-29.\n');
    stderr.write(`Report: ${reportPath}\n`);
    return 4;
  }
  const scopeMismatch = findScopeMismatchAcs(verdicts);
  if (scopeMismatch.length > 0) {
    stderr.write(`[finalise] gate NOT promoted: ${scopeMismatch.length} AC(s) came back SCOPE-MISMATCH on the report (${acList(scopeMismatch)}); ${fbsId} left '${currentStatus}'.\n`);
    stderr.write('A bound TC is narrower than the AC scope (NV-BL-GATE-01). Widen the TC or narrow the AC scope in define, re-verify at the Test stage, then re-run finalise. Referee-guarantees claim C-30.\n');
    stderr.write(`Report: ${reportPath}\n`);
    return 4;
  }

  if (evalAck) {
    const ackCode = await writeAck(writeShipWithoutEvalRecord, evalAck);
    if (ackCode !== 0) return ackCode;
    if (!quiet) {
      stdout.write(`[finalise] ${evalDeclared.length} AC(s) came back with EVAL refusals; --ship-without-eval acknowledged (${evalAck.id} on rcf/manifest.json, reason: ${swe}).\n`);
    }
  }

  const verifiedLine = `finalise: ${fbsId} verified from ${reportPath} (head ${report.headSha.slice(0, 7)}, ci ${ciRun})\n`;
  if (currentStatus === 'verified') {
    if (!quiet) stdout.write(verifiedLine);
    return 0;
  }
  const result = await updateDocument({
    projectRoot, tree, id: fbsId, sets: [{ path: 'executionStatus', value: 'verified' }],
    // Referee-guarantee train (REQ-165 / US-16502, docs claim C-22): the
    // writer refuses executionStatus=verified on FBS by default; Finalise is
    // the one path that writes it.
    options: { allowVerifiedOverride: true },
  });
  if (isRcfError(result)) {
    if (result.kind === 'ioFailure') { writeUnexpectedFailure(result, stderr); return 1; }
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    if (result.kind === 'usage') return 2;
    if (result.kind === 'validation' || result.kind === 'brokenReference') return 3;
    return 1;
  }
  if (!quiet) stdout.write(verifiedLine);
  return 0;
}
