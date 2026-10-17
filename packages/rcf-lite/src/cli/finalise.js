// `rcf build finalise` subcommand handler. Administrative Finalise
// (FBS-220, US-19002, ADR-4148): verification is a Test-stage act, so
// Finalise promotes an FBS from `complete` to `verified` by ingesting the
// VerifyReport v1 the verifier hand committed under
// rcf/verify-reports/<fbs-id>/ before the merge.
//
//   rcf build finalise <fbs-id> --ci-run <ref> [--report <path>] [--max-report-age <days>]
//
// Hard contract points:
//   - Finalise reads the report; it never spawns rcf verify run, the
//     verifier package or the agent CLI, and never writes under
//     rcf/verify-reports/. Its only child processes are git lookups;
//   - preconditions (CI evidence, complete status, Code Nodes, default
//     branch), the report's VerifyReport v1 shape and its provenance (head
//     contained in HEAD, non-loopback target, hand separation, age) are
//     checked before any write; every refusal leaves the FBS byte-identical;
//   - the ship-authority rule (0.4.0) and the per-AC refusals (0.7.0,
//     0.20.0, 0.28.0) are kept, read from the ingested report;
//   - --mode and --url are retired: they belong to rcf verify run.

import { spawn } from 'node:child_process';
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

// Referee-guarantee train (REQ-165 / US-16502, docs claim C-26): the
// merge-state precondition. Finalise refuses to promote to verified
// when the git working tree is not on one of these default branches.
// Kept small and conventional (git init and every hosted git provider
// default to `main` or `master`); projects on a non-default trunk
// (rare in modern repos) either rename the trunk to a listed name or
// pass --allow-pre-merge on every finalise run. The alternative --
// reading the git remote's default-branch symbolic ref -- adds a
// network round-trip on every finalise and fails offline; the small
// name list is deliberately the safer default.
const DEFAULT_BRANCH_NAMES = new Set(['main', 'master']);

// The finalise gate only makes sense on a built item; verified re-ingest is
// allowed and confirms the status without a write.
const FINALISABLE_STATUSES = new Set(['complete', 'verified']);
// ADR-4148: a report older than this many days is refused unless
// --max-report-age widens the window.
const DEFAULT_MAX_REPORT_AGE_DAYS = 7;

