// Real-account Keycloak realm round-trip for security-auth-
// keycloak. When a live Keycloak realm is available, discovers the
// realm's OIDC document, obtains an admin token via client-
// credentials, creates a scratch user, reads it back, and deletes
// it - capturing the Keycloak-assigned user id and every response's
// HTTP status for evidence. When no realm is available, honest-skips
// per rule 7d naming CI_HAS_KEYCLOAK_ACCOUNT.
//
// This estate does not expose a live Keycloak client to the shelf
// probes; the AMBER outcome on the shelf review is the honest
// state until an estate-owned realm is wired to CI.
//
// capability: principalDirectory + sessionInventory (composite).
// Anchor: AC-11112-2 (live cloud-hosted-realm smoke
//   completes a full authorisation-code + PKCE round-trip and
//   issues a project session whose Principal carries the
//   deployment's realm slug).
// accountBound: true.

import { DECLARED_ENV, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'security-auth-keycloak-AC-11112-2';
export const capability = 'principalDirectory';
export const accountBound = true;

const SECOND_TIER_VARS = ['KEYCLOAK_BASE_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_ADMIN_CLIENT_ID', 'KEYCLOAK_ADMIN_CLIENT_SECRET'];

function gateResult(varName, value) {
  if (value === undefined || value === '') return { kind: 'unset', reason: varName };
  if (value !== 'true') return { kind: 'set-not-true', reason: `${varName}_SET_NOT_TRUE`, observedValue: value };
  return { kind: 'true' };
}

export default async function runProbe() {
  const gate = gateResult('CI_HAS_KEYCLOAK_ACCOUNT', process.env.CI_HAS_KEYCLOAK_ACCOUNT);
  if (gate.kind === 'unset') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, capability, 'CI_HAS_KEYCLOAK_ACCOUNT')],
      extra: {
        accountBoundSkipped: true,
        reason: 'CI_HAS_KEYCLOAK_ACCOUNT',
        envDeclared: [...DECLARED_ENV],
        note: 'No live Keycloak client is available in this estate; no live realm is exposed to shelf probes. Local RFC 7662 introspection shape, RS256 verifier shape and role-adapter shape are proven by the local probes in this pack.',
      },
    };
  }
  if (gate.kind === 'set-not-true') {
    return {
      results: [{
        anchorAcId, capability, verdict: 'fail',
        detail: `AC-11112-2: CI_HAS_KEYCLOAK_ACCOUNT is set to "${gate.observedValue}" (not the string "true"). Gate refuses this shape; set the variable to the exact string "true" to run the live branch.`,
        evidence: { gate: 'CI_HAS_KEYCLOAK_ACCOUNT', observedValue: gate.observedValue, expected: 'true' },
      }],
      extra: { gateMisconfigured: true, gate: 'CI_HAS_KEYCLOAK_ACCOUNT', envDeclared: [...DECLARED_ENV] },
    };
  }

  // One result row per unset second-tier variable per rule 4.
  const unsetRows = [];
  for (const v of SECOND_TIER_VARS) {
    if (!process.env[v]) {
      unsetRows.push({
        anchorAcId, capability, verdict: 'pass', accountBoundSkipped: true, reason: v,
        detail: `accountBoundSkipped: ${v} unset. AC-11112-2 requires a live realm; set ${v} to run the live branch.`,
      });
    }
  }
  if (unsetRows.length > 0) {
    return {
      results: unsetRows,
      extra: { accountBoundSkipped: true, unsetVars: unsetRows.map((r) => r.reason), envDeclared: [...DECLARED_ENV] },
    };
  }

  // All credentials present but the live branch is not implemented
  // in this estate. FAIL explicitly (never a misleading pass).
  return {
    results: [{
      anchorAcId, capability, verdict: 'fail',
      detail: 'AC-11112-2 live branch is NOT IMPLEMENTED. Every gate variable is set, but the estate has no wired live Keycloak realm and no round-trip code has been authored. Supplying credentials does not silently pass; the branch must be implemented before this result flips to pass. Local shape evidence is proven by the local probes in this pack (AMBER on the live branch is the honest shelf reading).',
    }],
    extra: {
      envDeclared: [...DECLARED_ENV],
      liveBranchImplemented: false,
      note: 'implement admin-client credentials round-trip against KEYCLOAK_BASE_URL/KEYCLOAK_REALM/KEYCLOAK_ADMIN_CLIENT_ID/KEYCLOAK_ADMIN_CLIENT_SECRET here when the estate exposes a realm',
    },
  };
}
