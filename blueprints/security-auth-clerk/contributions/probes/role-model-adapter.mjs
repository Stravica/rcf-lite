// Role-model adapter probe for security-auth-clerk.
// Conformance-only. Every row records anchorAcId=null with a
// limitation naming the shipped AC whose can/assert project-verb
// adapter behaviour the fixture-layer probe does not observe. The
// integration harness follow-up exercises the adapter against a
// verified session token.
//
// capability: roleModel. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-clerk', 'src');

export const anchorAcId = null;
export const capability = 'roleModel';
export const accountBound = false;

const LIM = 'security-auth-clerk-AC-9107-1: probe checks raw-role reduction only; the AC states the can/assert adapter refuses a role token absent from the project verb list against a verified session, which needs the integration harness (the auth integration harness follow-up).';

export default async function runProbe() {
  const { mapRoles, knownRoles } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'role-adapter.mjs')).href);
  const results = [];

  const good = mapRoles({ roles: ['viewer', 'admin'] });
  results.push(deClaim({
    capability,
    verdict: good.ok && good.roles.join(',') === 'viewer,admin' ? 'pass' : 'fail',
    detail: `known-role mapping: ok=${good.ok} roles=${JSON.stringify(good.roles)}; knownRoles=${JSON.stringify(knownRoles)}`,
    evidence: { input: ['viewer', 'admin'], output: good.roles, adapterReturn: good },
  }, { ac: 'security-auth-clerk-AC-9107-1', limitation: LIM }));

  const bad = mapRoles({ roles: ['viewer', 'root-emperor'] });
  results.push(deClaim({
    capability,
    verdict: !bad.ok && /root-emperor/.test(bad.error) ? 'pass' : 'fail',
    detail: `unknown-role refusal: ok=${bad.ok} error=${JSON.stringify(bad.error)}`,
    evidence: { input: ['viewer', 'root-emperor'], adapterReturn: bad },
  }, { ac: 'security-auth-clerk-AC-9107-1', limitation: LIM }));

  const bad2 = mapRoles({ roles: 'admin' });
  results.push(deClaim({
    capability,
    verdict: !bad2.ok && /must be an array/.test(bad2.error) ? 'pass' : 'fail',
    detail: `non-array-refusal: ok=${bad2.ok} error=${JSON.stringify(bad2.error)}`,
    evidence: { input: 'admin', adapterReturn: bad2 },
  }, { ac: 'security-auth-clerk-AC-9107-1', limitation: LIM }));

  return { results, extra: {} };
}
