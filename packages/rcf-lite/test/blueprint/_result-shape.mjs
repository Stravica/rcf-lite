// Shared row-shape assertions for application-* blueprint anatomy
// tests. One helper carries the four tightening rules the pack
// contract requires on every counting row:
//
// Rule a: every counting row REQUIRES evidence with a non-empty
// xFixtureRequestId (not "when present"). A row that reached the
// counting branch with evidence absent or the id blank fails here,
// never silently falls through.
//
// Rule b: every conformanceOnly.limitation must START with a
// shipped AC id then a colon, and that AC id must resolve against
// the blueprint's shipped acIds set. A limitation naming no AC
// prefix, or an unresolvable prefix, fails here.
//
// Rule c: every notObservableHere.ac must resolve against the
// blueprint's shipped acIds set. A row whose notObservableHere.ac
// is unresolvable fails here.
//
// Rule d: every counting row (a row that reached this point past
// the accountBoundSkipped, notObservableHere and conformanceOnly
// branches) MUST carry at least one shipped anchor - anchorAcId
// or anchorReqId. The value-resolution assertions further down
// validate an anchor VALUE but do not require the anchor to be
// present; rule d closes that gap so a counting result cannot land
// unanchored.
//
// `runResultShapeNegativeCases` exercises one negative case per
// rule against a synthetic acIds set, plus a positive case for
// rule d, so the tightening itself is covered from the anatomy
// suite - each family calls it once with its own slug so the
// family-local coverage is explicit.

import assert from 'node:assert/strict';

export function assertResultShape(r, { acIds, reqIds, name }) {
  const shaped = (r && typeof r.evidence === 'object' && r.evidence)
    || r.accountBoundSkipped === true
    || (r && typeof r.notObservableHere === 'object' && r.notObservableHere !== null);
  assert.ok(shaped, `${name} result missing evidence or accountBoundSkipped: ${JSON.stringify(r).slice(0, 200)}`);
  if (r.accountBoundSkipped === true) {
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0,
      name + ' account-bound skip missing named reason: ' + JSON.stringify(r).slice(0, 200));
    return;
  }
  if (r && typeof r.notObservableHere === 'object' && r.notObservableHere !== null) {
    assert.ok(typeof r.notObservableHere.ac === 'string' && r.notObservableHere.ac.length > 0,
      name + ' notObservableHere row missing .ac id: ' + JSON.stringify(r).slice(0, 200));
    assert.ok(typeof r.notObservableHere.reason === 'string' && r.notObservableHere.reason.length > 0,
      name + ' notObservableHere row missing .reason: ' + JSON.stringify(r).slice(0, 200));
    // Rule c: notObservableHere.ac must resolve to a shipped AC on this blueprint.
    assert.ok(acIds.has(r.notObservableHere.ac),
      name + ' notObservableHere.ac ' + r.notObservableHere.ac + ' is not a shipped AC on this blueprint');
    return;
  }
  if (r && r.conformanceOnly === true) {
    assert.ok(typeof r.limitation === 'string' && r.limitation.length > 0,
      name + ' conformanceOnly row missing limitation: ' + JSON.stringify(r).slice(0, 200));
    // Rule b: conformanceOnly.limitation must START with a shipped AC id then a colon.
    const limMatch = /^([a-z0-9-]+-AC-\d+-\d+):/i.exec(r.limitation);
    assert.ok(limMatch,
      name + ' conformanceOnly limitation must start with a shipped AC id then a colon: ' + JSON.stringify(r).slice(0, 200));
    assert.ok(acIds.has(limMatch[1]),
      name + ' conformanceOnly limitation AC prefix ' + limMatch[1] + ' is not a shipped AC on this blueprint');
  }
  if (r && typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0) {
    assert.ok(acIds.has(r.anchorAcId),
      name + ' anchorAcId ' + r.anchorAcId + ' is not a shipped AC on this blueprint');
  }
  if (r && typeof r.anchorReqId === 'string' && r.anchorReqId.length > 0) {
    assert.ok(reqIds.has(r.anchorReqId),
      name + ' anchorReqId ' + r.anchorReqId + ' is not a shipped REQ on this blueprint');
  }
  // Rule d: a counting row (a row that reached this point after the
  // accountBoundSkipped, notObservableHere, and conformanceOnly
  // branches above) MUST carry at least one shipped anchor -
  // anchorAcId or anchorReqId. The value-resolution checks above
  // validate the anchor's VALUE when present but do not require it
  // to be present; this assertion closes that gap so an unanchored
  // counting row cannot pass shape.
  if (!(r && r.conformanceOnly === true)) {
    const hasAcAnchor = typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0;
    const hasReqAnchor = typeof r.anchorReqId === 'string' && r.anchorReqId.length > 0;
    assert.ok(hasAcAnchor || hasReqAnchor,
      name + ' counting row missing anchorAcId and anchorReqId: ' + JSON.stringify(r).slice(0, 200));
  }
  // Rule a: every counting row REQUIRES evidence with a non-empty
  // request id (not "when present"). The shape gate above lets a
  // counting row reach this point only when evidence is an object;
  // this assertion makes the requirement explicit rather than
  // inferred.
  assert.ok(r && r.evidence && typeof r.evidence === 'object',
    name + ' counting row missing evidence object: ' + JSON.stringify(r).slice(0, 200));
  const ev = r.evidence;
  assert.ok(typeof ev.route === 'string' && ev.route.length > 0,
    name + ' evidence missing non-empty route: ' + JSON.stringify(ev).slice(0, 200));
  assert.ok(Number.isFinite(ev.status) && ev.status > 0,
    name + ' evidence status zero never counts: ' + JSON.stringify(ev).slice(0, 200));
  const hasRequestId = typeof ev.xFixtureRequestId === 'string' && ev.xFixtureRequestId.length > 0;
  assert.ok(hasRequestId,
    name + ' evidence missing non-empty request id: ' + JSON.stringify(ev).slice(0, 200));
  // "derived" must be a non-empty object; {} never counts as a derived value.
  const derivedIsPopulated = (ev && typeof ev.derived === 'object' && ev.derived !== null && Object.keys(ev.derived).length > 0)
    || (ev && typeof ev.derivedOutput === 'object' && ev.derivedOutput !== null && Object.keys(ev.derivedOutput).length > 0);
  const hasBodyExcerpt = typeof ev.bodyExcerpt === 'string' && ev.bodyExcerpt.length > 0;
  assert.ok(hasBodyExcerpt || derivedIsPopulated,
    name + ' evidence missing body excerpt or non-empty derived value: ' + JSON.stringify(ev).slice(0, 200));
}

