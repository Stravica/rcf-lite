// Report ingestion (spec §8.2 + §5.4). Findings flow from verify to build-lite
// via the --out report file (chain-node-addressed camelCase JSON), NEVER via
// stdout scraping. build-lite reads the artifact and, on a blocked gate,
// surfaces the findings mapped to their contract lines (acId / chain node) so
// the operator can drive the §5.4 verify -> fix -> re-verify loop.
//
// This is deliberately a READ of verify's artifact - build never re-derives a
// verdict, it consumes the one verify stamped.

import { execFile } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * Load and parse a verify report artifact. Returns the parsed report, or a
 * shape describing why it could not be read (missing / unparseable) so the
 * caller can degrade gracefully - a gate failure with an unreadable report is
 * still a gate failure, never a pass.
 *
 * @param {string} reportPath
 * @param {object} [deps]
 * @param {typeof readFile} [deps.readFile]
 * @returns {Promise<{ ok: true, report: object } | { ok: false, reason: string }>}
 */
export async function loadReport(reportPath, deps = {}) {
  const read = deps.readFile ?? readFile;
  let raw;
  try {
    raw = await read(reportPath, 'utf8');
  } catch (err) {
    return { ok: false, reason: `report not found at ${reportPath}: ${err.message}` };
  }
  try {
    return { ok: true, report: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, reason: `report at ${reportPath} is not valid JSON: ${err.message}` };
  }
}

/**
 * Render a compact, human-readable finalise summary of a verify report. Maps
 * each finding to its contract line (acId) - the RCF payoff. Pure so it is
 * directly testable; the caller writes the returned string to its sink.
 *
 * The verification-integrity 0.7.0 additions (spec §5.2 / §4.5 finalise
 * text): if the report carries per-AC verdicts in
 * {MOCK-ONLY-DECLARED, BLOCKED-BY-DECLARATION}, they are surfaced as a
 * dedicated section so the operator sees an honest picture of what
 * shipped mock-only. The section renders even on a passing verdict
 * (it is disclosure, not a refusal).
 *
 * @param {object} report - a parsed verify report (§5.3 schema)
 * @returns {string}
 */
