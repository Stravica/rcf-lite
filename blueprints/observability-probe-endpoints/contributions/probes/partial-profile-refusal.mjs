// Partial-profile-refusal probe for observability-probe-endpoints v1.2.1.
// Feeds a partial profile (missing paths.readiness) to the registry's
// refuseIfPartial and asserts the boot fails with a Named-key
// message. Then feeds one with startupEnabled=true but no paths.startup
// and asserts a second refusal.
// anchorAcId: AC-14103-1. accountBound: false.

import { refuseIfPartial, SHIPPED_PROFILES } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';

export const anchorAcId = 'AC-14103-1';
export const accountBound = false;

export default async function runProbe() {
  const results = [];
  const bad = { ...SHIPPED_PROFILES['kubernetes-request-listener'], paths: { liveness: '/live' } };
  let refusalMessage = null;
  try { refuseIfPartial(bad); } catch (e) { refusalMessage = e.message; }
  results.push({
    anchorAcId: 'AC-14103-1',
    verdict: refusalMessage && refusalMessage.includes('paths.readiness') ? 'pass' : 'fail',
    detail: `partial profile refusal message='${refusalMessage}'`,
    evidence: { refusalMessage },
  });
  const bad2 = { ...SHIPPED_PROFILES['kubernetes-startup'], paths: { liveness: '/live', readiness: '/ready' } };
  let refusal2 = null;
  try { refuseIfPartial(bad2); } catch (e) { refusal2 = e.message; }
  results.push({
    anchorAcId: 'AC-14103-2',
    verdict: refusal2 && refusal2.includes('paths.startup') ? 'pass' : 'fail',
    detail: `startupEnabled without paths.startup message='${refusal2}'`,
    evidence: { refusalMessage: refusal2 },
  });
  const ok = refuseIfPartial(SHIPPED_PROFILES['plain-http']);
  results.push({
    anchorAcId: 'AC-14103-3',
    verdict: ok.name === 'plain-http' ? 'pass' : 'fail',
    detail: `well-formed 'plain-http' accepted; returned name=${ok.name}`,
    evidence: { acceptedProfile: ok.name },
  });
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'] } };
}
