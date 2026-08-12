// Shared standards ruleset loader (NV-BL-SR-01, NV-BL-SR-02, NV-BL-SR-03).
//
// The ruleset is a single machine-readable artefact bundled inside the
// rcf-lite umbrella package (JSON, camelCase per estate convention). Both
// build-lite (as a gate) and rcf-define-lite (as an elicitation checklist,
// from the umbrella release that adds the define payload) consume the
// identical ruleset from the identical umbrella version.
//
// Per NV-BL-SR-02 (ratified 2026-08-11, ruling-sheet items 2 and 6): the
// ruleset carries no separate semver. Its version IS the rcf-lite umbrella
// package version. This loader stamps `rulesetVersion` at read time from
// the umbrella's package.json so a redeploy of the same JSON on a bumped
// umbrella version reports the new version without a data edit.
//
// Ruleset scope covers chain admissibility AND the estate's traceability
// and query tooling (ratified 2026-08-11, ruling-sheet item 1 addendum).
// See toolScope on the artefact.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rulesetPath = join(here, 'ruleset.json');
const packageJsonPath = resolve(here, '..', '..', 'package.json');

/**
 * @typedef {object} RulesetRule
 * @property {string} id
 * @property {string} title
 * @property {boolean} [refuseByDefault]
 * @property {string} [overrideChannel]
 */

/**
 * @typedef {object} Ruleset
 * @property {string} id
 * @property {string} rulesetVersion - the rcf-lite umbrella package version at load time.
 * @property {RulesetRule[]} admissibilityRules
 * @property {RulesetRule[]} gateRules
 * @property {object} scopeTagVocabulary
 * @property {Array<{ marker: string, caseInsensitive: boolean }>} sourceCommentMarkers
 * @property {Array<{ id: string, title: string, surface: string }>} tcTemplateFamily
 * @property {Array<{ id: string, title: string, kind: string }>} rulingConsistencyChecks
 * @property {{ chainAdmissibility: boolean, traceabilityAndQueryTools: boolean }} toolScope
 */

let cachedRuleset = null;
let cachedUmbrellaVersion = null;

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

/**
 * The rcf-lite umbrella package version at load time. Used by
 * `getRuleset()` to stamp `rulesetVersion` per NV-BL-SR-02; also exported
 * so consumers can read the umbrella version without opening
 * `package.json` themselves.
 *
 * @returns {Promise<string>}
 */
export async function getUmbrellaVersion() {
  if (cachedUmbrellaVersion) return cachedUmbrellaVersion;
  const pkg = await readJson(packageJsonPath);
  if (typeof pkg?.version !== 'string' || pkg.version.length === 0) {
    throw new Error('rcf-lite umbrella package.json is missing a version string');
  }
  cachedUmbrellaVersion = pkg.version;
  return cachedUmbrellaVersion;
}

/**
 * Load the shared standards ruleset artefact and stamp its `rulesetVersion`
 * from the umbrella package.json. The artefact itself carries no version
 * field (NV-BL-SR-02); read-time stamping is the single source of truth.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.fresh] - bypass the module-scope cache and re-read
 * @returns {Promise<Ruleset>}
 */
export async function getRuleset({ fresh = false } = {}) {
  if (!fresh && cachedRuleset) return cachedRuleset;
  const [artefact, umbrellaVersion] = await Promise.all([
    readJson(rulesetPath),
    getUmbrellaVersion(),
  ]);
  // Defensive: strip any accidental rulesetVersion baked into the JSON so
  // the umbrella version is authoritative. NV-BL-SR-02 is emphatic about
  // this: a divergence here is a spec drift, not a data field.
  delete artefact.rulesetVersion;
  cachedRuleset = Object.freeze({ ...artefact, rulesetVersion: umbrellaVersion });
  return cachedRuleset;
}

/**
 * Detect whether the ruleset version on a chain differs from the shipping
 * ruleset version, and classify the drift for NV-BL-ADM-06 (build-stage
 * refusal) and DL-REQ-VALIDATE-03 (define-stage warning).
 *
 * Additive-only drift (only new rule ids appear on the shipping side) is
 * classified `additive` and warns rather than refuses. Any other version
 * mismatch is classified `behavioural` and refuses at build stage.
 *
 * Same-version comparisons return `{ drift: 'none' }`.
 *
 * @param {object} args
 * @param {string|null|undefined} args.chainRulesetVersion - version the chain declared it was authored against.
 * @param {Ruleset} [args.ruleset] - shipping ruleset; defaults to the loaded artefact.
 * @returns {Promise<{ drift: 'none' | 'additive' | 'behavioural' | 'missing', shippingVersion: string, chainVersion: string | null }>}
 */
export async function detectRulesetDrift({ chainRulesetVersion, ruleset } = {}) {
  const shipping = ruleset ?? (await getRuleset());
  const shippingVersion = shipping.rulesetVersion;
  const chainVersion = typeof chainRulesetVersion === 'string' && chainRulesetVersion.length > 0
    ? chainRulesetVersion
    : null;
  if (chainVersion === null) {
    return { drift: 'missing', shippingVersion, chainVersion };
  }
  if (chainVersion === shippingVersion) {
    return { drift: 'none', shippingVersion, chainVersion };
  }
  // v1 policy: any version mismatch is treated as behavioural drift for
  // the build stage refusal path (NV-BL-ADM-06). Additive-only drift
  // becomes distinguishable once the umbrella starts landing patch bumps
  // that only add rules; the classifier lives here so define-stage
  // warning (DL-REQ-VALIDATE-03) can consume it without duplicating logic.
  return { drift: 'behavioural', shippingVersion, chainVersion };
}

/**
 * Reset the module-scope cache. For tests that mutate the on-disk artefact
 * or the package version.
 */
export function resetRulesetCache() {
  cachedRuleset = null;
  cachedUmbrellaVersion = null;
}
