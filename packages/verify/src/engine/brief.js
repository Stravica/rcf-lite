// Adversarial brief composition (spec §5, §9 guarantee 4). Verify is thin: it
// reads the chain and composes an adversarial brief from the ACs, then hands
// that brief to a fresh isolated agent (engine/launcher.js). The stance is
// DISPROOF — an adversarial walk derived independently from the ACs does not
// inherit the build's framing. The brief NEVER references the source tree, the
// build transcript, or a "this was verified" claim (§9 guarantee 1-2).

/** Default adversarial persona flavour (spec §3 --persona default). */
export const DEFAULT_PERSONA = 'generic-sceptic';

/**
 * Compose the adversarial brief the verifier agent is launched with. The brief
 * is built purely from the acceptance contract (ACs) + the live URL — the only
 * two inputs (§9 guarantee 2). Returned as structured data so tests can assert
 * the ACs drove it and no build context leaked in.
 *
 * @param {object} opts
 * @param {Array<object>} opts.acs - flattened ACs from the chain
 * @param {string} opts.url - the running app under test
 * @param {string} [opts.persona]
 * @param {string} [opts.chainRef]
 * @returns {{ persona: string, url: string, chainRef: string, stance: string, acCount: number, journeys: object[], instructions: string }}
 */
export function composeBrief({ acs = [], url, persona = DEFAULT_PERSONA, chainRef } = {}) {
  const testable = acs.filter((ac) => ac.testable !== false);
  const journeys = testable.map((ac) => ({
    acId: ac.acId,
    usId: ac.usId,
    journey: ac.title || ac.usId || ac.acId,
    given: ac.given,
    when: ac.when,
    then: ac.then,
    // The disproof prompt for THIS criterion: try to make `then` false.
    disprove: `Attempt to make the app FAIL "${ac.then}" starting from "${ac.given}" by doing "${ac.when}", and adversarial variations of it.`,
  }));

  const instructions = [
    'You are an adversarial verifier. Your job is to DISPROVE the application against its acceptance criteria, not to confirm it works.',
    'You have NOT seen how this app was built, its source, or any claim that it was verified. Judge only the running app against the contract below.',
    `Drive the running app at ${url} through each journey using your browser tooling. For each acceptance criterion, actively try to break it: edge inputs, boundary conditions, isolation between users, error paths, and the exact security/quality floors the criterion promises.`,
    'For every defect, record: the acId it maps to, the journey, exact reproduction steps against the live URL, and evidence (screenshot path, response body, or runtime error).',
    'Classify each finding: BROKEN (a journey is dead or wrong), DEGRADED (works but a criterion is materially weakened / a false promise / a missed floor), or COSMETIC (hygiene, no AC touched). Report PASS only for criteria you actively tried and could not break.',
    'Do NOT claim the app is "fully verified" or "safe" — you are producing an independent ship-readiness signal, not a correctness guarantee.',
  ].join('\n');

  return {
    persona,
    url,
    chainRef: chainRef ?? 'PRD-UNKNOWN',
    stance: 'disprove',
    acCount: testable.length,
    journeys,
    instructions,
  };
}
