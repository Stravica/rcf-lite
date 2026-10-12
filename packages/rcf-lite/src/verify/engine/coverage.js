// Scoped coverage reconciliation (ADR-4147, ADR-4112 verified invariant).
// The brief asks the verifier for exactly one finding per acceptance
// criterion in scope. Whatever comes back is compared with the scoped set
// here so an omission can never read as a pass:
//   - a scoped, testable criterion with no finding and no blocked entry is
//     recorded on blockedAcs[] with reason `noFinding`, so the aggregate
//     verdict is BLOCKED when nothing was exercised and finalise refuses
//     promotion in every other case (blockedAcs[] is non-empty);
//   - a finding for a criterion outside the scope is dropped from the
//     findings that drive the verdict and noted on runStats.coverage so a
//     report reader can see it was returned and ignored.
// The same reconciliation runs in agent mode and in deterministic mode.
// Pure over data: no chain access, no IO.

/** Reason prefix on a blockedAcs[] entry recorded by this module. */
export const NO_FINDING_REASON = 'noFinding: the verifier returned no finding for this criterion although it was in scope; it was not shown to be exercised.';

/**
 * Reconcile the findings a verify pass returned against the scoped AC set.
 *
 * @param {object} args
 * @param {Array<object>} args.acs - the scoped, flattened acceptance criteria
 * @param {Array<object>} args.findings - normalised findings (each carries acId)
 * @param {Array<{acId: string, reason: string}>} args.blockedAcs - entries already recorded (provisioning, deterministic skips)
 * @param {string} args.mode - the verify mode, stamped on the entries this module adds
 * @returns {{ findings: object[], blockedAcs: object[], coverage: { expected: number, found: number, missing: string[], ignored: Array<{acId: string, severity: string}> } }}
 */
export function reconcileScopedCoverage({ acs = [], findings = [], blockedAcs = [], mode } = {}) {
  const scopedIds = new Set(acs.map((ac) => ac?.acId).filter((id) => typeof id === 'string'));
  const expected = acs.filter((ac) => ac && ac.testable !== false).map((ac) => ac.acId);
  const alreadyBlocked = new Set(blockedAcs.map((b) => b?.acId));

  const inScope = [];
  const ignored = [];
  for (const finding of findings) {
    if (scopedIds.has(finding.acId)) inScope.push(finding);
    else ignored.push({ acId: finding.acId, severity: finding.severity });
  }
  const foundIds = new Set(inScope.map((f) => f.acId));

  const missing = expected.filter((acId) => !foundIds.has(acId) && !alreadyBlocked.has(acId));
  const added = missing.map((acId) => ({ acId, reason: NO_FINDING_REASON, ...(mode ? { mode } : {}) }));

  return {
    findings: inScope,
    blockedAcs: [...blockedAcs, ...added],
    coverage: {
      expected: expected.length,
      found: expected.filter((acId) => foundIds.has(acId)).length,
      missing,
      ignored,
    },
  };
}
