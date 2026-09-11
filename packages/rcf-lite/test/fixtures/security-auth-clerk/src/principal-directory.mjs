// In-memory principal directory adapter for the security-auth-clerk
// fixture. Mirrors the shape of the Clerk Backend API's users
// resource (POST /v1/users, GET /v1/users, GET /v1/users/{id},
// DELETE /v1/users/{id}) at the adapter boundary so local probes
// exercise the same call graph that the live probe drives against
// Clerk. The adapter does NOT emit Clerk request ids; live evidence
// is produced by real-account-principal-directory-round-trip.mjs.

export function createPrincipalDirectory() {
  const users = new Map();
  let seq = 0;
  return {
    async create({ emailAddress, publicMetadata }) {
      const id = `user_local_${++seq}`;
      const record = {
        id,
        emailAddress,
        publicMetadata: publicMetadata ?? {},
        createdAt: new Date().toISOString(),
      };
      users.set(id, record);
      return record;
    },
    async get(id) {
      return users.get(id) ?? null;
    },
    async list() {
      return Array.from(users.values());
    },
    async delete(id) {
      const existed = users.delete(id);
      return { deleted: existed, id };
    },
  };
}
