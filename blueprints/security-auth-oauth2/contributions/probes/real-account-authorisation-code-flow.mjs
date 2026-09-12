// Real-account authorisation-code-flow probe for security-auth-
// oauth2. Runs the RFC 6749 code flow with RFC 7636 PKCE against a
// real, commercial OAuth 2.0 authorisation server when the estate
// has one wired.
//
// This estate does NOT have a live commercial IdP available. The
// probe honest-skips when the gate variables are not set, and when
// credentials ARE supplied the probe explicitly reports that the
// live-provider branch is not yet implemented and returns a FAIL
// per rule (never a misleading pass).
//
// capability: authorisationCodeFlow.
// Anchor: AC-10110-2 (a live public-provider smoke
//   against a real IdP completes a full authorisation-code + PKCE
//   round-trip and issues a project session).
// accountBound: true.

import { DECLARED_ENV, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'security-auth-oauth2-AC-10110-2';
export const capability = 'authorisationCodeFlow';
export const accountBound = true;

const SECOND_TIER_VARS = ['OAUTH2_ISSUER_URL', 'OAUTH2_CLIENT_ID', 'OAUTH2_CLIENT_SECRET', 'OAUTH2_REDIRECT_URI'];

function gateResult(varName, value) {
  // Distinguishes unset from set-but-not-true per rule 4 of the master brief.
  if (value === undefined || value === '') {
    return { kind: 'unset', reason: varName };
  }
  if (value !== 'true') {
    return { kind: 'set-not-true', reason: `${varName}_SET_NOT_TRUE`, observedValue: value };
  }
  return { kind: 'true' };
}

export default async function runProbe() {
  const gate = gateResult('CI_HAS_OAUTH2_PROVIDER', process.env.CI_HAS_OAUTH2_PROVIDER);
  if (gate.kind === 'unset') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, capability, 'CI_HAS_OAUTH2_PROVIDER')],
      extra: {
        accountBoundSkipped: true,
        reason: 'CI_HAS_OAUTH2_PROVIDER',
        envDeclared: [...DECLARED_ENV],
        note: 'No live commercial OAuth 2.0 IdP is available in this estate. Local shipped-shape evidence is authorisation-code-flow-shape against the fixture mock. The live branch reads AMBER on criterion e until an IdP is wired.',
      },
    };
  }
  if (gate.kind === 'set-not-true') {
    return {
      results: [{
        anchorAcId, capability, verdict: 'fail',
        detail: `AC-10110-2 gate: CI_HAS_OAUTH2_PROVIDER is set to "${gate.observedValue}" (not the string "true"). Gate refuses this shape; set the variable to the exact string "true" to run the live branch.`,
        evidence: { gate: 'CI_HAS_OAUTH2_PROVIDER', observedValue: gate.observedValue, expected: 'true', status: 400 },
      }],
      extra: { gateMisconfigured: true, gate: 'CI_HAS_OAUTH2_PROVIDER', envDeclared: [...DECLARED_ENV] },
    };
  }

  // Second-tier variable check: one result row per unset variable
  // per rule 4 of the master brief.
  const unsetRows = [];
  for (const v of SECOND_TIER_VARS) {
    if (!process.env[v]) {
      unsetRows.push({
        anchorAcId, capability, verdict: 'pass', accountBoundSkipped: true, reason: v,
        detail: `accountBoundSkipped: ${v} unset. AC-10110-2 requires a live public provider; set ${v} to run the live branch.`,
      });
    }
  }
  if (unsetRows.length > 0) {
    return {
      results: unsetRows,
      extra: { accountBoundSkipped: true, unsetVars: unsetRows.map((r) => r.reason), envDeclared: [...DECLARED_ENV] },
    };
  }

  // Credentials present but the live branch is not implemented in
  // this estate. Return FAIL with an explicit named-not-implemented
  // detail (never a misleading pass).
  return {
    results: [{
      anchorAcId, capability, verdict: 'fail',
      detail: 'AC-10110-2 live branch is NOT IMPLEMENTED. Every gate variable is set, but the estate has no wired live commercial IdP and no round-trip code has been authored. Supplying credentials does not silently pass; the branch must be implemented before this result flips to pass. Local shipped-shape evidence is authorisation-code-flow-shape against the fixture mock; the live branch remains AMBER until an IdP is wired.',
    }],
    extra: {
      envDeclared: [...DECLARED_ENV],
      liveBranchImplemented: false,
      note: 'implement round-trip against OAUTH2_ISSUER_URL/OAUTH2_CLIENT_ID/OAUTH2_CLIENT_SECRET/OAUTH2_REDIRECT_URI here when a live IdP is added to the estate',
    },
  };
}
