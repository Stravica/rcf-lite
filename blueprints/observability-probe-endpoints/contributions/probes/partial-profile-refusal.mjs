// Partial-profile-refusal probe for observability-probe-endpoints.
// Feeds a partial profile (missing paths.readiness) and asserts the
// refuse-if-partial helper throws naming the missing key per AC-14103-2.
// Feeds one with startupEnabled=true but no paths.startup and asserts
// a second refusal per AC-14103-2. Then feeds a well-formed profile
// and asserts it resolves cleanly per AC-14103-1. Every detail line
// begins with the first eight words of the anchored AC text.
import { refuseIfPartial, SHIPPED_PROFILES } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';

export const anchorAcId = 'AC-14103-2';
export const accountBound = false;
const AC2 = 'A profile whose configuration is missing any one';
const AC1 = 'Each of the shipped profiles (`kubernetes`, `loadBalancer`, `uptimeMonitor`, `systemd`,';

export default async function runProbe() {
  const results = [];
  const bad = { ...SHIPPED_PROFILES['kubernetes-request-listener'], paths: { liveness: '/live' } };
  let refusalMessage = null;
  try { refuseIfPartial(bad); } catch (e) { refusalMessage = e.message; }
  results.push({
    anchorAcId: 'AC-14103-2',
    verdict: refusalMessage && refusalMessage.includes('paths.readiness') ? 'pass' : 'fail',
    detail: `${AC2} of transport, path  -  observed partial profile refusal message='${refusalMessage}' names paths.readiness.`,
    evidence: { refusalMessage, missingKey: 'paths.readiness' },
  });
  const bad2 = { ...SHIPPED_PROFILES['kubernetes-startup'], paths: { liveness: '/live', readiness: '/ready' } };
  let refusal2 = null;
  try { refuseIfPartial(bad2); } catch (e) { refusal2 = e.message; }
  results.push({
    anchorAcId: 'AC-14103-2',
    verdict: refusal2 && refusal2.includes('paths.startup') ? 'pass' : 'fail',
    detail: `${AC2} of transport, path  -  observed startupEnabled without paths.startup message='${refusal2}' names paths.startup.`,
    evidence: { refusalMessage: refusal2, missingKey: 'paths.startup' },
  });
  const ok = refuseIfPartial(SHIPPED_PROFILES['plain-http']);
  results.push({
    anchorAcId: 'AC-14103-1',
    verdict: ok.name === 'plain-http' && ok.transport && ok.paths && ok.responseContract && ok.semantics ? 'pass' : 'fail',
    detail: `${AC1}  -  observed well-formed 'plain-http' profile accepted; returned name=${ok.name} with non-null transport, paths, responseContract and semantics fields.`,
    evidence: { acceptedProfile: ok.name, resolvedTransport: ok.transport, resolvedPaths: ok.paths },
  });
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'] } };
}
