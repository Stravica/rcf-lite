// Role-model adapter probe for security-auth-clerk. Exercises the
// TAC-1002 authorisation adapter contract: a Clerk user's
// publicMetadata.roles claim maps to an application role set, with
// unknown role tokens refused.
//
// capability: roleModel (blueprint.json declared capability).
// anchorAcId: security-auth-clerk-AC-9102-1 (roleModel contract).
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-clerk', 'src');

export const anchorAcId = 'security-auth-clerk-AC-9102-1';
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
    detail: `known-role mapping: ok=${good.ok} roles=${JSON.stringify(good.roles)}; knownRoles=${JSON.stringify(knownRoles)}`,
    evidence: { input: ['viewer', 'admin'], output: good.roles, adapterReturn: good },
  });

  // Refusal path: unknown role token refused with error naming the token.
  const bad = mapRoles({ roles: ['viewer', 'root-emperor'] });
  results.push({
    anchorAcId: 'security-auth-clerk-AC-9102-2',
    capability,
    verdict: !bad.ok && /root-emperor/.test(bad.error) ? 'pass' : 'fail',
    detail: `unknown-role refusal: ok=${bad.ok} error=${JSON.stringify(bad.error)}`,
    evidence: { input: ['viewer', 'root-emperor'], adapterReturn: bad },
  });

  // Refusal path: non-array publicMetadata.roles refused.
  const bad2 = mapRoles({ roles: 'admin' });
  results.push({
    anchorAcId: 'security-auth-clerk-AC-9102-3',
    capability,
    verdict: !bad2.ok && /must be an array/.test(bad2.error) ? 'pass' : 'fail',
    detail: `non-array-refusal: ok=${bad2.ok} error=${JSON.stringify(bad2.error)}`,
    evidence: { input: 'admin', adapterReturn: bad2 },
  });

  return { results, extra: {} };
}
