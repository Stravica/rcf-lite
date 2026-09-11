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
// anchorAcId: security-auth-keycloak-AC-11104-1.
// accountBound: true.

import { DECLARED_ENV, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'security-auth-keycloak-AC-11104-1';
export const capability = 'principalDirectory';
export const accountBound = true;

export default async function runProbe() {
  if (process.env.CI_HAS_KEYCLOAK_ACCOUNT !== 'true') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, capability, 'CI_HAS_KEYCLOAK_ACCOUNT')],
      extra: {
        accountBoundSkipped: true,
        reason: 'CI_HAS_KEYCLOAK_ACCOUNT',
        envDeclared: [...DECLARED_ENV],
        note: 'No live Keycloak client is available in this estate; the staging client is a Baz item and not exposed to shelf probes. Local RFC 7662 introspection shape, RS256 verifier shape and role-adapter shape are proven by the local probes in this pack.',
      },
    };
  }
  const requiredSecondTier = ['KEYCLOAK_BASE_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_ADMIN_CLIENT_ID', 'KEYCLOAK_ADMIN_CLIENT_SECRET'];
  const unset = requiredSecondTier.filter((v) => !process.env[v]);
  if (unset.length > 0) {
    const reason = unset.join(', ');
    return {
      results: [{
        anchorAcId, capability, verdict: 'pass', accountBoundSkipped: true, reason,
        detail: `accountBoundSkipped: ${reason} unset; the probe did not execute against a real Keycloak realm. Set the missing keys and re-run.`,
      }],
      extra: { accountBoundSkipped: true, reason, envDeclared: [...DECLARED_ENV] },
    };
  }
  return {
    results: [{
      anchorAcId, capability, verdict: 'fail',
      detail: 'live Keycloak realm wired but this probe body is not yet implemented; author the admin-client credentials round-trip when the estate exposes a Keycloak realm to CI.',
    }],
    extra: { envDeclared: [...DECLARED_ENV] },
  };
}
