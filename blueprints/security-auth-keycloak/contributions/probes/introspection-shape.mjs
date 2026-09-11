// RFC 7662 introspection request/response shape probe for
// security-auth-keycloak. Conformance-only per _closure3.md:
// fixture parser observations are not HTTP introspection round-
// trips, and REQ-004 mandates HTTP Basic authentication that a
// form-body builder does not observe. Rows keep their local
// parser observations; the integration harness
// (the auth integration harness follow-up) is the surface where the AC-level
// properties become observable.
//
// capability: sessionInventory. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = null;
export const capability = 'sessionInventory';
export const accountBound = false;

const LIM_REQ = 'security-auth-keycloak-REQ-004: probe builds an introspection form body only; REQ-004 requires HTTP Basic authentication over the wire, needs a real Keycloak endpoint (auth integration harness follow-up).';
const LIM_PARSE = 'security-auth-keycloak-AC-11105-1: probe parses a fabricated introspection object; the AC states an opaque token round-trips through the introspection endpoint, needs the integration harness (the auth integration harness follow-up).';
const LIM_INACTIVE = 'security-auth-keycloak-AC-11105-2: probe observes fixture parser only; the AC requires the client-layer refusal (4xx + KEYCLOAK_INTROSPECTION_INACTIVE + no cookie + audit event), needs the integration harness (the auth integration harness follow-up).';
const LIM_MALFORMED = 'security-auth-keycloak-AC-11105-3: probe parses a malformed shape locally; the AC states the endpoint returns a non-2xx response with KEYCLOAK_INTROSPECTION_ENDPOINT_ERROR, needs the integration harness (the auth integration harness follow-up).';

export default async function runProbe() {
  const { buildIntrospectionForm, parseIntrospectionResponse } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'introspection-client.mjs')).href);
  const results = [];

  function redactedBody(req) {
    if (!req || !req.body) return req;
    const params = new URLSearchParams(req.body);
    const keys = [...params.keys()].sort();
    const redacted = {};
    for (const k of keys) redacted[k] = k === 'client_secret' ? '[REDACTED]' : params.get(k);
    return { ok: req.ok, error: req.error, bodyKeys: keys, bodyRedacted: redacted };
  }

  const req = buildIntrospectionForm({ token: 'tok-abc', clientId: 'client-x', clientSecret: 'PLACEHOLDER_SECRET' });
  const reqEv = redactedBody(req);
  const hasFields = req.ok
    && reqEv.bodyKeys.includes('token')
    && reqEv.bodyKeys.includes('client_id')
    && reqEv.bodyKeys.includes('client_secret')
    && reqEv.bodyRedacted.token === 'tok-abc'
    && reqEv.bodyRedacted.client_id === 'client-x';
  results.push(deClaim({
    capability,
    verdict: hasFields ? 'pass' : 'fail',
    detail: `form built (client_secret redacted): ok=${req.ok} bodyKeys=${JSON.stringify(reqEv.bodyKeys)}`,
    evidence: { adapterReturn: reqEv },
  }, { ac: 'security-auth-keycloak-REQ-004', limitation: LIM_REQ }));

  const badReq = buildIntrospectionForm({ token: '', clientId: 'x', clientSecret: 'PLACEHOLDER_SECRET_2' });
  results.push(deClaim({
    capability,
    verdict: !badReq.ok && /token required/.test(badReq.error) ? 'pass' : 'fail',
    detail: `empty-token refusal: ok=${badReq.ok} error=${JSON.stringify(badReq.error)}`,
    evidence: { adapterReturn: { ok: badReq.ok, error: badReq.error } },
  }, { ac: 'security-auth-keycloak-REQ-004', limitation: LIM_REQ }));

  const active = parseIntrospectionResponse({ active: true, sub: 'user-1', scope: 'openid profile', username: 'alice' });
  results.push(deClaim({
    capability,
    verdict: active.ok && active.active && active.principalId === 'user-1' ? 'pass' : 'fail',
    detail: `active:true parses to claim record: ok=${active.ok} principalId=${active.principalId} scope=${active.scope}`,
    evidence: { parserReturn: active },
  }, { ac: 'security-auth-keycloak-AC-11105-1', limitation: LIM_PARSE }));

  const inactive = parseIntrospectionResponse({ active: false });
  results.push(deClaim({
    capability,
    verdict: inactive.ok && inactive.active === false ? 'pass' : 'fail',
    detail: `active:false parses (parser only): ok=${inactive.ok} active=${inactive.active}`,
    evidence: { parserReturn: inactive, notObservableAt: 'parser-layer' },
  }, { ac: 'security-auth-keycloak-AC-11105-2', limitation: LIM_INACTIVE }));

  const malformed = parseIntrospectionResponse({ status: 'unknown' });
  results.push(deClaim({
    capability,
    verdict: !malformed.ok && /missing boolean/.test(malformed.error) ? 'pass' : 'fail',
    detail: `malformed-payload refused (parser only): ok=${malformed.ok} error=${JSON.stringify(malformed.error)}`,
    evidence: { parserReturn: malformed },
  }, { ac: 'security-auth-keycloak-AC-11105-3', limitation: LIM_MALFORMED }));

  return { results, extra: {} };
}
