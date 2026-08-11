// Attestation × Profile enforcement matrix
// (verification-integrity-cluster-spec §3.5, §5.2).
//
// Pure data + pure classifiers. Consumers:
//   - `coverage --strict` gates on the matrix at build time (§5.1, §5.2);
//   - the Review-stage test-theatre audit re-runs the matrix at
//     Stage 3 as one of its finding categories (§5.5, `attestationDrift`);
//   - verify's deployed-verdict gate reads the same matrix inputs
//     (aggregated attestations per AC) at chain-read time (§9.2 seam).
//
// The matrix returns a verdict + a per-cell reason string that
// downstream consumers can render in table / JSON / mermaid without
// re-deriving the semantics.

/**
 * @typedef {'live'|'sandboxed'|'mocked'|'declaredMockOnly'|'notShipped'} AttestationMode
 * @typedef {'mock'|'stub'|'fixture'|'live'|'mixed'} ProvenanceProfile
 * @typedef {'pass'|'passWithWarn'|'refuse'} MatrixVerdict
 */

/**
 * The matrix cell.
 * @typedef {object} MatrixCell
 * @property {MatrixVerdict} verdict
 * @property {string} reason
 */

/**
 * Classify one (attestationMode, profile) pair.
 *
 * @param {AttestationMode} attestation
 * @param {ProvenanceProfile} profile
 * @returns {MatrixCell}
 */
export function classifyAttestationProfile(attestation, profile) {
  // `mixed` in a TC is an anti-pattern flag by design: it should be
  // expanded into finer TCs. coverage --strict refuses it here on the
  // build side (§3.5 note on mixed) regardless of the covering AC's
  // attestation.
  if (profile === 'mixed') {
    return {
      verdict: 'refuse',
      reason: 'TC profile is `mixed`; expand into finer TCs before coverage --strict will accept it.',
    };
  }
  if (attestation === 'notShipped') {
    return { verdict: 'pass', reason: 'AC does not gate ship; attestation notShipped.' };
  }
  if (attestation === 'mocked') {
    return { verdict: 'pass', reason: 'AC attests mocked; any TC profile passes.' };
  }
  if (attestation === 'declaredMockOnly') {
    if (profile === 'live') {
      return {
        verdict: 'passWithWarn',
        reason: 'AC attests declaredMockOnly but TC went live; recorded as attestationDrift.',
      };
    }
    return { verdict: 'pass', reason: 'AC attests declaredMockOnly; mock / stub / fixture is expected.' };
  }
  if (attestation === 'live') {
    if (profile === 'live') return { verdict: 'pass', reason: 'live × live.' };
    return {
      verdict: 'refuse',
      reason: `AC attests live; TC provenance is \`${profile}\`. Elevate the TC to live OR downgrade the AC attestation OR add a live-profile TC alongside the mock one.`,
    };
  }
  if (attestation === 'sandboxed') {
    if (profile === 'live' || profile === 'stub') return { verdict: 'pass', reason: 'sandboxed × live/stub (points at sandbox).' };
    return {
      verdict: 'refuse',
      reason: `AC attests sandboxed; TC provenance is \`${profile}\`. Elevate the TC to live/stub against the sandbox OR downgrade the AC attestation.`,
    };
  }
  return { verdict: 'refuse', reason: `Unknown attestation mode \`${attestation}\`.` };
}

/**
 * Aggregate the `dependsOnServices` entries across every FBS that binds
 * each AC. Returns a map `acId -> Array<{ serviceId, attestationMode,
 * fbsId }>`. This is the shape verify's chain reader will surface via
 * core's walker (spec §5.2 / §9.2); build re-computes it locally for
 * `coverage --strict`.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Map<string, Array<{ serviceId: string, attestationMode: AttestationMode, fbsId: string }>>}
 */
