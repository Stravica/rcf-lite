# Verb-to-role mapping sample

A worked example of the project-authored mapping table the authorisation adapter (TAC-1002) consumes, plus a worked example of the claims-mapper reduction (TAC-1004) that turns Clerk's raw claim shape into the `Principal.roles` and `Principal.organisationIds` the adapter reasons against.

## The mapping table

The mapping table is a project-authored module the adapter loads once at construction. Verbs are project vocabulary; roles are the strings Clerk propagates. A verb absent from the table evaluates to `false` on `can` and throws on `assert`.

```
// src/authz/mapping-table.ts
export const mappingTable = {
  // Editorial workflow
  'article.read':   { roles: ['reader', 'editor', 'admin'] },
  'article.edit':   { roles: ['editor', 'admin'] },
  'article.delete': { roles: ['admin'] },

  // Billing surface
  'billing.invoice.view': { roles: ['billing', 'admin'] },
  'billing.invoice.void': { roles: ['admin'] },

  // Admin dashboard
  'admin.dashboard.view':  { roles: ['admin'] },
  'admin.users.view':      { roles: ['admin'] },
  'admin.users.impersonate': { roles: ['admin'] },
};
```

## The claims-mapper reduction

The claims mapper reads a raw Clerk claim bag (as returned by the session verifier on success) and produces the `Principal` the adapter reasons against. The `CLERK_CLAIM_KEYS` constant is the one place in the module that hard-codes Clerk-side claim key strings; a Clerk-side rename is a one-file change here.

```
// src/auth/claims-mapper.ts
const CLERK_CLAIM_KEYS = {
  userId: 'sub',                     // Clerk emits the user id on the JWT-standard sub claim
  organisationMemberships: 'org_memberships',
  organisationId: 'org_id',
  organisationRole: 'org_role',
  publicMetadata: 'public_metadata',
  // Adjust these values against Clerk's currently-canonical claim vocabulary at
  // the SDK version the project builds against.
};

export function reduceClaims(rawClaims) {
  const principalId = rawClaims?.[CLERK_CLAIM_KEYS.userId];
  if (!principalId || typeof principalId !== 'string') {
    const err = new Error('PRINCIPAL_REDUCTION_FAILED: missing or invalid user id claim');
    err.code = 'PRINCIPAL_REDUCTION_FAILED';
    throw err;
  }

  const orgMemberships = rawClaims[CLERK_CLAIM_KEYS.organisationMemberships] ?? [];
  const organisationIds = orgMemberships.map((m) => m[CLERK_CLAIM_KEYS.organisationId]);
  const orgRoles = orgMemberships.map((m) => m[CLERK_CLAIM_KEYS.organisationRole]);

  // Global roles (from publicMetadata.roles by convention) plus per-org roles
  // flatten into one bare-string roles array; the set membership is what the
  // adapter reasons against.
  const globalRoles = rawClaims?.[CLERK_CLAIM_KEYS.publicMetadata]?.roles ?? [];
  const roles = Array.from(new Set([...globalRoles, ...orgRoles]));

  return {
    principalId,
    roles,
    organisationIds,
    claims: rawClaims,
  };
}
```

## Downstream code speaks in verbs

```
// src/handlers/article-edit.ts
import { assert } from '../authz/adapter';

export async function handleArticleEdit(request, response) {
  assert(request.auth, 'article.edit', { organisationId: request.body.organisationId });
  // If assert did not throw, the caller is allowed.
  // Proceed with the edit.
}
```

Never:

```
// ANTI-PATTERN: bypasses the adapter, reads Clerk vocabulary in a handler.
if (request.auth.roles.includes('editor') || request.auth.roles.includes('admin')) {
  // ...
}
```

The scan on AC-9104-3 catches the anti-pattern; the discipline is that every check goes through `can` or `assert`.

## Notes

- The mapping table is small enough at project boot that adding a verb is a one-line edit; a project whose table grows past a hundred verbs is signal to consolidate at a coarser verb grain, not to bypass the adapter.
- The organisation-scoping subject shape (`{ organisationId }` on the second argument of `assert`) is the blueprint's default. Projects that need finer subject shapes (record-owner predicates, hierarchical org trees) layer them above the adapter's return value rather than replacing the adapter.
- The `publicMetadata.roles` convention above is one of several ways to propagate global roles from Clerk into the session; the specific convention is a Clerk-configuration choice the operator makes on the Clerk dashboard, and the claims mapper adjusts accordingly.
