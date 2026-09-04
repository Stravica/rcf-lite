// Report ingestion (spec §8.2 + §5.4). Findings flow from verify to build-lite
// via the --out report file (chain-node-addressed camelCase JSON), NEVER via
// stdout scraping. build-lite reads the artifact and, on a blocked gate,
// surfaces the findings mapped to their contract lines (acId / chain node) so
// the operator can drive the §5.4 verify -> fix -> re-verify loop.
//
// This is deliberately a READ of verify's artifact - build never re-derives a
// verdict, it consumes the one verify stamped.

import { readFile } from 'node:fs/promises';

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
