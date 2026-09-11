// Minimal mock OAuth 2.0 authorisation server for the security-auth-
// oauth2 fixture. Speaks the RFC 6749 authorisation code flow and
// the RFC 7636 PKCE extension on the S256 method; refuses on missing
// or mismatched code_verifier. The server binds a per-instance
// request counter and echoes it as `X-Mock-Request-Id` on every
// response — this is a fixture request id for local diagnostics,
// not a rule 7d engine id and not evidence of a real OAuth 2.0
// engine (the real engine is a live IdP; this mock is a fixture).
// The server is process-local and self-terminates on stop().
//
// Consumed-state tracking. `authCodes` holds the ACTIVE codes an
// /authorize call issued; `consumedCodes` holds a record of every
// code the /token endpoint has consumed, with the request-counter
// snapshot at consumption time so /callback-check can distinguish
// "never issued" from "issued and consumed", and downstream probes
// can observe the ORDER of requests (a callback that happens
// BEFORE any /token has ever run has consumedCodes empty; a
// callback after the token exchange finds the code in
// consumedCodes with its consumedAtRequestNo).
//
// References:
// - RFC 6749 (OAuth 2.0) https://datatracker.ietf.org/doc/html/rfc6749 verifiedOn 2026-09-11
// - RFC 7636 (PKCE)     https://datatracker.ietf.org/doc/html/rfc7636 verifiedOn 2026-09-11

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export function createMockAuthServer({ port = 47400, clientId = 'mock-client', redirectUri = 'http://127.0.0.1:47499/callback', oidc = true, issuer = 'https://mock-issuer.example.test' } = {}) {
  const authCodes = new Map();     // code -> { verifierChallenge, method, principal, nonce, expiresAt, issuedAtRequestNo }
  const consumedCodes = new Map(); // code -> { consumedAtRequestNo, tokenIssued }
  const tokens = new Map();        // access_token -> { principal, expiresAt }
  let requestCounter = 0;
  let tokenCallCounter = 0;

  const server = createServer((req, res) => {
    const requestNo = ++requestCounter;
    const requestId = `mock-req-${requestNo}-${randomBytes(4).toString('hex')}`;
    res.setHeader('X-Mock-Request-Id', requestId);
    res.setHeader('Content-Type', 'application/json');

    const url = new URL(req.url, `http://${req.headers.host}`);

    // GET /authorize: RFC 6749 sec 4.1.1 + RFC 7636 sec 4.3
    if (req.method === 'GET' && url.pathname === '/authorize') {
      const respType = url.searchParams.get('response_type');
      const givenClient = url.searchParams.get('client_id');
      const givenRedirect = url.searchParams.get('redirect_uri');
      const challenge = url.searchParams.get('code_challenge');
      const method = url.searchParams.get('code_challenge_method');
      const state = url.searchParams.get('state');
      if (respType !== 'code' || givenClient !== clientId || givenRedirect !== redirectUri || !challenge || method !== 'S256') {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid_request', requestId, saw: { respType, givenClient, givenRedirect, challenge: Boolean(challenge), method } }));
        return;
      }
      const nonce = url.searchParams.get('nonce') || null;
      const code = `mock-code-${randomBytes(6).toString('hex')}`;
      authCodes.set(code, {
        verifierChallenge: challenge,
        method,
        principal: { sub: `mock-user-${randomBytes(3).toString('hex')}` },
        nonce,
        expiresAt: Date.now() + 60_000,
        issuedAtRequestNo: requestNo,
      });
      const location = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || '')}`;
      res.statusCode = 302;
      res.setHeader('Location', location);
      res.end(JSON.stringify({ requestId, code, location }));
      return;
    }

    // POST /token: RFC 6749 sec 4.1.3 + RFC 7636 sec 4.5
    if (req.method === 'POST' && url.pathname === '/token') {
      tokenCallCounter++;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const grantType = params.get('grant_type');
        const code = params.get('code');
        const codeVerifier = params.get('code_verifier');
        const givenClient = params.get('client_id');
        const givenRedirect = params.get('redirect_uri');
        if (grantType !== 'authorization_code' || givenClient !== clientId || givenRedirect !== redirectUri) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_request', requestId }));
          return;
        }
        const record = authCodes.get(code);
        if (!record) {
          const priorConsumed = consumedCodes.get(code);
          res.statusCode = 400;
          res.end(JSON.stringify({
            error: 'invalid_grant',
            requestId,
            detail: priorConsumed
              ? `code already consumed at request ${priorConsumed.consumedAtRequestNo}`
              : 'code not found',
          }));
          return;
        }
        // Consume the code (single-use per RFC 6749 sec 4.1.2) and
        // stamp the consumption in the persistent consumedCodes map.
        authCodes.delete(code);
        consumedCodes.set(code, { consumedAtRequestNo: requestNo, tokenIssued: false });
        const derived = createHash('sha256').update(codeVerifier || '').digest('base64url');
        if (derived !== record.verifierChallenge) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant', requestId, detail: 'PKCE verifier does not match challenge' }));
          return;
        }
        const accessToken = `mock-at-${randomBytes(12).toString('hex')}`;
        tokens.set(accessToken, { principal: record.principal, expiresAt: Date.now() + 3_600_000 });
        // Update the consumption record to note the token issue.
        const consumed = consumedCodes.get(code);
        consumed.tokenIssued = true;
        consumedCodes.set(code, consumed);
        let idToken = undefined;
        if (oidc) {
          const nowSec = Math.floor(Date.now() / 1000);
          const header = { alg: 'HS256', typ: 'JWT', kid: 'mock-kid-1' };
          const payload = {
            iss: issuer,
            aud: clientId,
            sub: record.principal.sub,
            iat: nowSec,
            exp: nowSec + 3600,
            nonce: record.nonce || 'mock-nonce',
          };
          const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
          const signingInput = `${b64(header)}.${b64(payload)}`;
          const sig = createHash('sha256').update(`${signingInput}.mock-shared-secret`).digest('base64url');
          idToken = `${signingInput}.${sig}`;
        }
        res.statusCode = 200;
        res.end(JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile',
          requestId,
          sub: record.principal.sub,
          ...(idToken ? { id_token: idToken } : {}),
        }));
      });
      return;
    }

    // GET /callback-check: the mock's callback tier. Reads the real
    // consumedCodes record and refuses when the presented code has
    // been consumed. The returned body carries consumedAtRequestNo
    // and the request-order stamp so a probe can OBSERVE whether the
    // callback ran BEFORE or AFTER any /token exchange for this code
    // (rather than asserting `preExchange` as a constant).
    if (req.method === 'GET' && url.pathname === '/callback-check') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid_request', requestId, detail: 'code and state required' }));
        return;
      }
      const consumed = consumedCodes.get(code);
      const active = authCodes.get(code);
      if (consumed) {
        res.statusCode = 400;
        res.end(JSON.stringify({
          error: 'invalid_grant',
          requestId,
          detail: `authorisation code already consumed; callback refused pre-exchange (consumedAtRequestNo=${consumed.consumedAtRequestNo} thisRequestNo=${requestNo} tokenIssued=${consumed.tokenIssued})`,
          consumedAtRequestNo: consumed.consumedAtRequestNo,
          thisRequestNo: requestNo,
          tokenIssued: consumed.tokenIssued,
        }));
        return;
      }
      if (!active) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid_grant', requestId, detail: 'authorisation code not found (never issued or expired)' }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, requestId, note: 'code accepted for exchange (fresh)', thisRequestNo: requestNo }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found', requestId }));
  });

  return {
    async start() {
      await new Promise((r) => server.listen(port, '127.0.0.1', r));
      return { url: `http://127.0.0.1:${port}` };
    },
    async stop() {
      await new Promise((r) => server.close(r));
    },
    get requestCount() { return requestCounter; },
    get tokenCallCount() { return tokenCallCounter; },
    activeCodes: authCodes,
    consumedCodes,
    activeTokens: tokens,
  };
}

// Fixture-side PKCE verifier + challenge generator per RFC 7636 sec 4.1-4.2.
export function generatePkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}
