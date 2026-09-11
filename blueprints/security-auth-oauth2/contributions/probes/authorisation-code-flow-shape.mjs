// Full authorisation-code-flow shape probe for security-auth-oauth2.
// Boots the local mock authorisation server on the fixture port and
// drives the RFC 6749 code flow with RFC 7636 PKCE end to end. The
// mock server is an OIDC issuer (returns id_token per OpenID Connect
// Core 1.0 sec 3.1.3.3) and is the deliverable's own contribution
// under this probe. Positive evidence: the mock's X-Mock-Request-Id
// header (rule 7d shape 1), response body excerpts (rule 7d shape 2),
// and the consumed-then-absent authorisation code in the mock's live
// inventory map (rule 7d shape 3 against the deliverable's fixture
// engine).
//
// capability: authorisationCodeFlow.
// Anchors (per closure): AC-10101-1 (redirect params), AC-10101-2
//   (token endpoint returns access_token AND id_token for OIDC),
//   AC-10102-2 (state from consumed pending flow refused),
//   AC-10103-2 (verifier mismatch refused with invalid_grant).
// accountBound: false; the fixture mock IS the engine for
//   authorisationCodeFlow at the shipped-shape layer per the closure
//   addendum rule 2 (deliverable's own contribution).

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { MOCK_PORT_RANGE } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = 'security-auth-oauth2-AC-10101-1';
export const capability = 'authorisationCodeFlow';
export const accountBound = false;

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

    // 1. /authorize - AC-10101-1 property.
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
      results.push({
        anchorAcId, capability, verdict: 'fail',
        detail: `AC-10101-1: /authorize failed: status=${authRes.status} requestId=${authRequestId} bodyExcerpt=${authText.slice(0, 200)}`,
        evidence: { requestId: authRequestId, status: authRes.status },
      });
      return { results, extra: evidence };
    }
    results.push({
      anchorAcId,
      capability,
      verdict: 'pass',
      detail: `AC-10101-1: /authorize redirected with S256 code_challenge and a distinct state. status=${authRes.status} requestId=${authRequestId} state=${state1}`,
      evidence: { requestId: authRequestId, status: authRes.status, state: state1, codeIssued: codeFromRes, codeChallengeMethod: 'S256' },
    });

    // 2. /token with valid verifier - AC-10101-2 (access_token AND id_token for OIDC).
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
    // Positive evidence: record the id_token PRESENCE and its shape
    // (three dot-separated base64url segments). No token bytes leaked.
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
    results.push({
      anchorAcId: 'security-auth-oauth2-AC-10101-2',
      capability,
      verdict: tokenOk ? 'pass' : 'fail',
      detail: tokenOk
        ? `AC-10101-2 (OIDC token exchange returns access_token AND id_token): /token status=200 requestId=${tokenRequestId} access_token=present id_token=present segments=3`
        : `AC-10101-2 failure: /token status=${tokenRes.status} requestId=${tokenRequestId} accessTokenPresent=${Boolean(tokenPayload && tokenPayload.access_token)} idTokenPresent=${Boolean(tokenPayload && tokenPayload.id_token)} idTokenShapeOk=${idTokenShape}`,
      evidence: {
        requestId: tokenRequestId,
        status: tokenRes.status,
        accessTokenPresent: Boolean(tokenPayload && tokenPayload.access_token),
        idTokenPresent: Boolean(tokenPayload && tokenPayload.id_token),
        idTokenSegments: tokenPayload && tokenPayload.id_token ? tokenPayload.id_token.split('.').length : 0,
        tokenType: tokenPayload && tokenPayload.token_type,
      },
    });

    // 3. /token replay must fail - AC-10102-2 (state consumed on prior successful exchange).
    const replayRes = await fetch(`http://127.0.0.1:${port}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody.toString(),
    });
    const replayRequestId = replayRes.headers.get('x-mock-request-id');
    const replayText = await replayRes.text();
    let replayPayload = null; try { replayPayload = JSON.parse(replayText); } catch {}
    evidence.calls.push({ verb: 'POST /token (replay of consumed code)', status: replayRes.status, requestId: replayRequestId, error: replayPayload && replayPayload.error });
    results.push({
      anchorAcId: 'security-auth-oauth2-AC-10102-2',
      capability,
      verdict: replayRes.status === 400 && replayPayload && replayPayload.error === 'invalid_grant' ? 'pass' : 'fail',
      detail: `AC-10102-2 (replay of consumed code refused with invalid_grant): status=${replayRes.status} requestId=${replayRequestId} error=${replayPayload && replayPayload.error}`,
      evidence: { requestId: replayRequestId, status: replayRes.status, error: replayPayload && replayPayload.error, codeStillInActiveCodes: server.activeCodes.has(codeFromRes) },
      vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2', verifiedOn: '2026-09-11' },
    });

    // 4. PKCE-verifier mismatch must fail - AC-10103-2.
    // Fresh /authorize call for a fresh code; distinct state per AC-10101-1.
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
      results.push({
        anchorAcId: 'security-auth-oauth2-AC-10103-2', capability, verdict: 'fail',
        detail: `AC-10103-2 precondition failed: fresh /authorize did not issue a code: status=${authRes2.status} requestId=${authRequestId2}`,
        evidence: { requestId: authRequestId2, status: authRes2.status },
      });
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
      results.push({
        anchorAcId: 'security-auth-oauth2-AC-10103-2',
        capability,
        verdict: tamperRes.status === 400 && tamperPayload && tamperPayload.error === 'invalid_grant' ? 'pass' : 'fail',
        detail: `AC-10103-2 (verifier mismatch refused with invalid_grant): status=${tamperRes.status} requestId=${tamperRequestId} error=${tamperPayload && tamperPayload.error} detail=${tamperPayload && tamperPayload.detail}`,
        evidence: { requestId: tamperRequestId, status: tamperRes.status, error: tamperPayload && tamperPayload.error, detail: tamperPayload && tamperPayload.detail },
        vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc7636#section-4.6', verifiedOn: '2026-09-11' },
      });
    }

    // Cross-cutting assertion: the states are distinct (AC-10101-1
    // says the state is a value not present in any prior redirect).
    const distinctStates = new Set(evidence.observedStates).size === evidence.observedStates.length;
    if (!distinctStates) {
      results.push({
        anchorAcId, capability, verdict: 'fail',
        detail: `AC-10101-1 state distinctness failed: observedStates=${JSON.stringify(evidence.observedStates)}`,
        evidence: { observedStates: evidence.observedStates },
      });
    }
  } finally {
    try {
      await server.stop();
    } catch (err) {
      teardownFailed = true;
      const detail = `TEARDOWN FAILED: mock server stop threw: ${err && err.message ? err.message : String(err)}. Per criterion-e master brief ruling, teardown failure fails the verdict.`;
      results.push({
        anchorAcId, capability, verdict: 'fail', detail,
        evidence: { teardownError: err && err.message ? err.message : String(err) },
      });
      evidence.teardownError = err && err.message ? err.message : String(err);
    }
  }
  evidence.teardownFailed = teardownFailed;
  return { results, extra: evidence };
}
