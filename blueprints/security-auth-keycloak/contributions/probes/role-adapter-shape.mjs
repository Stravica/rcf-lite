// Keycloak role-adapter shape probe (TAC-1205). Combines
// realm_access.roles and resource_access.<clientId>.roles per the
// Keycloak token contract
// (https://www.keycloak.org/securing-apps/token-introspection-endpoint
// verifiedOn 2026-09-11) and refuses unknown role tokens.
//
// capability: roleModel.
// Anchors (per closure): AC-11107-1 (client-roles claim path
// lifts onto Principal.roles), AC-11107-2 (absent claim yields empty
// roles), AC-11107-3 (KEYCLOAK_ROLES_MALFORMED on non-array claim).
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = 'security-auth-keycloak-AC-11107-1';
export const capability = 'roleModel';
export const accountBound = false;

export default async function runProbe() {
  const { mapKeycloakRoles, knownRoles } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'role-adapter.mjs')).href);
  const results = [];

  // AC-11107-1: client-roles-only (a realm record with
  // roleClaimShape='client-roles' lifts resource_access.<clientId>.roles
  // onto Principal.roles; no realm-role merge). The fixture is
  // exercised with clientId + roleClaimShape='client-roles' and no
  // realm_access is consulted for this row.
  const clientOnly = mapKeycloakRoles({
    resource_access: { 'app-x': { roles: ['editor', 'admin'] } },
  }, { clientId: 'app-x', roleClaimShape: 'client-roles' });
  results.push({
    anchorAcId,
    capability,
    verdict: clientOnly.ok && JSON.stringify(clientOnly.roles) === JSON.stringify(['editor', 'admin']) && clientOnly.source && clientOnly.source.client === 2 && (clientOnly.source.realm ?? 0) === 0 ? 'pass' : 'fail',
    detail: `AC-11107-1 (client-roles path lifts resource_access.<clientId>.roles onto Principal.roles; no realm merge on this claim shape): ok=${clientOnly.ok} roles=${JSON.stringify(clientOnly.roles)} source=${JSON.stringify(clientOnly.source)}. Fixture-layer observation; AC-11107-1 requires a verified access token in a live-realm setting.`,
    evidence: { adapterReturn: clientOnly, knownRoles },
  });

  // AC-11107-2: absent claim path yields empty roles.
  const absentPath = mapKeycloakRoles({}, { clientId: 'app-x', roleClaimShape: 'client-roles' });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11107-2',
    capability,
    verdict: absentPath.ok && Array.isArray(absentPath.roles) && absentPath.roles.length === 0 ? 'pass' : 'fail',
    detail: `AC-11107-2 (absent claim path yields empty roles, not refusal): ok=${absentPath.ok} roles=${JSON.stringify(absentPath.roles)}. Fixture-layer observation.`,
    evidence: { adapterReturn: absentPath },
  });

  // AC-11107-3: NON-ARRAY claim path is refused with KEYCLOAK_ROLES_MALFORMED.
  const nonArray = mapKeycloakRoles({
    resource_access: { 'app-x': { roles: 'admin' } },
  }, { clientId: 'app-x', roleClaimShape: 'client-roles' });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11107-3',
    capability,
    verdict: !nonArray.ok && /KEYCLOAK_ROLES_MALFORMED|must be an array/i.test(nonArray.error) ? 'pass' : 'fail',
    detail: `AC-11107-3 (non-array claim path refused with KEYCLOAK_ROLES_MALFORMED): ok=${nonArray.ok} error=${JSON.stringify(nonArray.error)}. Fixture-layer observation.`,
    evidence: { adapterReturn: nonArray },
  });

  // REQ-006 supplementary check: unknown-role token refused (not an
  // AC-11107-3 property; refusal at the known-roles gate anchors REQ-006).
  const unknown = mapKeycloakRoles({
    resource_access: { 'app-x': { roles: ['viewer', 'root-emperor'] } },
  }, { clientId: 'app-x', roleClaimShape: 'client-roles' });
  results.push({
    anchorAcId: 'security-auth-keycloak-REQ-006',
    capability,
    verdict: !unknown.ok && /root-emperor/.test(unknown.error) ? 'pass' : 'fail',
    detail: `REQ-006 (no AC covers unknown-role refusal at the role adapter; anchoring REQ per closure rule 1). unknown-role refusal: ok=${unknown.ok} error=${JSON.stringify(unknown.error)}. Fixture-layer observation.`,
    evidence: { adapterReturn: unknown },
  });

  return { results, extra: {} };
}