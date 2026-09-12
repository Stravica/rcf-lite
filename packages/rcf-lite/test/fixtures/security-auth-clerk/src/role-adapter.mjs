// Role adapter for the security-auth-clerk fixture. Maps a Clerk
// user's publicMetadata.roles claim to an application role set,
// carrying the role-model shape from TAC-1002 (authorisation
// adapter). Refuses unknown roles.

const KNOWN_ROLES = Object.freeze(['viewer', 'editor', 'admin']);

export function mapRoles(publicMetadata) {
  const raw = (publicMetadata && publicMetadata.roles) || [];
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'publicMetadata.roles must be an array' };
  }
  const unknown = raw.filter((r) => !KNOWN_ROLES.includes(r));
  if (unknown.length > 0) {
    return { ok: false, error: `unknown roles: ${unknown.join(',')}` };
  }
  return { ok: true, roles: raw };
}

export const knownRoles = KNOWN_ROLES;
