// Partial-profile-refusal probe for observability-probe-endpoints.
//
// AC-14103-2 requires the process to exit non-zero when a profile
// missing a required field is loaded at boot. This probe catches an
// in-process refusal via refuseIfPartial rather than spawning a
// child process and observing its OS exit code. Rows de-claimed
// (conformanceOnly, anchorAcId=null) with the limitation naming
// AC-14103-2.
//
// AC-14103-1 requires every field's value to belong to its enumerated
// set (not just presence). This row asserts presence only. Row
// de-claimed with the limitation naming AC-14103-1.
//
// AC-14103-3 requires the loadBalancer profile to be materialised
// and observed to expose exactly one /health handler and no /live
// or /ready handlers. This row asserts the resolved config shape but
// does not materialise and probe for extra handlers. Row de-claimed
// with the limitation naming AC-14103-3.

import { refuseIfPartial, resolveProfile } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';

export const anchorAcId = 'AC-14103-2';
export const accountBound = false;

const SHIPPED_NAMES = ['kubernetes', 'loadBalancer', 'uptimeMonitor', 'systemd', 'dockerHealthcheck', 'reverseProxy'];

const LIM_14103_2 = `AC-14103-2: requires the process to exit non-zero when a profile missing a required field is loaded at boot. This row catches an in-process refusal via refuseIfPartial rather than spawning a child process and observing its OS exit code.`;
const LIM_14103_1 = `AC-14103-1: requires every field's value to belong to its enumerated set (not just presence: transport must be an enum value, paths/command/notify each carry typed contents, semanticModel is one of a small set). This row asserts presence of each field only.`;
const LIM_14103_3 = `AC-14103-3: requires the loadBalancer profile to be materialised and observed to expose exactly one /health handler and no /live or /ready handlers. This row asserts the resolved config shape but does not materialise the profile and issue HTTP GETs against /live and /ready to prove absence of those handlers.`;

export default async function runProbe() {
  const results = [];

  // AC-14103-2 refusal via refuseIfPartial: strip 'transport' from the
  // kubernetes profile.
  const bad = { ...resolveProfile('kubernetes') };
  delete bad.transport;
  let refusalMessage = null;
  let refusalCode = null;
  let refusalMissing = null;
  try { refuseIfPartial(bad); } catch (e) { refusalMessage = e.message; refusalCode = e.code; refusalMissing = e.missingKey; }
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_14103_2,
    verdict: refusalCode === 'PROBE_PROFILE_INCOMPLETE' && refusalMissing === 'transport' ? 'pass' : 'fail',
    detail: `observed stripped-transport kubernetes profile refused via refuseIfPartial with code='${refusalCode}' missingKey='${refusalMissing}' message='${refusalMessage}'. Process-level non-zero exit not observed here.`,
    evidence: { refusalMessage, refusalCode, missingKey: refusalMissing },
  });

  // Second refusal: kubernetes with startupEnabled=true but no paths.startup.
  const bad2 = { ...resolveProfile('kubernetes') };
  bad2.startupEnabled = true;
  let refusalMessage2 = null;
  let refusalCode2 = null;
  let refusalMissing2 = null;
  try { refuseIfPartial(bad2); } catch (e) { refusalMessage2 = e.message; refusalCode2 = e.code; refusalMissing2 = e.missingKey; }
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_14103_2,
    verdict: refusalCode2 === 'PROBE_PROFILE_INCOMPLETE' && refusalMissing2 === 'paths.startup' ? 'pass' : 'fail',
    detail: `observed kubernetes with startupEnabled but no paths.startup refused via refuseIfPartial with code='${refusalCode2}' missingKey='${refusalMissing2}' message='${refusalMessage2}'. Process-level non-zero exit not observed here.`,
    evidence: { refusalMessage: refusalMessage2, refusalCode: refusalCode2, missingKey: refusalMissing2 },
  });

  // AC-14103-1 presence shape check for all six profiles.
  const shape = [];
  let allShapeOk = true;
  for (const name of SHIPPED_NAMES) {
    let resolved = null;
    let err = null;
    try { resolved = refuseIfPartial(resolveProfile(name)); } catch (e) { err = e.message; }
    const surfaceOk = resolved && (resolved.paths || resolved.command || resolved.notify);
    const ok = Boolean(resolved && resolved.transport && surfaceOk && resolved.responseContract && resolved.semanticModel);
    if (!ok) allShapeOk = false;
    shape.push({ name, transport: resolved?.transport, hasSurface: Boolean(surfaceOk), hasResponseContract: Boolean(resolved?.responseContract), hasSemanticModel: Boolean(resolved?.semanticModel), err });
  }
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_14103_1,
    verdict: allShapeOk ? 'pass' : 'fail',
    detail: `observed presence-only shape check for all six shipped profiles: ${JSON.stringify(shape)}. Enum-membership per field is not observed here.`,
    evidence: { acceptedProfile: 'all-six', resolvedTransport: 'mixed', resolvedPaths: {}, shape, shippedNames: SHIPPED_NAMES },
  });

  // AC-14103-3 loadBalancer shape observation (not materialised).
  const lb = resolveProfile('loadBalancer');
  const lbOk = lb.paths?.health && !lb.paths?.liveness && !lb.paths?.readiness && lb.semanticModel === 'singleHealthSignal';
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_14103_3,
    verdict: lbOk ? 'pass' : 'fail',
    detail: `The loadBalancer profile resolves to a single-endpoint HTTP GET  -  observed resolved paths=${JSON.stringify(lb.paths)} semanticModel='${lb.semanticModel}'; expected paths.health present with no paths.liveness/paths.readiness and semanticModel==='singleHealthSignal'. Materialised handler absence not observed here.`,
    evidence: { acceptedProfile: lb.name, resolvedTransport: lb.transport, resolvedPaths: lb.paths, semanticModel: lb.semanticModel },
  });

  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'], shippedNames: SHIPPED_NAMES } };
}
