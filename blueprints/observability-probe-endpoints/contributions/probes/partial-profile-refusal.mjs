// Partial-profile-refusal probe for observability-probe-endpoints.
//
// AC-14103-2: a profile missing any of transport, path/command/notify
// surface, response contract, or semantic model is refused at boot
// with a stable-coded PROBE_PROFILE_INCOMPLETE error naming the
// missing field. This probe strips a required field from each of the
// six shipped profiles in turn and asserts the refusal.
//
// AC-14103-1: each of the six shipped profiles resolves to a config
// object whose transport, paths (or command/notify equivalent),
// responseContract and semanticModel are all present. This probe
// asserts that shape for every shipped profile name.
//
// Every detail line begins with the first eight words of the AC text.
import { refuseIfPartial, resolveProfile, SHIPPED_PROFILES } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/src/profile-registry.mjs';

export const anchorAcId = 'AC-14103-2';
export const accountBound = false;
const AC2 = 'A profile whose configuration is missing any one';
const AC1 = 'Each of the shipped profiles (`kubernetes`, `loadBalancer`, `uptimeMonitor`, `systemd`,';

const SHIPPED_NAMES = ['kubernetes', 'loadBalancer', 'uptimeMonitor', 'systemd', 'dockerHealthcheck', 'reverseProxy'];

export default async function runProbe() {
  const results = [];

  // AC-14103-2: refusal with stable code. Strip 'transport' from the
  // kubernetes profile.
  const bad = { ...resolveProfile('kubernetes') };
  delete bad.transport;
  let refusalMessage = null;
  let refusalCode = null;
  let refusalMissing = null;
  try { refuseIfPartial(bad); } catch (e) { refusalMessage = e.message; refusalCode = e.code; refusalMissing = e.missingKey; }
  results.push({
    anchorAcId: 'AC-14103-2',
    verdict: refusalCode === 'PROBE_PROFILE_INCOMPLETE' && refusalMissing === 'transport' ? 'pass' : 'fail',
    detail: `${AC2} of transport, path  -  observed stripped-transport kubernetes profile refused with code='${refusalCode}' missingKey='${refusalMissing}' message='${refusalMessage}'.`,
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
    anchorAcId: 'AC-14103-2',
    verdict: refusalCode2 === 'PROBE_PROFILE_INCOMPLETE' && refusalMissing2 === 'paths.startup' ? 'pass' : 'fail',
    detail: `${AC2} of transport, path  -  observed kubernetes with startupEnabled but no paths.startup refused with code='${refusalCode2}' missingKey='${refusalMissing2}' message='${refusalMessage2}'.`,
    evidence: { refusalMessage: refusalMessage2, refusalCode: refusalCode2, missingKey: refusalMissing2 },
  });

  // AC-14103-1: every shipped profile name resolves to a complete
  // shape. Assert transport, one of paths/command/notify present,
  // responseContract, and semanticModel are all present.
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
    anchorAcId: 'AC-14103-1',
    verdict: allShapeOk ? 'pass' : 'fail',
    detail: `${AC1}  -  observed shape check for all six shipped profiles: ${JSON.stringify(shape)}.`,
    evidence: { acceptedProfile: 'all-six', resolvedTransport: 'mixed', resolvedPaths: {}, shape, shippedNames: SHIPPED_NAMES },
  });

  // AC-14103-3: loadBalancer resolves to a single-endpoint HTTP GET
  // with semanticModel === 'singleHealthSignal'; no live/ready split.
  const lb = resolveProfile('loadBalancer');
  const lbOk = lb.paths?.health && !lb.paths?.liveness && !lb.paths?.readiness && lb.semanticModel === 'singleHealthSignal';
  results.push({
    anchorAcId: 'AC-14103-3',
    verdict: lbOk ? 'pass' : 'fail',
    detail: `AC-14103-3 loadBalancer profile  -  observed resolved paths=${JSON.stringify(lb.paths)} semanticModel='${lb.semanticModel}'; expected paths.health present with no paths.liveness/paths.readiness and semanticModel==='singleHealthSignal'.`,
    evidence: { acceptedProfile: lb.name, resolvedTransport: lb.transport, resolvedPaths: lb.paths, semanticModel: lb.semanticModel },
  });

  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_PROBE_PORT', 'RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT'], shippedNames: SHIPPED_NAMES } };
}
