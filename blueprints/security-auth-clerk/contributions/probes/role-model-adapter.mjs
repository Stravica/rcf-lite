// Role-model adapter probe for security-auth-clerk. Exercises the
// TAC-1002 authorisation adapter contract: a Clerk user's
// publicMetadata.roles claim maps to an application role set, with
// unknown role tokens refused.
//
// capability: roleModel (blueprint.json declared capability).
// Anchor (per closure): no AC covers the raw-role-to-project-role
// reduction the fixture mapRoles performs; anchoring REQ-004
// (Authorisation adapter maps Clerk claims onto project verbs),
// per closure rule 1.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-clerk', 'src');

export const anchorAcId = 'security-auth-clerk-REQ-004';
export const capability = 'roleModel';
export const accountBound = false;

export default async function runProbe() {
  const { mapRoles, knownRoles } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'role-adapter.mjs')).href);

  const results = [];

  // Happy path: known roles pass through.
  const good = mapRoles({ roles: ['viewer', 'admin'] });
  results.push({
    anchorAcId,
    capability,
    verdict: good.ok && good.roles.join(',') === 'viewer,admin' ? 'pass' : 'fail',
    detail: `REQ-004 (no AC covers raw-role reduction; anchoring REQ). known-role mapping: ok=${good.ok} roles=${JSON.stringify(good.roles)}; knownRoles=${JSON.stringify(knownRoles)}`,
    evidence: { input: ['viewer', 'admin'], output: good.roles, adapterReturn: good },
  });

  // Refusal path: unknown role token refused with error naming the token.
  const bad = mapRoles({ roles: ['viewer', 'root-emperor'] });
  results.push({
    anchorAcId: 'security-auth-clerk-REQ-004',
    capability,
    verdict: !bad.ok && /root-emperor/.test(bad.error) ? 'pass' : 'fail',
    detail: `REQ-004 (no AC covers unknown-role refusal at reduction; anchoring REQ). unknown-role refusal: ok=${bad.ok} error=${JSON.stringify(bad.error)}`,
    evidence: { input: ['viewer', 'root-emperor'], adapterReturn: bad },
  });

  // Refusal path: non-array publicMetadata.roles refused.
  const bad2 = mapRoles({ roles: 'admin' });
  results.push({
    anchorAcId: 'security-auth-clerk-REQ-004',
    capability,
    verdict: !bad2.ok && /must be an array/.test(bad2.error) ? 'pass' : 'fail',
    detail: `REQ-004 (no AC covers non-array refusal at reduction; anchoring REQ). non-array-refusal: ok=${bad2.ok} error=${JSON.stringify(bad2.error)}`,
    evidence: { input: 'admin', adapterReturn: bad2 },
  });

  return { results, extra: {} };
}
