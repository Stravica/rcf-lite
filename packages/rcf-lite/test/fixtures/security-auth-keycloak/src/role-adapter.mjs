// TAC-1205 Keycloak role adapter shape. Maps Keycloak's
// realm_access.roles and resource_access.<clientId>.roles claim
// shape (Keycloak docs
// https://www.keycloak.org/securing-apps/token-introspection-endpoint
// verifiedOn 2026-09-11) to the app's role set. Unknown roles
// are refused per the shipped role-model posture.

const KNOWN_ROLES = Object.freeze(['viewer', 'editor', 'admin']);

export function mapKeycloakRoles(claims, { clientId } = {}) {
  const realmRoles = claims?.realm_access?.roles ?? [];
  const clientRoles = (clientId && claims?.resource_access?.[clientId]?.roles) || [];
  const combined = [...realmRoles, ...clientRoles];
  const unknown = combined.filter((r) => !KNOWN_ROLES.includes(r));
  if (unknown.length > 0) return { ok: false, error: `unknown roles: ${unknown.join(',')}` };
  return { ok: true, roles: combined, source: { realm: realmRoles.length, client: clientRoles.length } };
}
export const knownRoles = KNOWN_ROLES;
