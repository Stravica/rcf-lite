// Report artifact (spec §5.3). The report is NOT a dead-end artifact — it is
// build-lite's next input (§5.4), so it is emitted chain-node-addressed and
// camelCase, with `schemaVersion` from day one so build-lite's ingest can
// version-gate. Credentials never appear in the report body (§10) — the
// builder passes an already-clean provisioning record, and redactSecrets is a
// defence-in-depth guard on top.

import { rcfError } from '#core/errors';

import { redactSecrets } from '../provision/index.js';
import { PER_AC_VERDICTS, VERDICTS } from '../verdict/index.js';

/** The report schema version. Present from day one for build-lite's version-gated ingest. */
export const SCHEMA_VERSION = '1';

const DEFAULT_PERSONA = 'generic-sceptic';

/**
 * Assemble the §5.3 report object. Pure — all runtime facts are passed in.
 *
 * @param {object} p
 * @returns {object} the report artifact
 */
export function buildReport(p) {
  const report = {
    schemaVersion: SCHEMA_VERSION,
    run: {
      profile: p.profile,
      url: p.url,
      parityEnv: Boolean(p.parityEnv),
      reachability: p.reachability ?? null,
      chainRef: p.chainRef ?? null,
      repo: p.repo ?? null,
      // ADR-4147 verification scope: 'chain' (no filter) or 'fbs:<ids>'
      // (the ACs bound to the named FBS items), plus the number of ACs
      // the run was briefed on. Additive; older readers ignore both.
      scope: typeof p.scope === 'string' && p.scope.length > 0 ? p.scope : 'chain',
      scopeAcCount: typeof p.scopeAcCount === 'number' ? p.scopeAcCount : null,
      persona: p.persona ?? DEFAULT_PERSONA,
      startedAt: p.startedAt ?? null,
      finishedAt: p.finishedAt ?? null,
      verifierIsolation: p.verifierIsolation ?? { autoMemory: false, nonEssentialTraffic: false },
      // Agent usage/timing from the --output-format json envelope (§5.3, additive).
      // Omit-not-fake: null when the launcher could not report it.
      runStats: p.runStats ?? null,
    },
    verdict: p.verdict,
    verdictAuthority: p.verdictAuthority,
    findings: Array.isArray(p.findings) ? p.findings : [],
    blockedAcs: Array.isArray(p.blockedAcs) ? p.blockedAcs : [],
    provisioning: p.provisioning ?? null,
    // Present (non-null) only on a LAUNCH-FAILURE verdict: the agent could not
    // run or its output could not be ingested. Carries the error + the path to
    // the preserved raw transcript so the §5.4 fix loop has something to ingest.
    launchFailure: p.launchFailure ?? null,
  };
  // 0.7.0 per-AC verdicts (verification-integrity-cluster-spec §5.2,
  // ui-design-gate §8.7). Present-only when at least one entry has been
  // derived from the chain — an older chain with no 0.7.0 fields produces
  // no per-AC verdicts and the field is omitted so backward-compatible
  // consumers (rcf finalise pre-0.7.0) do not see an unexpected field.
  if (Array.isArray(p.perAcVerdicts) && p.perAcVerdicts.length > 0) {
    report.perAcVerdicts = p.perAcVerdicts.map((v) => ({
      acId: v.acId,
      verdict: v.verdict,
      ...(v.reason !== undefined ? { reason: v.reason } : {}),
    }));
  }
  // FBS-218 (issue 349): deterministic mode's per-AC probe results
  // ({ acId, result: pass|fail|skipped|critiqueOnly|retired, evidence });
  // FBS-228: a retired AC carries evidence.supersededBy.
  // Present-only, so agent-mode reports are unchanged.
  if (Array.isArray(p.perAc)) report.perAc = p.perAc;
  // Defence-in-depth: never let a secret reach the report body (§10).
  return redactSecrets(report);
}

/** FBS-219 (US-19001): the five estate hands a VerifyReport may name. */
export const VERIFY_HANDS = Object.freeze(['test-author', 'builder', 'reviewer', 'verifier', 'stage-keeper']);

/**
 * Compose the Test-stage VerifyReport v1 (TAC-4148 recordShape) from a
 * finished run report plus the provenance the CLI resolved: the head the
 * run names, the target, the hand and the verifier identity. Pure.
 *
 * @param {object} p
 * @param {object} p.report - the run report from buildReport
 * @param {string} p.fbsId
 * @param {string} p.headSha
 * @param {{ kind: 'url', url: string, engine?: string, port?: number, servedSha?: string } | { kind: 'package', packageRef: string }} p.target - FBS-230: a loopback URL target names engine, port and servedSha
 * @param {string} p.mode
 * @param {string} p.hand
 * @param {string|null} p.verifierId
 * @param {string} p.rcfLiteVersion
 * @param {string} [p.method] - FBS-225: "suiteAsProbe" in package target mode
 * @param {object} [p.pack] - FBS-226: { command, exitCode } on a packed run
 * @param {object} [p.install] - FBS-225: { command, exitCode, logPath }; FBS-226 adds registry
 * @param {object[]} [p.suites] - FBS-225: one row per suite run
 * @returns {object}
 */
