// Full authorisation-code-flow shape probe for security-auth-oauth2.
// Boots the local mock authorisation server on the fixture port,
// drives GET /authorize?response_type=code&code_challenge=... to
// obtain a code, then POST /token?grant_type=authorization_code
// with the verifier and captures the access token. Positive
// evidence: the local mock's X-Mock-Request-Id header (rule 7d
// shape 1), the response body excerpts (rule 7d shape 2), and the
// consumed-then-absent single-use code in the mock's live inventory
// map (rule 7d shape 3 against a local engine). The probe also
// asserts that a second /token call reusing the same code fails
// with invalid_grant per RFC 6749 sec 4.1.2.
//
// capability: authorisationCodeFlow.
// anchorAcId: security-auth-oauth2-AC-10101-1.
// accountBound: false (local mock server is the engine).

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_PORT_RANGE } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = 'security-auth-oauth2-AC-10101-1';
export const capability = 'authorisationCodeFlow';
export const accountBound = false;

function pickPort() {
  const override = Number(process.env.OAUTH2_MOCK_PORT);
  if (Number.isFinite(override) && override >= MOCK_PORT_RANGE.min && override <= MOCK_PORT_RANGE.max) return override;
  // Random port in the security-family's declared range.
  return MOCK_PORT_RANGE.min + Math.floor(Math.random() * (MOCK_PORT_RANGE.max - MOCK_PORT_RANGE.min + 1));
}

export default async function runProbe() {
  const { createMockAuthServer, generatePkcePair } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'mock-authorization-server.mjs')).href);
  const port = pickPort();
  const clientId = 'mock-client';
  const redirectUri = 'http://127.0.0.1:47499/callback';
  const server = createMockAuthServer({ port, clientId, redirectUri });
  const evidence = { port, clientId, redirectUri, calls: [] };
  const results = [];

  try {
    await server.start();
    const pkce = generatePkcePair();

    // 1. /authorize
    const authUrl = new URL(`http://127.0.0.1:${port}/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', 'xyz-state');
    const authRes = await fetch(authUrl, { redirect: 'manual' });
    const authRequestId = authRes.headers.get('x-mock-request-id');
    const authText = await authRes.text();
    let authPayload = null; try { authPayload = JSON.parse(authText); } catch {}
    const codeFromRes = authPayload && authPayload.code;
    evidence.calls.push({ verb: 'GET /authorize', status: authRes.status, requestId: authRequestId, resourceId: codeFromRes });

    if (!(authRes.status === 302 && codeFromRes)) {
      results.push({ anchorAcId, capability, verdict: 'fail', detail: `authorize failed: status=${authRes.status} requestId=${authRequestId} bodyExcerpt=${authText.slice(0, 200)}` });
      return { results, extra: evidence };
    }

    // 2. /token with valid verifier
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
    evidence.calls.push({ verb: 'POST /token (valid)', status: tokenRes.status, requestId: tokenRequestId, tokenPrefix: tokenPayload && tokenPayload.access_token ? tokenPayload.access_token.slice(0, 10) : null });

    const tokenOk = tokenRes.status === 200 && tokenPayload && typeof tokenPayload.access_token === 'string' && tokenPayload.token_type === 'Bearer';
    results.push({
      anchorAcId,
      capability,
      verdict: tokenOk ? 'pass' : 'fail',
      detail: tokenOk
        ? `mock authorisation-code flow: /authorize status=302 requestId=${authRequestId} code=${codeFromRes}; /token status=200 requestId=${tokenRequestId} access_token=${tokenPayload.access_token.slice(0, 10)}... token_type=Bearer expires_in=${tokenPayload.expires_in}.`
        : `token exchange failed: status=${tokenRes.status} requestId=${tokenRequestId} bodyExcerpt=${tokenText.slice(0, 200)}`,
      evidence: { authRequestId, tokenRequestId, authStatus: authRes.status, tokenStatus: tokenRes.status, tokenPayload: tokenPayload ? { token_type: tokenPayload.token_type, expires_in: tokenPayload.expires_in, scope: tokenPayload.scope } : null },
    });

    // 3. /token replay must fail (single-use code, RFC 6749 sec 4.1.2)
    const replayRes = await fetch(`http://127.0.0.1:${port}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody.toString(),
    });
    const replayRequestId = replayRes.headers.get('x-mock-request-id');
    const replayText = await replayRes.text();
    let replayPayload = null; try { replayPayload = JSON.parse(replayText); } catch {}
    evidence.calls.push({ verb: 'POST /token (replay)', status: replayRes.status, requestId: replayRequestId });
    results.push({
      anchorAcId: 'security-auth-oauth2-AC-10101-2',
      capability,
      verdict: replayRes.status === 400 && replayPayload && replayPayload.error === 'invalid_grant' ? 'pass' : 'fail',
      detail: `single-use replay: status=${replayRes.status} requestId=${replayRequestId} error=${replayPayload && replayPayload.error}`,
      evidence: { requestId: replayRequestId, status: replayRes.status, error: replayPayload && replayPayload.error, codeStillInActiveCodes: server.activeCodes.has(codeFromRes) },
      vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2', verifiedOn: '2026-09-11' },
    });

    // 4. PKCE-verifier mismatch must fail
    const tamperBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: codeFromRes,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: pkce.verifier + 'X',
    });
    // Fresh code for this negative test.
    const authRes2 = await fetch(authUrl, { redirect: 'manual' });
    const authPayload2 = await authRes2.json();
    tamperBody.set('code', authPayload2.code);
    const tamperRes = await fetch(`http://127.0.0.1:${port}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tamperBody.toString(),
    });
    const tamperRequestId = tamperRes.headers.get('x-mock-request-id');
    const tamperPayload = await tamperRes.json();
    evidence.calls.push({ verb: 'POST /token (PKCE mismatch)', status: tamperRes.status, requestId: tamperRequestId });
    results.push({
      anchorAcId: 'security-auth-oauth2-AC-10106-4',
      capability,
      verdict: tamperRes.status === 400 && tamperPayload.error === 'invalid_grant' ? 'pass' : 'fail',
      detail: `PKCE-mismatch refused: status=${tamperRes.status} requestId=${tamperRequestId} error=${tamperPayload.error} detail=${tamperPayload.detail}`,
      evidence: { requestId: tamperRequestId, status: tamperRes.status, error: tamperPayload.error, detail: tamperPayload.detail },
      vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc7636#section-4.6', verifiedOn: '2026-09-11' },
    });
  } finally {
    try { await server.stop(); } catch {}
  }
  return { results, extra: evidence };
}
