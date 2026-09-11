// Local wire-shape probe for the security-auth-oauth2 authorisation
// code flow. Boots the fixture's local mock authorisation server
// (a hand-rolled RFC 6749 / RFC 7636 stub) on a port in the security
// family's declared 47400-47449 range and drives the full code flow
// against it end to end.
//
// Conformance-only per _closure3.md. The mock is a fixture, not the
// OAuth2 engine (per closure addendum rule 2). Rows /authorize,
// /token, /callback-check and PKCE-mismatch keep their observations
// but the AC anchors drop to null and each row records a limitation
// naming the AC that IS observable only in the integration harness
// (w-2026-09-11-dave-015). preExchange is now OBSERVED from the
// mock's requestNo record ordering (callback runs before /token
// only if the token exchange has not consumed the code yet), not
// asserted as a constant.
//
// capability: authorisationCodeFlow. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { MOCK_PORT_RANGE, deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = null;
export const capability = 'authorisationCodeFlow';
export const accountBound = false;

const LIM_AUTHZ = 'security-auth-oauth2-AC-10101-1: probe calls /authorize on a local mock; the AC states the project sign-in route drives a live IdP through a real browser, needs the integration harness (w-2026-09-11-dave-015).';
const LIM_TOKEN = 'security-auth-oauth2-AC-10101-2: probe calls /token on a local mock; the AC states the project session issues on a real IdP exchange, needs the integration harness (w-2026-09-11-dave-015).';
const LIM_REPLAY = 'security-auth-oauth2-AC-10102-2: probe observes the mock callback-tier refusing a consumed code; the AC states the project callback controller refuses without issuing a session, needs the integration harness (w-2026-09-11-dave-015).';
const LIM_PKCE = 'security-auth-oauth2-AC-10103-2: probe observes the mock /token refusing a tampered verifier; the AC states the project sign-in flow terminates without issuing a session, needs the integration harness (w-2026-09-11-dave-015).';

function pickPort() {
  const override = Number(process.env.OAUTH2_MOCK_PORT);
  if (Number.isFinite(override) && override >= MOCK_PORT_RANGE.min && override <= MOCK_PORT_RANGE.max) return override;
  return MOCK_PORT_RANGE.min + Math.floor(Math.random() * (MOCK_PORT_RANGE.max - MOCK_PORT_RANGE.min + 1));
}

function freshState() {
  return `st_${randomBytes(12).toString('base64url')}`;
}

