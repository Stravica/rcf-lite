// Self-contained finding-renderer (spec §5.3, §7.2). v1 core is store + errors
// + mcp-shell ONLY — the build `view/` layer is NOT a clean shell and is
// firmly OUT of v1 core. So verify ships its OWN minimal, dependency-free human
// render for `rcf-verify report`. Plain text, British English, ASCII hyphens —
// mirrors build's help-surface conventions without importing any core view code.
//
// Honest-limit language (§9): the render NEVER says "fully verified" / "safe".

/** One-line human summary of a verdict, including its ship implication. */
const VERDICT_LINE = {
  PASS: 'PASS — every AC verified against the running app; no defect above COSMETIC.',
  BROKEN: 'BROKEN — one or more ACs fail on the running app. Blocks ship.',
  DEGRADED: 'DEGRADED — app works but a criterion is materially weakened. Reported; may block per gate.',
  COSMETIC: 'COSMETIC — hygiene only; no AC touched. Does not block.',
  'NOT-DEPLOYED': 'NOT-DEPLOYED — deployed profile declared but no real deploy reachable. A refusal to issue a verdict, not a pass.',
  BLOCKED: 'BLOCKED — a prerequisite could not be provisioned; dependent ACs were not exercisable.',
  'LAUNCH-FAILURE': 'LAUNCH-FAILURE — the verifier agent could not run or its output could not be ingested. A refusal to issue a verdict, not a pass.',
};

/**
 * Render a report artifact to a human-readable string.
 *
 * @param {object} report
 * @returns {string}
 */
export function renderReport(report) {
  const lines = [];
  const run = report.run ?? {};
  lines.push('RCF Verify — verification report');
  lines.push('='.repeat(40));
  lines.push(`Verdict:   ${report.verdict}  [authority: ${report.verdictAuthority}]`);
  lines.push(`  ${VERDICT_LINE[report.verdict] ?? ''}`.trimEnd());
  lines.push('');
  lines.push('Runtime provenance');
  lines.push(`  profile:   ${run.profile}`);
  lines.push(`  url:       ${run.url}`);
  lines.push(`  parityEnv: ${run.parityEnv === true}`);
  if (run.reachability) {
    lines.push(`  reachable: ${run.reachability.reachable}  looksLocal: ${run.reachability.looksLocal}`);
  }
  lines.push(`  chainRef:  ${run.chainRef ?? '(none)'}`);
  lines.push(`  persona:   ${run.persona ?? '(default)'}`);
  if (run.verifierIsolation) {
    lines.push(`  isolation: autoMemory=${run.verifierIsolation.autoMemory} nonEssentialTraffic=${run.verifierIsolation.nonEssentialTraffic}`);
  }
  lines.push('');

  const findings = report.findings ?? [];
  lines.push(`Findings (${findings.length})`);
  if (findings.length === 0) {
    lines.push('  (none)');
  } else {
    for (const f of findings) {
      lines.push(`  [${f.severity}] ${f.acId} — ${f.journey}`);
      for (const step of f.reproSteps ?? []) lines.push(`      - ${step}`);
      if (f.evidence) {
        const detail = f.evidence.detail ?? f.evidence.kind ?? JSON.stringify(f.evidence);
        lines.push(`      evidence: ${detail}`);
      }
    }
  }
  lines.push('');

  const blocked = report.blockedAcs ?? [];
  if (blocked.length > 0) {
    lines.push(`Blocked ACs (${blocked.length}) — NOT exercisable, not silently skipped`);
    for (const b of blocked) lines.push(`  ${b.acId}: ${b.reason}`);
    lines.push('');
  }

  if (report.launchFailure) {
    lines.push('Launch failure');
    lines.push(`  ${report.launchFailure.message}`);
    if (report.launchFailure.rawOutputPath) lines.push(`  raw transcript: ${report.launchFailure.rawOutputPath}`);
    lines.push('');
  }

  if (run.runStats) {
    const s = run.runStats;
    const bits = [];
    if (typeof s.durationMs === 'number') bits.push(`duration=${s.durationMs}ms`);
    if (typeof s.numTurns === 'number') bits.push(`turns=${s.numTurns}`);
    if (s.tokens) bits.push(`tokens in/out=${s.tokens.inputTokens ?? '?'}/${s.tokens.outputTokens ?? '?'}`);
    if (typeof s.totalCostUsd === 'number') bits.push(`cost=$${s.totalCostUsd.toFixed(4)}`);
    if (bits.length) {
      lines.push(`Run stats: ${bits.join('  ')}`);
      lines.push('');
    }
  }

  const prov = report.provisioning;
  if (prov) {
    lines.push('Provisioning');
    lines.push(`  provisioned: ${(prov.provisioned ?? []).map((p) => p.ref).join(', ') || '(none)'}`);
    if ((prov.blocked ?? []).length) {
      lines.push(`  blocked:     ${prov.blocked.map((b) => `${b.kind} (${b.reason})`).join('; ')}`);
    }
    lines.push(`  cleanupRan:  ${prov.cleanupRan === true}  removed: ${(prov.cleanupRemoved ?? []).join(', ') || '(none)'}`);
    lines.push('');
  }

  lines.push('Note: this is an independent ship-readiness signal, not a correctness guarantee.');
  return `${lines.join('\n')}\n`;
}