export function aggregateAttestationsByAc(tree) {
  /** @type {Map<string, Array<{ serviceId: string, attestationMode: AttestationMode, fbsId: string }>>} */
  const out = new Map();
  for (const fbs of tree.fbsItems ?? []) {
    const services = Array.isArray(fbs.dependsOnServices) ? fbs.dependsOnServices : [];
    for (const svc of services) {
      if (!svc?.id || !svc?.attestationMode || !Array.isArray(svc.acIds)) continue;
      for (const acId of svc.acIds) {
        if (!out.has(acId)) out.set(acId, []);
        out.get(acId).push({
          serviceId: svc.id,
          attestationMode: svc.attestationMode,
          fbsId: fbs.fbsId,
        });
      }
    }
  }
  return out;
}

/**
 * Given a walker tree, produce the pre-flight service coverage: for
 * every service the preFlightConfig[] records name (except notShipped)
 * whose entry carries a non-empty `affectedFbsIds`, cross-check that
 * every affected FBS carries a matching `dependsOnServices[]` entry.
 * The `affectedFbsIds` back-reference is the load-bearing link between
 * a preflight ruling and the FBSes that inherit it (spec §3.3); when
 * empty we skip the check for that service rather than raise on every
 * FBS — v1 stays honest about what it can and cannot infer.
 *
 * Used by `coverage --strict` to detect "attestation missing" (spec
 * §5.2) — an FBS listed in `affectedFbsIds` for a pre-flight-declared
 * service must itself carry the `dependsOnServices` entry naming that
 * service.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Array<{ serviceId: string, fbsId: string, attestationMode: AttestationMode }>}
 */
export function findAttestationMissing(tree) {
  /** @type {Array<{ serviceId: string, fbsId: string, attestationMode: AttestationMode }>} */
  const missing = [];
  const preflight = Array.isArray(tree.manifest?.preFlightConfig) ? tree.manifest.preFlightConfig : [];
  if (preflight.length === 0) return missing;

  for (const pfc of preflight) {
    for (const s of pfc.servicesInScope ?? []) {
      if (!s?.id) continue;
      if (s.attestationMode === 'notShipped') continue;
      const affected = Array.isArray(s.affectedFbsIds) ? s.affectedFbsIds : [];
      if (affected.length === 0) continue;
      for (const fbsId of affected) {
        const fbs = tree.byId.get(fbsId);
        if (!fbs || tree.kindById.get(fbsId) !== 'fbs') continue;
        const hasEntry = (fbs.dependsOnServices ?? []).some((e) => e.id === s.id);
        if (!hasEntry) {
          missing.push({ serviceId: s.id, fbsId, attestationMode: s.attestationMode });
        }
      }
    }
  }
  return missing;
}

/**
 * Given a walker tree, list every preFlightConfig service whose
 * `affectedFbsIds` back-reference is empty. The `attestation-missing`
 * detector (findAttestationMissing) skips those services on purpose:
 * without the back-reference there is nothing to cross-check against,
 * but the honest posture is to surface the skip so the operator can
 * back-fill the field (review N-3 non-blocking finding).
 *
 * notShipped services are excluded: they never gate ship and never
 * contribute an FBS-level attestation, so an empty back-reference on
 * them is fine.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Array<{ serviceId: string, preFlightConfigId: string, attestationMode: AttestationMode }>}
 */
export function findServicesWithEmptyAffectedFbsIds(tree) {
  /** @type {Array<{ serviceId: string, preFlightConfigId: string, attestationMode: AttestationMode }>} */
  const out = [];
  const preflight = Array.isArray(tree.manifest?.preFlightConfig) ? tree.manifest.preFlightConfig : [];
  for (const pfc of preflight) {
    for (const s of pfc.servicesInScope ?? []) {
      if (!s?.id) continue;
      if (s.attestationMode === 'notShipped') continue;
      const affected = Array.isArray(s.affectedFbsIds) ? s.affectedFbsIds : [];
      if (affected.length === 0) {
        out.push({ serviceId: s.id, preFlightConfigId: pfc.id, attestationMode: s.attestationMode });
      }
    }
  }
  return out;
}