const OPTION_SPEC = {
  // CI evidence for the merged head (required).
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
  // Referee-guarantee train (REQ-165 / US-16502, docs claim C-26):
  // finalise refuses promotion when the git working tree is not on
  // the default branch (main / master); --allow-pre-merge is the
  // deliberate opt-out, logged on stdout.
  'allow-pre-merge': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf build finalise <fbs-id> --ci-run <ref> [--report <path>] [--max-report-age <days>]

Administrative Finalise. Promotes an FBS at status complete to verified by
ingesting the Test-stage verify report the verifier hand committed before
the merge (rcf verify run --fbs <fbs-id> --hand verifier writes it to
rcf/verify-reports/<fbs-id>/<head12>.json). Finalise reads the report and
spawns nothing but git lookups; it never runs verify itself.

Promotion needs every one of:
  - --ci-run <ref> naming the CI run that passed on the merged head;
  - the FBS at complete, HEAD on the default branch (main / master) and a
    Code Node on every bound acceptance criterion;
  - a valid VerifyReport v1 whose head is contained in HEAD (an ancestor,
    or tree-equal to a commit HEAD contains outside rcf/verify-reports/),
    whose target is not loopback, whose hand is verifier with a verifierId
    no builder commit carries as its Hand-Id, and which finished within
    --max-report-age days;
  - verdict PASS with ship authority and no blocking per-AC verdict
    (MOCK-ONLY-DECLARED, EVAL-MISSING, EVAL-BELOW-THRESHOLD,
    UI-BASELINE-UNMET, BROWSER-VERIFICATION-MISSING, SCOPE-MISMATCH).

Required:
  <fbs-id>                  The FBS item to finalise (must be 'complete')
  --ci-run <ref>            The CI run that passed on the merged head

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
  --allow-pre-merge         Promote off the default branch, for a
                            deliberate pre-merge dry run; the decision is
                            logged on stdout (Referee-guarantees claim C-26).
  --quiet                   Suppress non-error confirmations
  --help                    Print this help

Retired:
  --mode, --url             Verification is a Test-stage act: run
                            rcf verify run --fbs <fbs-id> --hand verifier
                            before the merge. Either flag exits 2.

Exit codes:
  0  promoted to verified (or an acknowledged ship-without-verified)
  1  IO / unexpected runtime failure
  2  usage error (bad flags, retired flag, unknown / non-FBS id)
  3  schema validation or broken references (tree unreadable, missing Code
     Nodes, a report that is not a valid VerifyReport v1, write refused)
  4  refused - CI evidence missing, not complete, off the default branch,
     no report, report head not contained in HEAD, loopback target, hand
     not separate from the builder, report too old, verdict not PASS or
     not ship authority, or a blocking per-AC verdict; the FBS is left
     unchanged
`;

/**
 * Referee-guarantee train (REQ-165 / US-16502, docs claim C-26).
 * Resolve the current git branch as an out-of-band read so finalise
 * can refuse promotion when the working tree is not on the default
 * branch. Returns `{ ok: true, branch }` on success, `{ ok: false,
 * reason }` when git is absent or the working tree is not a git
 * checkout (bare tarball deploys, container ephemeral CWD). Never
 * throws; the caller degrades to a warn line rather than a hard fail.
 *
 * Kept out of `#core/store` deliberately: this is a build-lite CLI
 * concern (the ship gate reads the working tree state), not a document
 * store concern. It also keeps the store free of a `spawn` seam.
 *
 * @param {object} args
 * @param {string} args.cwd
 * @param {{ spawn?: typeof spawn }} [args.deps]
 * @returns {Promise<{ ok: true, branch: string } | { ok: false, reason: string }>}
 */
async function resolveGitBranch({ cwd, deps = {} }) {
  const spawnFn = deps.spawn ?? spawn;
  return new Promise((resolveP) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawnFn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolveP({ ok: false, reason: `git spawn failed: ${err.message}` });
      return;
    }
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      resolveP({ ok: false, reason: `git spawn failed: ${err.message}` });
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolveP({ ok: false, reason: `git rev-parse exited ${code}: ${stderr.trim() || 'no output'}` });
        return;
      }
      const branch = stdout.trim();
      if (!branch) {
        resolveP({ ok: false, reason: 'git rev-parse returned empty branch name' });
        return;
      }
      resolveP({ ok: true, branch });
    });
  });
}

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

  // Referee-guarantee train (REQ-165 / US-16502, docs claim C-26): the
  // merge-state precondition. `verified` promises a post-merge check, so a
  // working tree off the default branch is refused unless --allow-pre-merge
  // records the deliberate dry run. Absent a git working tree the check
  // degrades to a warn line.
  const gitBranch = await resolveGitBranch({ cwd, deps });
  if (!gitBranch.ok) {
    stderr.write(`[warn] finalise: could not resolve git branch (${gitBranch.reason}); skipping the post-merge precondition. Referee-guarantees claim C-26.\n`);
  } else if (!DEFAULT_BRANCH_NAMES.has(gitBranch.branch)) {
    if (!flags['allow-pre-merge']) {
      stderr.write(`[finalise] gate NOT promoted: git working tree is on branch '${gitBranch.branch}', not a default trunk (${[...DEFAULT_BRANCH_NAMES].join(' / ')}); ${fbsId} left '${currentStatus}'.\n`);
      stderr.write('The referee-guarantees page promises that verified traces to an actual post-merge runtime check. Merge the branch and re-run finalise, or pass --allow-pre-merge for a deliberate pre-merge dry run (the decision is logged on stdout). Referee-guarantees claim C-26.\n');
      return 4;
    }
    if (!quiet) {
      stdout.write(`[finalise] --allow-pre-merge: promoting on branch '${gitBranch.branch}' (not a default trunk). Referee-guarantees claim C-26 records the pre-merge decision here.\n`);
    }
  }

  // --- ingest the Test-stage report (ADR-4148) ----------------------------
  const loaded = await loadVerifyReport({
    projectRoot,
    fbsId,
    reportPath: flags.report === undefined ? undefined : resolvePath(cwd, flags.report),
  });
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
