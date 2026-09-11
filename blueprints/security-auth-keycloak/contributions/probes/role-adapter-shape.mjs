// Keycloak role-adapter shape probe. Conformance-only per
// _closure3.md: raw claim objects are not verified tokens, and
// REQ-006 explicitly says roles are not remapped to a project
// allow-list. Rows keep their fixture-adapter observations;
// integration harness (the auth integration harness follow-up) is the surface
// where the AC-level properties become observable.
//
// capability: roleModel. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = null;
export const capability = 'roleModel';
export const accountBound = false;

const LIM_CLIENT = 'security-auth-keycloak-AC-11107-1: probe receives a raw claim object, not a verified access token; the AC requires the client-roles path from a verified session, needs the integration harness (the auth integration harness follow-up).';
const LIM_ABSENT = 'security-auth-keycloak-AC-11107-2: probe receives an empty raw claim object; the AC requires absent-claim behaviour on a verified session, needs the integration harness (the auth integration harness follow-up).';
const LIM_MALFORMED = 'security-auth-keycloak-AC-11107-3: probe receives a raw claim object; the AC requires the malformed-claim refusal path on a verified session, needs the integration harness (the auth integration harness follow-up).';
const LIM_REQ006 = 'security-auth-keycloak-REQ-006: REQ-006 explicitly says roles are NOT remapped to a project allow-list; unknown-role refusal here is a fixture adapter behaviour outside the REQ.';

export default async function runProbe() {
  const { mapKeycloakRoles, knownRoles } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'role-adapter.mjs')).href);
  const results = [];

  const clientOnly = mapKeycloakRoles({
    resource_access: { 'app-x': { roles: ['editor', 'admin'] } },
  }, { clientId: 'app-x', roleClaimShape: 'client-roles' });
  results.push(deClaim({
    capability,
    verdict: clientOnly.ok && JSON.stringify(clientOnly.roles) === JSON.stringify(['editor', 'admin']) && clientOnly.source && clientOnly.source.client === 2 && (clientOnly.source.realm ?? 0) === 0 ? 'pass' : 'fail',
    detail: `client-roles claim path lifts resource_access.<clientId>.roles: ok=${clientOnly.ok} roles=${JSON.stringify(clientOnly.roles)} source=${JSON.stringify(clientOnly.source)}`,
    evidence: { adapterReturn: clientOnly, knownRoles },
  }, { ac: 'security-auth-keycloak-AC-11107-1', limitation: LIM_CLIENT }));

  const absentPath = mapKeycloakRoles({}, { clientId: 'app-x', roleClaimShape: 'client-roles' });
  results.push(deClaim({
    capability,
    verdict: absentPath.ok && Array.isArray(absentPath.roles) && absentPath.roles.length === 0 ? 'pass' : 'fail',
    detail: `absent-claim yields empty roles: ok=${absentPath.ok} roles=${JSON.stringify(absentPath.roles)}`,
    evidence: { adapterReturn: absentPath },
  }, { ac: 'security-auth-keycloak-AC-11107-2', limitation: LIM_ABSENT }));

  const nonArray = mapKeycloakRoles({
    resource_access: { 'app-x': { roles: 'admin' } },
  }, { clientId: 'app-x', roleClaimShape: 'client-roles' });
  results.push(deClaim({
    capability,
    verdict: !nonArray.ok && /KEYCLOAK_ROLES_MALFORMED|must be an array/i.test(nonArray.error) ? 'pass' : 'fail',
    detail: `non-array claim refused: ok=${nonArray.ok} error=${JSON.stringify(nonArray.error)}`,
    evidence: { adapterReturn: nonArray },
  }, { ac: 'security-auth-keycloak-AC-11107-3', limitation: LIM_MALFORMED }));

  const unknown = mapKeycloakRoles({
    resource_access: { 'app-x': { roles: ['viewer', 'root-emperor'] } },
  }, { clientId: 'app-x', roleClaimShape: 'client-roles' });
  results.push(deClaim({
    capability,
    verdict: !unknown.ok && /root-emperor/.test(unknown.error) ? 'pass' : 'fail',
    detail: `unknown-role refusal (fixture adapter): ok=${unknown.ok} error=${JSON.stringify(unknown.error)}`,
    evidence: { adapterReturn: unknown },
  }, { ac: 'security-auth-keycloak-REQ-006', limitation: LIM_REQ006 }));

  return { results, extra: {} };
}
