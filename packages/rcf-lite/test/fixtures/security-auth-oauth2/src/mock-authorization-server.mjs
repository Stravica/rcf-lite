// Minimal mock OAuth 2.0 authorisation server for the security-auth-
// oauth2 fixture. Speaks the RFC 6749 authorisation code flow and
// the RFC 7636 PKCE extension on the S256 method; refuses on missing
// or mismatched code_verifier. The server binds a per-instance
// request counter and echoes it as `X-Mock-Request-Id` on every
// response so probes can capture a real request id from the local
// engine (rule 7d evidence shape 1). The mock is process-local and
// self-terminates on stop().
//
// References:
// - RFC 6749 (OAuth 2.0) https://datatracker.ietf.org/doc/html/rfc6749 verifiedOn 2026-09-11
// - RFC 7636 (PKCE)     https://datatracker.ietf.org/doc/html/rfc7636 verifiedOn 2026-09-11

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export function createMockAuthServer({ port = 47400, clientId = 'mock-client', redirectUri = 'http://127.0.0.1:47499/callback' } = {}) {
  const authCodes = new Map(); // code -> { verifierChallenge, method, principal, expiresAt }
  const tokens = new Map();    // access_token -> { principal, expiresAt }
  let requestCounter = 0;

  const server = createServer((req, res) => {
    const requestId = `mock-req-${++requestCounter}-${randomBytes(4).toString('hex')}`;
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
      const code = `mock-code-${randomBytes(6).toString('hex')}`;
      authCodes.set(code, {
        verifierChallenge: challenge,
        method,
        principal: { sub: `mock-user-${randomBytes(3).toString('hex')}` },
        expiresAt: Date.now() + 60_000,
      });
      // Simulate the user-agent redirect target as a JSON body (the
      // fixture calls it directly instead of following redirects).
      const location = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || '')}`;
      res.statusCode = 302;
      res.setHeader('Location', location);
      res.end(JSON.stringify({ requestId, code, location }));
      return;
    }

    // POST /token: RFC 6749 sec 4.1.3 + RFC 7636 sec 4.5
    if (req.method === 'POST' && url.pathname === '/token') {
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
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant', requestId, detail: 'code not found or already redeemed' }));
          return;
        }
        // Consume the code (single-use per RFC 6749 sec 4.1.2).
        authCodes.delete(code);
        // PKCE verify per RFC 7636 sec 4.6: derive S256 challenge from verifier and compare.
        const derived = createHash('sha256').update(codeVerifier || '').digest('base64url');
        if (derived !== record.verifierChallenge) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant', requestId, detail: 'PKCE verifier does not match challenge' }));
          return;
        }
        const accessToken = `mock-at-${randomBytes(12).toString('hex')}`;
        tokens.set(accessToken, { principal: record.principal, expiresAt: Date.now() + 3_600_000 });
        res.statusCode = 200;
        res.end(JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile',
          requestId,
          sub: record.principal.sub,
        }));
      });
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
    activeCodes: authCodes,
    activeTokens: tokens,
  };
}

// Fixture-side PKCE verifier + challenge generator per RFC 7636 sec 4.1-4.2.
export function generatePkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}
