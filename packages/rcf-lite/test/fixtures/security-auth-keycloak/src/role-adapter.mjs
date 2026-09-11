// TAC-1205 Keycloak role adapter shape. Maps Keycloak's realm-role
// and per-client role claim shapes onto the reduced Principal's
// roles per the realm record's `roleClaimShape` field
// (AC-11107-1 / AC-11107-2 / AC-11107-3, story-11107). Unknown role
// strings are refused with a `KEYCLOAK_ROLES_MALFORMED`-shaped
// stable error. Non-array claim paths are refused.
//
// Keycloak claim shapes: realm-wide roles under `realm_access.roles`
// and per-client roles under `resource_access.<clientId>.roles`
// (Keycloak docs
// https://www.keycloak.org/securing-apps/token-introspection-endpoint
// verifiedOn 2026-09-11).

const KNOWN_ROLES = Object.freeze(['viewer', 'editor', 'admin']);

function refuseMalformed(msg) {
  return { ok: false, error: `KEYCLOAK_ROLES_MALFORMED: ${msg}` };
}

export function mapKeycloakRoles(claims, { clientId, roleClaimShape } = {}) {
  // Legacy call sites (no options) default to the realm-roles-only
  // shape so the fixture stays back-compatible.
  const shape = roleClaimShape || (clientId ? 'both-roles' : 'realm-roles');
  const realmRoles = claims && claims.realm_access ? claims.realm_access.roles : undefined;
  const clientRolesContainer = claims && claims.resource_access && clientId ? claims.resource_access[clientId] : undefined;
  const clientRoles = clientRolesContainer ? clientRolesContainer.roles : undefined;

  const pick = { realm: [], client: [] };
  if (shape === 'client-roles') {
    if (clientRoles === undefined) return { ok: true, roles: [], source: { realm: 0, client: 0 } };
    if (!Array.isArray(clientRoles)) return refuseMalformed(`resource_access.${clientId}.roles must be an array; observed ${typeof clientRoles}`);
    pick.client = clientRoles;
  } else if (shape === 'realm-roles') {
    if (realmRoles === undefined) return { ok: true, roles: [], source: { realm: 0, client: 0 } };
    if (!Array.isArray(realmRoles)) return refuseMalformed(`realm_access.roles must be an array; observed ${typeof realmRoles}`);
    pick.realm = realmRoles;
  } else if (shape === 'both-roles') {
    // Legacy shape retained for callers that combine realm + client.
    if (realmRoles !== undefined) {
      if (!Array.isArray(realmRoles)) return refuseMalformed(`realm_access.roles must be an array; observed ${typeof realmRoles}`);
      pick.realm = realmRoles;
    }
    if (clientRoles !== undefined) {
      if (!Array.isArray(clientRoles)) return refuseMalformed(`resource_access.${clientId}.roles must be an array; observed ${typeof clientRoles}`);
      pick.client = clientRoles;
    }
  } else {
    return { ok: false, error: `unknown roleClaimShape: ${shape}` };
  }
  const combined = [...pick.realm, ...pick.client];
  const unknown = combined.filter((r) => !KNOWN_ROLES.includes(r));
  if (unknown.length > 0) return { ok: false, error: `unknown roles: ${unknown.join(',')}` };
  return { ok: true, roles: combined, source: { realm: pick.realm.length, client: pick.client.length } };
}
export const knownRoles = KNOWN_ROLES;