// Four synthetic negative cases - one per rule - each expected to
// throw, plus a positive case for rule d that must not throw.
// Called from every family's anatomy test so the tightening itself
// is covered per family, using a shared helper that carries the
// cases once.
export function runResultShapeNegativeCases({ familySlug }) {
  const shippedAcId = `${familySlug}-AC-99999-9`;
  const shippedReqId = `${familySlug}-REQ-999`;
  const acIds = new Set([shippedAcId]);
  const reqIds = new Set([shippedReqId]);
  const name = `${familySlug}-negative-shape`;

  // Rule a: a counting row whose xFixtureRequestId is empty must fail.
  assert.throws(() => assertResultShape({
    anchorAcId: shippedAcId,
    verdict: 'pass',
    detail: 'synthetic counting row with empty request id',
    evidence: { route: '/x', status: 200, xFixtureRequestId: '', bodyExcerpt: 'x', derived: { k: 1 } },
  }, { acIds, reqIds, name }), /non-empty request id/, name + ' rule a: empty request id must fail');

  // Rule b: a conformanceOnly row whose limitation does not begin
  // with a resolvable AC id must fail.
  assert.throws(() => assertResultShape({
    anchorAcId: shippedAcId,
    verdict: 'pass',
    conformanceOnly: true,
    limitation: 'server-observable slice only; browser half not observed here',
    detail: 'synthetic conformanceOnly row with no AC prefix on the limitation',
    evidence: { route: '/x', status: 200, xFixtureRequestId: 'r-1', bodyExcerpt: 'x', derived: { k: 1 } },
  }, { acIds, reqIds, name }), /must start with a shipped AC id/, name + ' rule b: limitation without AC prefix must fail');

  // Rule b (variant): a conformanceOnly row whose limitation prefix
  // is shaped like an AC id but does not resolve must fail.
  assert.throws(() => assertResultShape({
    anchorAcId: shippedAcId,
    verdict: 'pass',
    conformanceOnly: true,
    limitation: `${familySlug}-AC-00000-0: some prefix that does not resolve`,
    detail: 'synthetic conformanceOnly row with unresolved AC prefix',
    evidence: { route: '/x', status: 200, xFixtureRequestId: 'r-2', bodyExcerpt: 'x', derived: { k: 1 } },
  }, { acIds, reqIds, name }), /is not a shipped AC/, name + ' rule b variant: limitation with unresolved AC prefix must fail');

  // Rule c: a notObservableHere row whose .ac does not resolve must fail.
  assert.throws(() => assertResultShape({
    verdict: 'pass',
    notObservableHere: { ac: `${familySlug}-AC-00000-0`, reason: 'synthetic' },
    detail: 'synthetic notObservableHere row with unresolved AC',
    evidence: { reason: 'not observable' },
  }, { acIds, reqIds, name }), /is not a shipped AC/, name + ' rule c: notObservableHere.ac must resolve');

  // Rule d (negative): a counting row (not conformanceOnly, not
  // notObservableHere, not accountBoundSkipped) carrying no
  // anchorAcId and no anchorReqId must fail. This is the
  // enforcement of "every counting result be anchored".
  assert.throws(() => assertResultShape({
    verdict: 'pass',
    detail: 'synthetic counting row with no anchor',
    evidence: { route: '/x', status: 200, xFixtureRequestId: 'r-3', bodyExcerpt: 'x', derived: { k: 1 } },
  }, { acIds, reqIds, name }), /counting row missing anchorAcId and anchorReqId/, name + ' rule d: unanchored counting row must fail');

  // Rule d (positive): a counting row carrying a resolvable
  // anchorAcId (with the other rule-a evidence fields present)
  // must pass shape. This complements the negative case above so
  // the anchor requirement is proven by both sides.
  assert.doesNotThrow(() => assertResultShape({
    anchorAcId: shippedAcId,
    verdict: 'pass',
    detail: 'synthetic anchored counting row',
    evidence: { route: '/x', status: 200, xFixtureRequestId: 'r-4', bodyExcerpt: 'x', derived: { k: 1 } },
  }, { acIds, reqIds, name }), name + ' rule d positive: anchored counting row must pass shape');
}
