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
  if (report.launchFailure?.message) {
    lines.push(`launch failure: ${report.launchFailure.message}`);
  }
  return `${lines.join('\n')}\n`;
}