export function composeVerifyReport(p) {
  const run = p.report?.run ?? {};
  const counts = run.runStats?.counts ?? {};
  const perAc = Array.isArray(p.report?.perAc) ? p.report.perAc : [];
  // FBS-220 (ADR-4148): the per-AC verdicts the engine derived ride on the
  // perAc rows Finalise ingests (AC-19002-6).
  const perAcVerdict = new Map((Array.isArray(p.report?.perAcVerdicts) ? p.report.perAcVerdicts : [])
    .map((v) => [v.acId, v.verdict]));
  // FBS-220 (ADR-4148): a deterministic PASS is the ship authority; Finalise
  // is administrative and reads it from this report (AC-19002-1).
  const verdictAuthority = p.mode === 'deterministic' && p.report.verdict === 'PASS'
    ? 'ship'
    : p.report.verdictAuthority;
  return {
    reportVersion: 1,
    fbsId: p.fbsId,
    headSha: p.headSha,
    target: p.target,
    mode: p.mode,
    hand: p.hand,
    verifierId: p.verifierId ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    rcfLiteVersion: p.rcfLiteVersion,
    profile: run.profile,
    // FBS-225 (TAC-4151): package target mode's suite-as-probe evidence.
    ...(p.method === undefined ? {} : { method: p.method }),
    // FBS-226 (TAC-4151): the pack step, on a packed run only.
    ...(p.pack === undefined ? {} : { pack: p.pack }),
    ...(p.install === undefined ? {} : { install: p.install }),
    ...(p.suites === undefined ? {} : { suites: p.suites }),
    verdict: p.report.verdict,
    verdictAuthority,
    runStats: {
      counts: {
        verified: counts.verified ?? 0,
        failed: counts.failed ?? 0,
        skipped: counts.skipped ?? 0,
        critiqueOnly: counts.critiqueOnly ?? 0,
        total: counts.total ?? perAc.length,
      },
    },
    perAc: perAc.map((row) => ({
      acId: row.acId,
      result: row.result,
      ...(perAcVerdict.has(row.acId) ? { verdict: perAcVerdict.get(row.acId) } : {}),
      evidence: row.evidence ?? null,
    })),
  };
}

/**
 * FBS-225 (TAC-4151): the suite-as-probe verdict over runStats.counts:
 * PASS when every in-scope AC passed, FAIL when any failed, BLOCKED
 * otherwise.
 *
 * @param {{ verified: number, failed: number, total: number }} counts
 * @returns {'PASS'|'FAIL'|'BLOCKED'}
 */
export function suiteVerdict(counts) {
  if (counts.failed > 0) return 'FAIL';
  return counts.total > 0 && counts.verified === counts.total ? 'PASS' : 'BLOCKED';
}

/**
 * Serialise a report to the on-disk artifact string (camelCase JSON).
 *
 * @param {object} report
 * @returns {string}
 */
export function serialiseReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Parse a report artifact back (for `rcf-verify report`). Errors as data.
 *
 * @param {string} raw
 * @returns {object | import('#core/errors').RcfError}
 */
export function parseReport(raw) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return rcfError({ kind: 'parseFailure', message: `report is not valid JSON: ${err.message}` });
  }
  const shapeErr = validateReportShape(doc);
  if (shapeErr) return shapeErr;
  return doc;
}

/**
 * Minimal shape check on a report artifact.
 *
 * @param {object} doc
 * @returns {import('#core/errors').RcfError | null}
 */
export function validateReportShape(doc) {
  if (!doc || typeof doc !== 'object') {
    return rcfError({ kind: 'validation', message: 'report must be an object' });
  }
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    return rcfError({ kind: 'validation', message: `unsupported report schemaVersion: ${doc.schemaVersion ?? '(missing)'}`, field: 'schemaVersion' });
  }
  if (!VERDICTS.includes(doc.verdict)) {
    return rcfError({ kind: 'validation', message: `unknown verdict: ${doc.verdict}`, field: 'verdict' });
  }
  if (doc.verdictAuthority !== 'ship' && doc.verdictAuthority !== 'correctness') {
    return rcfError({ kind: 'validation', message: `verdictAuthority must be ship|correctness (got ${doc.verdictAuthority})`, field: 'verdictAuthority' });
  }
  if (!doc.run || typeof doc.run !== 'object') {
    return rcfError({ kind: 'validation', message: 'report.run is required', field: 'run' });
  }
  // perAcVerdicts is optional (0.7.0 addition); when present every entry
  // must carry an acId and a known per-AC verdict class. Unknown verdicts
  // are rejected as data so a consumer never has to guess the class of an
  // unfamiliar string.
  if (doc.perAcVerdicts !== undefined) {
    if (!Array.isArray(doc.perAcVerdicts)) {
      return rcfError({ kind: 'validation', message: 'report.perAcVerdicts must be an array when present', field: 'perAcVerdicts' });
    }
    for (const entry of doc.perAcVerdicts) {
      if (!entry || typeof entry !== 'object') {
        return rcfError({ kind: 'validation', message: 'report.perAcVerdicts entries must be objects', field: 'perAcVerdicts' });
      }
      if (typeof entry.acId !== 'string' || entry.acId.length === 0) {
        return rcfError({ kind: 'validation', message: 'report.perAcVerdicts[].acId is required', field: 'perAcVerdicts' });
      }
      if (!PER_AC_VERDICTS.includes(entry.verdict)) {
        return rcfError({ kind: 'validation', message: `report.perAcVerdicts[].verdict must be one of ${PER_AC_VERDICTS.join('/')} (got ${entry.verdict})`, field: 'perAcVerdicts' });
      }
    }
  }
  return null;
}
