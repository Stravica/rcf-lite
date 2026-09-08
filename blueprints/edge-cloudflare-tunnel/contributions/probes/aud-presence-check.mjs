// Probe: aud-presence-check.
//
// anchorAcId list:
// - AC-tunnel-accessGated (primary)
// - AC-tunnel-accessGatedRefuse (drift refuse)
// accountBound: false.
//
// The probe reads the two sidecars under fixtureRoot()/sidecars and the
// two manifests per runtime under fixtureRoot()/<runtime>/cloudflare/tunnels/<mode>.yaml.
// A fixture-side delegate points FIXTURE_ROOT at a scratch copy to drive
// the fixture-side aud-drop mutation. The probe module itself is a pure
// function of the files it sees.
//
// Passes when:
// - Each access-gated manifest carries originRequest.access.aud equal to
//   the gated sidecar accessAud on every non-catch-all ingress rule.
// - Each public-hostname manifest carries no originRequest.access block.
//
// Fails when the gated variant drifts to omit the AUD block (the drift-
// refuse case). Also fails when the public-hostname variant carries an
// AUD block (that shape has no source of authority).

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runShim, fixtureRoot, parseTunnelYaml, RUNTIMES } from './probe-utils.mjs';

export const anchorAcIds = ['AC-tunnel-accessGated', 'AC-tunnel-accessGatedRefuse'];
export const accountBound = false;

async function loadSidecar(root, name) {
  const path = resolve(root, 'sidecars', `${name}.applied.json`);
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}

async function loadManifest(root, runtime, mode) {
  const path = resolve(root, runtime, 'cloudflare/tunnels', `${mode}.yaml`);
  const text = await readFile(path, 'utf8');
  return parseTunnelYaml(text);
}

export default async function runProbe() {
  const results = [];
  const extra = { fixtureRoot: fixtureRoot() };
  const root = fixtureRoot();
  const gatedSidecar = await loadSidecar(root, 'access-gated');
  const publicSidecar = await loadSidecar(root, 'public-hostname');
  const gatedHasZtg = (gatedSidecar.appliedCapabilities ?? []).includes('zeroTrustGate');
  const publicHasZtg = (publicSidecar.appliedCapabilities ?? []).includes('zeroTrustGate');
  extra.gatedSidecarZtg = gatedHasZtg;
  extra.publicSidecarZtg = publicHasZtg;
  if (!gatedHasZtg) {
    results.push({
      anchorAcId: 'AC-tunnel-accessGated',
      verdict: 'fail',
      detail: `access-gated sidecar is missing zeroTrustGate in appliedCapabilities (found: ${(gatedSidecar.appliedCapabilities ?? []).join(', ')})`,
    });
  }
  if (publicHasZtg) {
    results.push({
      anchorAcId: 'AC-tunnel-accessGated',
      verdict: 'fail',
      detail: `public-hostname sidecar unexpectedly names zeroTrustGate in appliedCapabilities (found: ${(publicSidecar.appliedCapabilities ?? []).join(', ')})`,
    });
  }
  for (const runtime of RUNTIMES) {
    // access-gated manifest: every non-catch-all rule attaches the AUD.
    const gDoc = await loadManifest(root, runtime, 'access-gated');
    const gRules = Array.isArray(gDoc.ingress) ? gDoc.ingress : [];
    const gNonCatch = gRules.filter((r) => !String(r.service ?? '').startsWith('http_status:'));
    const gAttached = gNonCatch.filter((r) => r?.originRequest?.access?.aud === gatedSidecar.accessAud);
    if (gAttached.length === gNonCatch.length && gNonCatch.length > 0) {
      results.push({
        anchorAcId: 'AC-tunnel-accessGated',
        verdict: 'pass',
        detail: `${runtime}/access-gated: all ${gNonCatch.length} non-catch-all rule(s) attach originRequest.access.aud=${gatedSidecar.accessAud}`,
      });
    } else {
      const missing = gNonCatch
        .filter((r) => r?.originRequest?.access?.aud !== gatedSidecar.accessAud)
        .map((r, i) => `service=${r.service} aud=${r?.originRequest?.access?.aud ?? '(none)'}`);
      results.push({
        anchorAcId: 'AC-tunnel-accessGatedRefuse',
        verdict: 'fail',
        detail: `${runtime}/access-gated: sidecar declares zeroTrustGate + accessAud=${gatedSidecar.accessAud} but ${gNonCatch.length - gAttached.length}/${gNonCatch.length} rule(s) drift (missing or wrong AUD). Drifted: ${missing.slice(0, 3).join(' | ')}`,
      });
    }
    // public-hostname manifest: no rule carries originRequest.access.
    const pDoc = await loadManifest(root, runtime, 'public-hostname');
    const pRules = Array.isArray(pDoc.ingress) ? pDoc.ingress : [];
    const carriers = pRules
      .map((r, i) => ({ i, r }))
      .filter(({ r }) => r?.originRequest?.access);
    if (carriers.length === 0) {
      results.push({
        anchorAcId: 'AC-tunnel-accessGated',
        verdict: 'pass',
        detail: `${runtime}/public-hostname: manifest omits originRequest.access on every ingress rule (open ingress by design)`,
      });
    } else {
      results.push({
        anchorAcId: 'AC-tunnel-accessGated',
        verdict: 'fail',
        detail: `${runtime}/public-hostname: sidecar declares no zeroTrustGate but ${carriers.length} ingress rule(s) carry originRequest.access; that shape has no source of authority`,
      });
    }
  }
  return { results, extra };
}

const engine = { kind: 'sidecar-read', image: 'edge-cloudflare-tunnel aud-presence facade', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('aud-presence-check', engine, runProbe);
}