export default async function runProbe() {
  const { createMockAuthServer, generatePkcePair } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'mock-authorization-server.mjs')).href);
  const port = pickPort();
  const clientId = 'mock-client';
  const redirectUri = 'http://127.0.0.1:47499/callback';
  const server = createMockAuthServer({ port, clientId, redirectUri, oidc: true });
  const evidence = { port, clientId, redirectUri, oidc: true, calls: [], observedStates: [] };
  const results = [];
  let teardownFailed = false;

  try {
    await server.start();
    const pkce = generatePkcePair();

    // 1. /authorize
    const state1 = freshState();
    evidence.observedStates.push(state1);
    const authUrl = new URL(`http://127.0.0.1:${port}/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state1);
    authUrl.searchParams.set('nonce', `n_${randomBytes(8).toString('base64url')}`);
    const authRes = await fetch(authUrl, { redirect: 'manual' });
    const authRequestId = authRes.headers.get('x-mock-request-id');
    const authText = await authRes.text();
    let authPayload = null; try { authPayload = JSON.parse(authText); } catch {}
    const codeFromRes = authPayload && authPayload.code;
    evidence.calls.push({ verb: 'GET /authorize (1)', status: authRes.status, requestId: authRequestId, resourceId: codeFromRes, state: state1 });

    if (!(authRes.status === 302 && codeFromRes)) {
      results.push(deClaim({
        capability, verdict: 'fail',
        detail: `/authorize failed: status=${authRes.status} requestId=${authRequestId} bodyExcerpt=${authText.slice(0, 200)}`,
        evidence: { requestId: authRequestId, status: authRes.status, bodyExcerpt: authText.slice(0, 200) },
      }, { ac: 'security-auth-oauth2-AC-10101-1', limitation: LIM_AUTHZ }));
      return { results, extra: evidence };
    }
    results.push(deClaim({
      capability,
      verdict: 'pass',
      detail: `/authorize redirected with S256 code_challenge and distinct state; status=${authRes.status} requestId=${authRequestId} state=${state1}`,
      evidence: { requestId: authRequestId, status: authRes.status, state: state1, codeIssued: codeFromRes, codeChallengeMethod: 'S256' },
    }, { ac: 'security-auth-oauth2-AC-10101-1', limitation: LIM_AUTHZ }));

    // 2. /callback-check BEFORE any /token exchange — preExchange observed
    // from the mock's consumedCodes record: if the code is not yet in
    // consumedCodes, the callback runs pre-exchange.
    const preCallbackUrl = new URL(`http://127.0.0.1:${port}/callback-check`);
    preCallbackUrl.searchParams.set('code', codeFromRes);
    preCallbackUrl.searchParams.set('state', state1);
    const preCallbackRes = await fetch(preCallbackUrl);
    const preCallbackRequestId = preCallbackRes.headers.get('x-mock-request-id');
    const preCallbackText = await preCallbackRes.text();
    let preCallbackPayload = null; try { preCallbackPayload = JSON.parse(preCallbackText); } catch {}
    const preExchangeObservedTokenCallsAtCallback = server.tokenCallCount;
    evidence.calls.push({
      verb: 'GET /callback-check (pre-token, fresh code)',
      status: preCallbackRes.status, requestId: preCallbackRequestId,
      body: preCallbackPayload,
      observedTokenCallsAtThisPoint: preExchangeObservedTokenCallsAtCallback,
    });

    // 3. /token
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: codeFromRes,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: pkce.verifier,
    });
    const tokenRes = await fetch(`http://127.0.0.1:${port}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody.toString(),
    });
    const tokenRequestId = tokenRes.headers.get('x-mock-request-id');
    const tokenText = await tokenRes.text();
    let tokenPayload = null; try { tokenPayload = JSON.parse(tokenText); } catch {}
    const idTokenShape = tokenPayload && typeof tokenPayload.id_token === 'string'
      && tokenPayload.id_token.split('.').length === 3;
    evidence.calls.push({
      verb: 'POST /token (valid, OIDC)',
      status: tokenRes.status,
      requestId: tokenRequestId,
      accessTokenPresent: Boolean(tokenPayload && tokenPayload.access_token),
      idTokenPresent: Boolean(tokenPayload && tokenPayload.id_token),
      idTokenSegments: tokenPayload && tokenPayload.id_token ? tokenPayload.id_token.split('.').length : 0,
      tokenType: tokenPayload && tokenPayload.token_type,
    });
    const tokenOk = tokenRes.status === 200
      && tokenPayload
      && typeof tokenPayload.access_token === 'string'
      && tokenPayload.token_type === 'Bearer'
      && idTokenShape;
    results.push(deClaim({
      capability,
      verdict: tokenOk ? 'pass' : 'fail',
      detail: tokenOk
        ? `/token returned access_token AND id_token: status=200 requestId=${tokenRequestId} segments=3`
        : `/token failure: status=${tokenRes.status} requestId=${tokenRequestId}`,
      evidence: {
        requestId: tokenRequestId,
        status: tokenRes.status,
        accessTokenPresent: Boolean(tokenPayload && tokenPayload.access_token),
        idTokenPresent: Boolean(tokenPayload && tokenPayload.id_token),
        idTokenSegments: tokenPayload && tokenPayload.id_token ? tokenPayload.id_token.split('.').length : 0,
        tokenType: tokenPayload && tokenPayload.token_type,
      },
    }, { ac: 'security-auth-oauth2-AC-10101-2', limitation: LIM_TOKEN }));

    // 4. /callback-check AFTER /token — code now in consumedCodes.
    // The refusal is observed from the mock's records; preExchange
    // for THIS second callback is false (observed, not asserted).
    const postCallbackUrl = new URL(`http://127.0.0.1:${port}/callback-check`);
    postCallbackUrl.searchParams.set('code', codeFromRes);
    postCallbackUrl.searchParams.set('state', state1);
    const postCallbackRes = await fetch(postCallbackUrl);
    const postCallbackRequestId = postCallbackRes.headers.get('x-mock-request-id');
    const postCallbackText = await postCallbackRes.text();
    let postCallbackPayload = null; try { postCallbackPayload = JSON.parse(postCallbackText); } catch {}
    const tokenCallCountAtPostCallback = server.tokenCallCount;
    // Observed preExchange for the FIRST (pre-token) callback: token
    // calls at that point were 0. The mock's consumedCodes for the
    // code was empty when the first callback ran.
    const preExchangeObserved = preExchangeObservedTokenCallsAtCallback === 0
      && preCallbackPayload && preCallbackPayload.ok === true;
    // Observed refusal for the SECOND (post-token) callback: code
    // now recorded as consumed in the mock's consumedCodes map
    // with consumedAtRequestNo < thisRequestNo.
    const consumed = server.consumedCodes.get(codeFromRes);
    const consumedRefusalObserved = postCallbackRes.status >= 400
      && postCallbackPayload
      && postCallbackPayload.error === 'invalid_grant'
      && consumed
      && typeof consumed.consumedAtRequestNo === 'number';
    evidence.calls.push({
      verb: 'GET /callback-check (post-token, consumed code)',
      status: postCallbackRes.status, requestId: postCallbackRequestId,
      body: postCallbackPayload,
      consumedRecord: consumed || null,
      tokenCallCountAtThisPoint: tokenCallCountAtPostCallback,
    });
    results.push(deClaim({
      capability,
      verdict: preExchangeObserved && consumedRefusalObserved ? 'pass' : 'fail',
      detail: `callback-check: pre-token=${preCallbackRes.status} (tokenCalls=${preExchangeObservedTokenCallsAtCallback}, ok=${preCallbackPayload && preCallbackPayload.ok}); post-token=${postCallbackRes.status} error=${postCallbackPayload && postCallbackPayload.error} consumedAtRequestNo=${consumed && consumed.consumedAtRequestNo}`,
      evidence: {
        requestId: postCallbackRequestId,
        status: postCallbackRes.status,
        error: postCallbackPayload && postCallbackPayload.error,
        preExchangeObserved,
        preExchangeTokenCallCount: preExchangeObservedTokenCallsAtCallback,
        consumedAtRequestNo: consumed && consumed.consumedAtRequestNo,
        tokenCallCountAtPostCallback,
      },
      vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2', verifiedOn: '2026-09-11' },
    }, { ac: 'security-auth-oauth2-AC-10102-2', limitation: LIM_REPLAY }));

    // 5. PKCE-verifier mismatch (fresh code, tampered verifier)
    const state2 = freshState();
    evidence.observedStates.push(state2);
    const authUrl2 = new URL(`http://127.0.0.1:${port}/authorize`);
    for (const [k, v] of authUrl.searchParams) authUrl2.searchParams.set(k, v);
    authUrl2.searchParams.set('state', state2);
    authUrl2.searchParams.set('nonce', `n_${randomBytes(8).toString('base64url')}`);
    const authRes2 = await fetch(authUrl2, { redirect: 'manual' });
    const authRequestId2 = authRes2.headers.get('x-mock-request-id');
    const authText2 = await authRes2.text();
    let authPayload2 = null; try { authPayload2 = JSON.parse(authText2); } catch {}
    evidence.calls.push({ verb: 'GET /authorize (2)', status: authRes2.status, requestId: authRequestId2, resourceId: authPayload2 && authPayload2.code, state: state2 });
    if (!(authRes2.status === 302 && authPayload2 && authPayload2.code)) {
      results.push(deClaim({
        capability, verdict: 'fail',
        detail: `precondition /authorize did not issue a code: status=${authRes2.status} requestId=${authRequestId2}`,
        evidence: { requestId: authRequestId2, status: authRes2.status },
      }, { ac: 'security-auth-oauth2-AC-10103-2', limitation: LIM_PKCE }));
    } else {
      const tamperBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: authPayload2.code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: pkce.verifier + 'X',
      });
      const tamperRes = await fetch(`http://127.0.0.1:${port}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tamperBody.toString(),
      });
      const tamperRequestId = tamperRes.headers.get('x-mock-request-id');
      const tamperText = await tamperRes.text();
      let tamperPayload = null; try { tamperPayload = JSON.parse(tamperText); } catch {}
      evidence.calls.push({ verb: 'POST /token (PKCE mismatch)', status: tamperRes.status, requestId: tamperRequestId, error: tamperPayload && tamperPayload.error });
      results.push(deClaim({
        capability,
        verdict: tamperRes.status === 400 && tamperPayload && tamperPayload.error === 'invalid_grant' ? 'pass' : 'fail',
        detail: `verifier mismatch refused: status=${tamperRes.status} requestId=${tamperRequestId} error=${tamperPayload && tamperPayload.error}`,
        evidence: { requestId: tamperRequestId, status: tamperRes.status, error: tamperPayload && tamperPayload.error, detail: tamperPayload && tamperPayload.detail },
        vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc7636#section-4.6', verifiedOn: '2026-09-11' },
      }, { ac: 'security-auth-oauth2-AC-10103-2', limitation: LIM_PKCE }));
    }

  } finally {
    try {
      await server.stop();
    } catch (err) {
      teardownFailed = true;
      results.push(deClaim({
        capability, verdict: 'fail',
        detail: `TEARDOWN FAILED: mock server stop threw: ${err && err.message ? err.message : String(err)}`,
        evidence: { teardownError: err && err.message ? err.message : String(err) },
      }, { ac: 'security-auth-oauth2-AC-10101-1', limitation: LIM_AUTHZ }));
      evidence.teardownError = err && err.message ? err.message : String(err);
    }
  }
  evidence.teardownFailed = teardownFailed;
  return { results, extra: evidence };
}
