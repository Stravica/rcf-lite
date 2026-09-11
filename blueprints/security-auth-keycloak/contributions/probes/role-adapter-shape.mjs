// Keycloak role-adapter shape probe (TAC-1205). Combines
// realm_access.roles and resource_access.<clientId>.roles per the
// Keycloak token contract
// (https://www.keycloak.org/securing-apps/token-introspection-endpoint
// verifiedOn 2026-09-11) and refuses unknown role tokens.
//
// capability: roleModel.
// anchorAcId: security-auth-keycloak-AC-11105-1.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = 'security-auth-keycloak-AC-11105-1';
export const capability = 'roleModel';
export const accountBound = false;

export default async function runProbe() {
  const { mapKeycloakRoles, knownRoles } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'role-adapter.mjs')).href);
  const results = [];

  const both = mapKeycloakRoles({
    realm_access: { roles: ['viewer'] },
    resource_access: { 'app-x': { roles: ['editor', 'admin'] } },
  }, { clientId: 'app-x' });
  results.push({
    anchorAcId,
    capability,
    verdict: both.ok && both.roles.length === 3 && both.source.realm === 1 && both.source.client === 2 ? 'pass' : 'fail',
    detail: `role-map both realm+client: ok=${both.ok} roles=${JSON.stringify(both.roles)} source=${JSON.stringify(both.source)}`,
    evidence: { adapterReturn: both, knownRoles },
  });

  const realmOnly = mapKeycloakRoles({ realm_access: { roles: ['viewer'] } });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11105-2',
    capability,
    verdict: realmOnly.ok && realmOnly.roles.length === 1 ? 'pass' : 'fail',
    detail: `role-map realm-only: ok=${realmOnly.ok} roles=${JSON.stringify(realmOnly.roles)}`,
    evidence: { adapterReturn: realmOnly },
  });

  const unknown = mapKeycloakRoles({ realm_access: { roles: ['viewer', 'root-emperor'] } });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11105-3',
    capability,
    verdict: !unknown.ok && /root-emperor/.test(unknown.error) ? 'pass' : 'fail',
    detail: `role-map unknown refusal: ok=${unknown.ok} error=${JSON.stringify(unknown.error)}`,
    evidence: { adapterReturn: unknown },
  });

  return { results, extra: {} };
}
