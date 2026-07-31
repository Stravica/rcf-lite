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
  const journeys = testable.map((ac) => {
    // Base disprove line — the AC-only framing verify has always shipped.
    const parts = [
      `Attempt to make the app FAIL "${ac.then}" starting from "${ac.given}" by doing "${ac.when}", and adversarial variations of it.`,
    ];
    // 0.7.0: service-attestation suffix (verification-integrity-cluster-spec
    // §5.2). Prompt-only; the chain records the attestation and verify
    // asks the agent to hunt for a delivery observable on the live URL.
    // No source-tree reading — the observable is a browser-reachable
    // artefact (admin log endpoint, receipt confirmation, delivery-log
    // page) or its absence is the honest verdict.
    const attestations = Array.isArray(ac.serviceAttestations) ? ac.serviceAttestations : [];
    for (const a of attestations) {
      if (!a || typeof a.serviceId !== 'string' || typeof a.attestationMode !== 'string') continue;
      parts.push(
        `If the AC depends on service \`${a.serviceId}\` attested \`${a.attestationMode}\`, verify a delivery observable exists on the running URL (e.g. an admin-log endpoint the browser can poll).`,
      );
    }
    // 0.7.0: UI-invariant suffix (ui-design-gate-0.7.0-spec §8.7). Fires
    // when the AC belongs to a UI-bearing FBS. Disproof-oriented; no
    // source-tree read; the check runs against the served HTML.
    if (ac.fbsUiBearing === true) {
      parts.push(
        'The FBS is UI-bearing; a shared nav bar must be present on every enumerated authenticated route, the theme toggle must be reachable, and the signed-in-as affordance must be visible when authenticated. Disprove any of these by observation.',
      );
    }
    return {
      acId: ac.acId,
      usId: ac.usId,
      journey: ac.title || ac.usId || ac.acId,
      given: ac.given,
      when: ac.when,
      then: ac.then,
      // The disproof prompt for THIS criterion: try to make `then` false,
      // plus any 0.7.0 attestation / UI suffixes the chain contributes.
      disprove: parts.join(' '),
    };
  });

  const instructions = [
    'You are an adversarial verifier. Your job is to DISPROVE the application against its acceptance criteria, not to confirm it works.',
    'You have NOT seen how this app was built, its source, or any claim that it was verified. Judge only the running app against the contract below.',
    `Drive the running app at ${url} through each journey using your browser tooling. For each acceptance criterion, actively try to break it: edge inputs, boundary conditions, isolation between users, error paths, and the exact security/quality floors the criterion promises.`,
    'For every defect, record: the acId it maps to, the journey, exact reproduction steps against the live URL, and evidence (screenshot path, response body, or runtime error).',
    'Classify each finding: BROKEN (a journey is dead or wrong), DEGRADED (works but a criterion is materially weakened / a false promise / a missed floor), or COSMETIC (hygiene, no AC touched). Report PASS only for criteria you actively tried and could not break.',
    'Do NOT claim the app is "fully verified" or "safe" — you are producing an independent ship-readiness signal, not a correctness guarantee.',
    '',
    'OUTPUT CONTRACT (mandatory). After any analysis, the FINAL thing you emit must be a single JSON object of exactly this shape, and nothing after it:',
    '{"findings":[{"severity":"BROKEN|DEGRADED|COSMETIC|PASS","acId":"<AC id>","journey":"<journey name>","reproSteps":["..."],"evidence":{"kind":"<http_response|runtimeError|screenshot|note>","detail":"..."}}]}',
    'Emit exactly one finding per acceptance criterion (a PASS finding for any you tried and could not break). The object must be valid JSON on its own — the harness extracts the last {"findings":[...]} object from your reply, so make sure your final object is complete and well-formed.',
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