export function summariseReport(report) {
  const lines = [];
  const authority = report.verdictAuthority ? ` [${report.verdictAuthority}]` : '';
  lines.push(`verdict: ${report.verdict}${authority}`);
  const run = report.run ?? {};
  if (run.profile || run.url) {
    lines.push(`runtime: profile=${run.profile ?? '?'} url=${run.url ?? '?'}`
      + (run.parityEnv ? ' parity-env' : ''));
  }
  // ADR-4147: the scope the run covered (whole chain or the named FBS
  // items) so a reader of the finalise output never mistakes a one-unit
  // run for a whole-chain statement.
  if (typeof run.scope === 'string') {
    lines.push(`scope: ${run.scope}`
      + (typeof run.scopeAcCount === 'number' ? ` (${run.scopeAcCount} ACs)` : ''));
  }
  const findings = Array.isArray(report.findings) ? report.findings : [];
  if (findings.length > 0) {
    lines.push(`findings (${findings.length}):`);
    for (const f of findings) {
      const ac = f.acId ? ` ${f.acId}` : '';
      const journey = f.journey ? ` (${f.journey})` : '';
      lines.push(`  - ${f.severity ?? '?'}${ac}${journey}`);
    }
  }
  const blocked = Array.isArray(report.blockedAcs) ? report.blockedAcs : [];
  if (blocked.length > 0) {
    lines.push(`blocked ACs (${blocked.length}):`);
    for (const b of blocked) {
      lines.push(`  - ${b.acId ?? '?'}: ${b.reason ?? 'unprovisionable'}`);
    }
  }
  // ADR-4147 scoped coverage: findings returned for criteria outside the
  // scope were ignored by the verdict; name them rather than drop them.
  const ignored = Array.isArray(run.runStats?.coverage?.ignored) ? run.runStats.coverage.ignored : [];
  if (ignored.length > 0) {
    lines.push(`ignored findings outside scope (${ignored.length}):`);
    for (const i of ignored) {
      lines.push(`  - ${i.acId ?? '?'}: ${i.severity ?? '?'}`);
    }
  }
  const declared = findMockOnlyDeclaredAcs(report);
  if (declared.length > 0) {
    lines.push(`mock-only declared (${declared.length}):`);
    for (const d of declared) {
      lines.push(`  - ${d.acId ?? '?'} (${d.verdict}): ${d.reason ?? 'declaredMockOnly at pre-flight; verify emitted the honest verdict rather than a false PASS.'}`);
    }
  }
  // 0.8.0 slug-train car 4: NV-BL-GATE-01 pulls verify's profile-vs-AC
  // scope-mismatch check into REVIEW. When verify emits SCOPE-MISMATCH
  // on perAcVerdicts[] the summary surfaces it so REVIEW / finalise see
  // it. Zero-mismatch reports render nothing (no false-flag noise).
  const scopeMismatches = findScopeMismatchAcs(report);
  if (scopeMismatches.length > 0) {
    lines.push(`scope mismatches (${scopeMismatches.length}):`);
    for (const s of scopeMismatches) {
      lines.push(`  - ${s.acId ?? '?'} (${s.verdict}): ${s.reason ?? 'a bound TC is narrower than the AC scope; NV-BL-ADM-03 / NV-BL-GATE-01.'}`);
    }
  }
  if (report.launchFailure?.message) {
    lines.push(`launch failure: ${report.launchFailure.message}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Extract per-AC verdicts in {MOCK-ONLY-DECLARED, BLOCKED-BY-DECLARATION}
 * from a verify report. Verify authors these under `perAcVerdicts[]` in
 * the 0.7.0 extension; earlier reports carry no field, in which case
 * this returns an empty array (graceful when no verify-side extension
 * has landed — verify's train car is later).
 *
 * @param {object} report
 * @returns {Array<{ acId: string, verdict: string, reason?: string }>}
 */
export function findMockOnlyDeclaredAcs(report) {
  const perAc = Array.isArray(report?.perAcVerdicts) ? report.perAcVerdicts : [];
  return perAc
    .filter((e) => e && (e.verdict === 'MOCK-ONLY-DECLARED' || e.verdict === 'BLOCKED-BY-DECLARATION'))
    .map((e) => ({ acId: e.acId, verdict: e.verdict, reason: e.reason }));
}

/**
 * True when a verify report carries at least one MOCK-ONLY-DECLARED or
 * BLOCKED-BY-DECLARATION verdict. Used by the finalise gate to refuse
 * promotion to `verified` on such reports unless the operator has
 * explicitly shipped-without-verified (spec §5.2 finalise gate rule).
 *
 * @param {object} report
 * @returns {boolean}
 */
export function reportHasMockOnlyDeclared(report) {
  return findMockOnlyDeclaredAcs(report).length > 0;
}

/**
 * Extract SCOPE-MISMATCH per-AC verdicts from a verify report. Introduced
 * in the 0.8.0 slug-train (car 4) so REVIEW consumes the same shape via
 * NV-BL-GATE-01. Earlier reports carry no such entries; this returns an
 * empty array on those.
 *
 * @param {object} report
 * @returns {Array<{ acId: string, verdict: string, reason?: string }>}
 */
export function findScopeMismatchAcs(report) {
  const perAc = Array.isArray(report?.perAcVerdicts) ? report.perAcVerdicts : [];
  return perAc
    .filter((e) => e && e.verdict === 'SCOPE-MISMATCH')
    .map((e) => ({ acId: e.acId, verdict: e.verdict, reason: e.reason }));
}

/**
 * True when a verify report carries at least one SCOPE-MISMATCH per-AC
 * verdict. NV-BL-GATE-01 (0.8.0 slug-train car 4): the REVIEW gate
 * consumes this so a scope mismatch caught at REVIEW-time fails the
 * gate and returns the FBS to BUILD; the finalise gate reads the same
 * shape as a last-mile refusal.
 *
 * @param {object} report
 * @returns {boolean}
 */
export function reportHasScopeMismatch(report) {
  return findScopeMismatchAcs(report).length > 0;
}

/**
 * rcf-eval-node spec 2026-09-04 sections 5.2 + 8: extract per-AC
 * verdicts in {EVAL-MISSING, EVAL-BELOW-THRESHOLD} from a verify
 * report. Both refuse `rcf finalise` promotion to `verified` unless
 * the operator opts out via `--ship-without-eval "<reason>"`.
 *
 * @param {object} report
 * @returns {Array<{ acId: string, verdict: string, reason?: string }>}
 */
export function findEvalRefusalAcs(report) {
  const perAc = Array.isArray(report?.perAcVerdicts) ? report.perAcVerdicts : [];
  return perAc
    .filter((e) => e && (e.verdict === 'EVAL-MISSING' || e.verdict === 'EVAL-BELOW-THRESHOLD'))
    .map((e) => ({ acId: e.acId, verdict: e.verdict, reason: e.reason }));
}

/**
 * True when a verify report carries at least one EVAL-MISSING or
 * EVAL-BELOW-THRESHOLD verdict.
 *
 * @param {object} report
 * @returns {boolean}
 */
export function reportHasEvalRefusal(report) {
  return findEvalRefusalAcs(report).length > 0;
}

/**
 * Referee-guarantee train (REQ-165 / US-16501, docs claims C-28 / C-36).
 * Extract per-AC verdicts in {UI-BASELINE-UNMET} from a verify report.
 * The verdict is emitted by `uiPerAcVerdict` when a UI-bearing FBS has
 * a bound `browserVerification[]` record whose `verdict` came back
 * `block`; a block-severity probe-pack failure aggregates into the same
 * verdict (docs claim C-36). Earlier reports carry no perAcVerdicts
 * field; this returns an empty array in that case.
 *
 * @param {object} report
 * @returns {Array<{ acId: string, verdict: string, reason?: string }>}
 */
export function findUiBaselineUnmetAcs(report) {
  const perAc = Array.isArray(report?.perAcVerdicts) ? report.perAcVerdicts : [];
  return perAc
    .filter((e) => e && e.verdict === 'UI-BASELINE-UNMET')
    .map((e) => ({ acId: e.acId, verdict: e.verdict, reason: e.reason }));
}

/**
 * True when a verify report carries at least one UI-BASELINE-UNMET verdict.
 * Consumed by the finalise gate to refuse promotion to `verified` on a
 * failed UI baseline check (referee-guarantee C-28 / C-36).
 *
 * @param {object} report
 * @returns {boolean}
 */
export function reportHasUiBaselineUnmet(report) {
  return findUiBaselineUnmetAcs(report).length > 0;
}

/**
 * Referee-guarantee train (REQ-165 / US-16501, docs claim C-29).
 * Extract per-AC verdicts in {BROWSER-VERIFICATION-MISSING} from a
 * verify report. Emitted by `uiPerAcVerdict` when a UI-bearing FBS has
 * no `browserVerification[]` record on the manifest (verify has nothing
 * to read for the baseline check).
 *
 * @param {object} report
 * @returns {Array<{ acId: string, verdict: string, reason?: string }>}
 */
export function findBrowserVerificationMissingAcs(report) {
  const perAc = Array.isArray(report?.perAcVerdicts) ? report.perAcVerdicts : [];
  return perAc
    .filter((e) => e && e.verdict === 'BROWSER-VERIFICATION-MISSING')
    .map((e) => ({ acId: e.acId, verdict: e.verdict, reason: e.reason }));
}

/**
 * True when a verify report carries at least one
 * BROWSER-VERIFICATION-MISSING verdict. Consumed by the finalise gate
 * to refuse promotion to `verified` on a UI-bearing FBS whose bound
 * browser-verification record is absent (referee-guarantee C-29).
 *
 * @param {object} report
 * @returns {boolean}
 */
export function reportHasBrowserVerificationMissing(report) {
  return findBrowserVerificationMissingAcs(report).length > 0;
}

// ---------------------------------------------------------------------------
// FBS-220 (US-19002, ADR-4148): administrative Finalise ingests the
// Test-stage VerifyReport v1 the verifier committed under
// rcf/verify-reports/<fbs-id>/. Both functions read; neither writes, and the
// only child processes are git lookups.

const VERIFY_REPORTS_DIR = join('rcf', 'verify-reports');
const PER_AC_RESULTS = new Set(['pass', 'fail', 'skipped', 'critiqueOnly', 'critiqued']);
const DAY_MS = 24 * 60 * 60 * 1000;

const isText = (v) => typeof v === 'string' && v.length > 0;
const isTime = (v) => isText(v) && !Number.isNaN(Date.parse(v));

// The first VerifyReport v1 field that fails, as `<field> <problem>`, or null.
function verifyReportFault(report, fbsId) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return 'reportVersion: the report is not an object';
  if (report.reportVersion !== 1) return `reportVersion must be 1 (got ${JSON.stringify(report.reportVersion)})`;
  if (report.fbsId !== fbsId) return `fbsId must be ${fbsId} (got ${JSON.stringify(report.fbsId)})`;
  if (typeof report.headSha !== 'string' || !/^[0-9a-f]{40}$/.test(report.headSha)) return 'headSha must be a 40-character commit sha';
  const target = report.target;
  if (!target || typeof target !== 'object') return 'target must be an object';
  if (target.kind === 'url') {
    if (!isText(target.url)) return 'target.url must be a non-empty string';
  } else if (target.kind === 'package') {
    if (!isText(target.packageRef)) return 'target.packageRef must be a non-empty string';
  } else {
    return 'target.kind must be url | package';
  }
  for (const field of ['mode', 'hand', 'rcfLiteVersion', 'verdict', 'verdictAuthority']) {
    if (!isText(report[field])) return `${field} must be a non-empty string`;
  }
  if (report.verifierId !== null && !isText(report.verifierId)) return 'verifierId must be a string or null';
  for (const field of ['startedAt', 'finishedAt']) {
    if (!isTime(report[field])) return `${field} must be an ISO timestamp`;
  }
  if (!report.runStats?.counts || typeof report.runStats.counts !== 'object') return 'runStats.counts must be an object';
  if (!Array.isArray(report.perAc)) return 'perAc must be an array';
  for (const row of report.perAc) {
    if (!row || typeof row !== 'object' || !isText(row.acId)) return 'perAc rows must carry an acId';
    if (!PER_AC_RESULTS.has(row.result)) return `perAc ${row.acId} result must be one of ${[...PER_AC_RESULTS].join(' | ')}`;
  }
  return null;
}

/**
 * Locate, parse and validate the Test-stage report for one FBS. With no
 * explicit path the newest report (by finishedAt) under
 * rcf/verify-reports/<fbs-id>/ is taken. The selected report must be
 * committed at HEAD with its bytes on disk unchanged (FBS-230).
 *
 * @param {object} p
 * @param {string} p.projectRoot
 * @param {string} p.fbsId
 * @param {string} [p.reportPath] - absolute path from --report
 * @param {object} [deps]
 * @param {(args: string[]) => Promise<{ code: number, stdout: string }>} [deps.git]
 * @returns {Promise<{ ok: true, report: object, path: string } | { ok: false, code: number, message: string }>}
 */
export async function loadVerifyReport({ projectRoot, fbsId, reportPath }, deps = {}) {
  const missing = {
    ok: false,
    code: 4,
    message: `finalise refused: no Test-stage verify report for ${fbsId}; the verifier runs rcf verify run --fbs ${fbsId} --hand verifier before merge`,
  };
  let paths;
  if (reportPath) {
    paths = [reportPath];
  } else {
    const dir = join(projectRoot, VERIFY_REPORTS_DIR, fbsId);
    let names;
    try { names = await readdir(dir); } catch { return missing; }
    paths = names.filter((n) => n.endsWith('.json')).sort().map((n) => join(dir, n));
    if (paths.length === 0) return missing;
  }
  let chosen = null;
  for (const abs of paths) {
    const shown = relative(projectRoot, abs).split(sep).join('/');
    // FBS-230 (AC-19005-6): refuse a symlink at, or anywhere above, the
    // report below the repo root (lstat, never followed), so the checks
    // and the read below run on the real file only.
    const link = await firstSymlink(projectRoot, shown);
    if (link) return { ok: false, code: 4, message: `finalise refused: verify report ${shown} is read through a symlink at ${link}` };
    let report;
    try {
      report = JSON.parse(await readFile(abs, 'utf8'));
    } catch (err) {
      if (err?.code === 'ENOENT') return missing;
      return { ok: false, code: 3, message: `finalise refused: verify report ${shown} is not valid JSON: ${err.message}` };
    }
    const fault = verifyReportFault(report, fbsId);
    if (fault) return { ok: false, code: 3, message: `finalise refused: verify report ${shown} is not a valid VerifyReport v1: ${fault}` };
    if (!chosen || Date.parse(report.finishedAt) >= Date.parse(chosen.report.finishedAt)) chosen = { report, path: shown };
  }
  // FBS-230 (AC-19005-6): the selected report must be the bytes committed
  // at HEAD, read through git lookups only.
  const git = deps.git ?? ((args) => runGit(projectRoot, args));
  if ((await git(['cat-file', '-e', `HEAD:./${chosen.path}`])).code !== 0) {
    return { ok: false, code: 4, message: `finalise refused: verify report ${chosen.path} is not committed at HEAD` };
  }
  if ((await git(['diff', '--quiet', 'HEAD', '--', `./${chosen.path}`])).code !== 0) {
    return { ok: false, code: 4, message: `finalise refused: verify report ${chosen.path} differs from its committed bytes at HEAD` };
  }
  return { ok: true, ...chosen };
}

// The first repo-relative path component of `rel` that is a symbolic link,
// or null. A component that cannot be lstat'ed ends the walk; the read
// that follows reports it. Paths outside the root are left to the git
// checks.
async function firstSymlink(root, rel) {
  const parts = rel.split('/');
  if (parts[0] === '..' || rel.startsWith('/')) return null;
  for (let i = 1; i <= parts.length; i += 1) {
    const prefix = parts.slice(0, i).join('/');
    let st;
    try { st = await lstat(join(root, prefix)); } catch { return null; }
    if (st.isSymbolicLink()) return prefix;
  }
  return null;
}

function runGit(cwd, args) {
  return new Promise((res) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: (stdout ?? '').trim() });
    });
  });
}

// localhost, *.localhost, 127.0.0.0/8, ::1, 0.0.0.0. Shared with
// rcf verify run (FBS-230), so both sides read one loopback rule.
export function isLoopbackUrl(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  host = host.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(host)
    || host === '::1' || host === '0.0.0.0';
}

// The report head is contained in HEAD when it is an ancestor, or when a
// commit HEAD contains has the same tree outside rcf/verify-reports/ (the
// verifier's report commit is folded into a squash merge).
async function headContained(git, headSha) {
  if ((await git(['merge-base', '--is-ancestor', headSha, 'HEAD'])).code === 0) return true;
  if ((await git(['cat-file', '-e', `${headSha}^{commit}`])).code !== 0) return false;
  const listed = await git(['rev-list', 'HEAD', `^${headSha}`]);
  if (listed.code !== 0) return false;
  for (const commit of listed.stdout.split('\n').filter(Boolean)) {
    const diff = await git(['diff', '--quiet', headSha, commit, '--', ':/', `:(exclude)${VERIFY_REPORTS_DIR.split(sep).join('/')}`]);
    if (diff.code === 0) return true;
  }
  return false;
}

const TRUNK_REFS = ['origin/main', 'origin/master', 'main', 'master'];

// Hand-Id trailers of `Hand: builder` commits over the whole branch range.
// On a branch (FBS-230 gate r1 BH-2) the range is the merge-base of HEAD
// with the trunk to HEAD, whatever commit the report head is. When HEAD is
// on the trunk (the confirm after a merge) or no trunk ref resolves, it is
// the merge-base of the report head with the pre-merge trunk to HEAD.
async function builderHandIds(git, headSha) {
  const head = (await git(['rev-parse', 'HEAD'])).stdout;
  let base = null;
  for (const ref of TRUNK_REFS) {
    if ((await git(['rev-parse', '--verify', '-q', `${ref}^{commit}`])).code !== 0) continue;
    const fork = await git(['merge-base', 'HEAD', ref]);
    if (fork.code === 0 && fork.stdout && fork.stdout !== head) base = fork;
    break;
  }
  if (!base) {
    const trunk = (await git(['rev-list', '--first-parent', 'HEAD'])).stdout.split('\n').filter(Boolean);
    let preMerge = 'HEAD';
    for (const commit of trunk) {
      if ((await git(['merge-base', '--is-ancestor', headSha, commit])).code !== 0) { preMerge = commit; break; }
    }
    base = await git(['merge-base', preMerge, headSha]);
  }
  const revs = base.code === 0 && base.stdout ? ['HEAD', headSha, `^${base.stdout}`] : ['HEAD', headSha];
  const log = await git(['log', '--format=%(trailers:key=Hand,valueonly,separator=%x2C)%x1f%(trailers:key=Hand-Id,valueonly,separator=%x2C)%x1e', ...revs]);
  const ids = new Set();
  for (const entry of log.stdout.split('\x1e')) {
    const [hand, handId] = entry.trim().split('\x1f');
    if (!hand?.split(',').map((h) => h.trim()).includes('builder')) continue;
    for (const id of (handId ?? '').split(',')) if (id.trim()) ids.add(id.trim());
  }
  return ids;
}

/**
 * Provenance of an ingested report against the working tree: head
 * containment (ancestry or tree equality outside rcf/verify-reports/),
 * a loopback target only when it names its engine, port and served sha
 * (FBS-230), hand separation and the age window. Every refusal
 * is exit 4.
 *
 * @param {object} p
 * @param {object} p.report - a valid VerifyReport v1
 * @param {string} p.cwd - the git working tree
 * @param {number} p.maxReportAgeDays
 * @param {number} [p.now]
 * @param {object} [deps]
 * @param {(args: string[]) => Promise<{ code: number, stdout: string }>} [deps.git]
 * @returns {Promise<{ ok: true } | { ok: false, code: 4, message: string }>}
 */
export async function checkReportProvenance({ report, cwd, maxReportAgeDays, now = Date.now() }, deps = {}) {
  const git = deps.git ?? ((args) => runGit(cwd, args));
  const refuse = (message) => ({ ok: false, code: 4, message: `finalise refused: ${message}` });
  const head = (await git(['rev-parse', 'HEAD'])).stdout;
  if (!(await headContained(git, report.headSha))) {
    return refuse(`report head ${report.headSha.slice(0, 7)} is not contained in HEAD ${head.slice(0, 7)}; re-verify this head`);
  }
  // FBS-230 (ADR-4151): a loopback target is accepted when the report names
  // the engine, the port and the sha it served, and that sha is its head.
  if (report.target.kind === 'url' && isLoopbackUrl(report.target.url)) {
    const { engine, port, servedSha } = report.target;
    const named = {
      engine: isText(engine),
      port: Number.isInteger(port) && port >= 1 && port <= 65535,
      servedSha: isText(servedSha),
    };
    const missing = Object.keys(named).find((field) => !named[field]);
    if (missing) return refuse(`loopback report target ${report.target.url} names no target.${missing}`);
    if (servedSha !== report.headSha) {
      return refuse(`report target.servedSha ${servedSha.slice(0, 7)} is not the report head ${report.headSha.slice(0, 7)}`);
    }
  }
  const notSeparate = refuse(`report hand ${report.hand}/${report.verifierId} is not separate from the builder`);
  if (report.hand !== 'verifier') return notSeparate;
  if ((await builderHandIds(git, report.headSha)).has(report.verifierId)) return notSeparate;
  const ageMs = now - Date.parse(report.finishedAt);
  if (ageMs > maxReportAgeDays * DAY_MS) {
    return refuse(`report is ${Math.floor(ageMs / DAY_MS)} days old (finished ${report.finishedAt}; --max-report-age ${maxReportAgeDays}); re-verify this head`);
  }
  return { ok: true };
}
