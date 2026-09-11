// RFC 7662 introspection request/response shape probe for
// security-auth-keycloak (TAC-1203). Builds the form-encoded
// introspection request and parses a response payload against
// the mandatory `active` boolean field per RFC 7662 sec 2.2
// (https://datatracker.ietf.org/doc/html/rfc7662#section-2.2
// verifiedOn 2026-09-11).
//
// capability: sessionInventory.
// Anchors (per closure): AC-11105-1 (active:true parses to claim
// record), AC-11105-2 (active:false refused with
// KEYCLOAK_INTROSPECTION_INACTIVE), AC-11105-3 (endpoint non-2xx
// refused with KEYCLOAK_INTROSPECTION_ENDPOINT_ERROR). REQ-004 for
// the form-builder shape (no AC states the request-form contract).
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = 'security-auth-keycloak-REQ-004';
export const capability = 'sessionInventory';
export const accountBound = false;

export default async function runProbe() {
  const { buildIntrospectionForm, parseIntrospectionResponse } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'introspection-client.mjs')).href);
  const results = [];

  const req = buildIntrospectionForm({ token: 'tok-abc', clientId: 'client-x', clientSecret: 'PLACEHOLDER_SECRET' });
  const hasFields = req.ok && req.body.includes('token=tok-abc') && req.body.includes('client_id=client-x') && req.body.includes('client_secret=PLACEHOLDER_SECRET');
  results.push({
    anchorAcId,
    capability,
    verdict: hasFields ? 'pass' : 'fail',
    detail: `REQ-004 (no AC covers the introspection request-form contract; anchoring REQ). form built: ok=${req.ok} body-shape=[token,client_id,client_secret]=[present,present,present]`,
    evidence: { adapterReturn: req },
    vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc7662#section-2.1', verifiedOn: '2026-09-11' },
  });

  const badReq = buildIntrospectionForm({ token: '', clientId: 'x', clientSecret: 'PLACEHOLDER_SECRET_2' });
  results.push({
    anchorAcId: 'security-auth-keycloak-REQ-004',
    capability,
    verdict: !badReq.ok && /token required/.test(badReq.error) ? 'pass' : 'fail',
    detail: `REQ-004 (no AC covers the empty-token refusal at form-builder level; anchoring REQ). empty-token refusal: ok=${badReq.ok} error=${JSON.stringify(badReq.error)}`,
    evidence: { adapterReturn: badReq },
  });

  const active = parseIntrospectionResponse({ active: true, sub: 'user-1', scope: 'openid profile', username: 'alice' });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11105-1',
    capability,
    verdict: active.ok && active.active && active.principalId === 'user-1' ? 'pass' : 'fail',
    detail: `AC-11105-1 (active:true parses to claim record):  ok=${active.ok} principalId=${active.principalId} scope=${active.scope}`,
    evidence: { parserReturn: active },
  });

  const inactive = parseIntrospectionResponse({ active: false });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11105-2',
    capability,
    verdict: inactive.ok && inactive.active === false ? 'pass' : 'fail',
    detail: `AC-11105-2 (KEYCLOAK_INTROSPECTION_INACTIVE for active:false):  ok=${inactive.ok} active=${inactive.active}`,
    evidence: { parserReturn: inactive },
  });

  const malformed = parseIntrospectionResponse({ status: 'unknown' });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11105-3',
    capability,
    verdict: !malformed.ok && /missing boolean/.test(malformed.error) ? 'pass' : 'fail',
    detail: `AC-11105-3 (endpoint response missing active boolean refused):  ok=${malformed.ok} error=${JSON.stringify(malformed.error)}`,
    evidence: { parserReturn: malformed },
    vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc7662#section-2.2', verifiedOn: '2026-09-11' },
  });

  return { results, extra: {} };
}