/**
 * Given a walker tree and a target FBS id, return the FBS's
 * `dependsOnServices[]` entries whose service `id` is not named in
 * ANY `preFlightConfig[].servicesInScope[].id`. Powers the `rcf build
 * --next` preflight-warning that the elicitation and build-cycle
 * playbooks already advertise (spec section 4.2, review N-1
 * non-blocking finding); the warning nudges the operator to run `rcf
 * preflight` before the coverage-strict gate refuses at Stage 4.
 *
 * Returns an empty array when the FBS has no dependsOnServices,
 * when the FBS is not found, or when every service is preflight-backed.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @param {string} fbsId
 * @returns {Array<{ serviceId: string, displayName?: string, attestationMode?: AttestationMode }>}
 */
export function scanUnbackedServices(tree, fbsId) {
  const fbs = tree?.byId?.get?.(fbsId);
  if (!fbs || tree?.kindById?.get?.(fbsId) !== 'fbs') return [];
  const services = Array.isArray(fbs.dependsOnServices) ? fbs.dependsOnServices : [];
  if (services.length === 0) return [];
  const preflight = Array.isArray(tree.manifest?.preFlightConfig) ? tree.manifest.preFlightConfig : [];
  const covered = new Set();
  for (const pfc of preflight) {
    for (const s of pfc.servicesInScope ?? []) {
      if (s?.id) covered.add(s.id);
    }
  }
  /** @type {Array<{ serviceId: string, displayName?: string, attestationMode?: AttestationMode }>} */
  const unbacked = [];
  for (const s of services) {
    if (!s?.id || covered.has(s.id)) continue;
    const entry = { serviceId: s.id };
    if (typeof s.displayName === 'string') entry.displayName = s.displayName;
    if (typeof s.attestationMode === 'string') entry.attestationMode = s.attestationMode;
    unbacked.push(entry);
  }
  return unbacked;
}

/**
 * Given a walker tree, list every TC that lacks `runtimeProvenance`
 * where the covering AC binds a dependsOnServices entry. This is the
 * §5.1 gate: provenance is authored, not remembered, on any AC that
 * binds a service — coverage --strict refuses without it.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Array<{ tsId: string, tcId: string, acId: string }>}
 */
export function findProvenanceMissing(tree) {
  const acsWithServices = new Set(aggregateAttestationsByAc(tree).keys());
  /** @type {Array<{ tsId: string, tcId: string, acId: string }>} */
  const missing = [];
  for (const ts of tree.testSuites ?? []) {
    for (const tc of ts.testCases ?? []) {
      if (!tc?.acId) continue;
      if (!acsWithServices.has(tc.acId)) continue;
      if (!tc.runtimeProvenance || typeof tc.runtimeProvenance.profile !== 'string') {
        missing.push({ tsId: ts.id, tcId: tc.id, acId: tc.acId });
      }
    }
  }
  return missing;
}

/**
 * Given a walker tree, find every TC whose runtimeProvenance profile
 * contradicts the covering AC's aggregated attestation, per the §3.5
 * matrix. Returns one entry per offending TC × service pair, so a TC
 * covering an AC governed by two services can raise twice (both must
 * be resolved before ship).
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Array<{ tsId: string, tcId: string, acId: string, serviceId: string, attestationMode: AttestationMode, profile: ProvenanceProfile, verdict: MatrixVerdict, reason: string }>}
 */
export function findAttestationDrift(tree) {
  const attByAc = aggregateAttestationsByAc(tree);
  /** @type {Array<{ tsId: string, tcId: string, acId: string, serviceId: string, attestationMode: AttestationMode, profile: ProvenanceProfile, verdict: MatrixVerdict, reason: string }>} */
  const drift = [];
  for (const ts of tree.testSuites ?? []) {
    for (const tc of ts.testCases ?? []) {
      const profile = tc?.runtimeProvenance?.profile;
      if (typeof profile !== 'string') continue;
      const bindings = attByAc.get(tc.acId) ?? [];
      for (const { serviceId, attestationMode } of bindings) {
        const cell = classifyAttestationProfile(attestationMode, profile);
        if (cell.verdict === 'refuse' || cell.verdict === 'passWithWarn') {
          drift.push({
            tsId: ts.id,
            tcId: tc.id,
            acId: tc.acId,
            serviceId,
            attestationMode,
            profile,
            verdict: cell.verdict,
            reason: cell.reason,
          });
        }
      }
    }
  }
  return drift;
}
