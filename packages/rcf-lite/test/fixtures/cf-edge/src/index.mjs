// Minimal Worker entry for the cf-edge fixture. Passes every
// request through the Access JWT validator middleware at the top
// of the handler. Downstream handlers read request.auth only; no
// module in this tree beyond src/jwt-validator.mjs dereferences
// the Cf-Access-Jwt-Assertion header. The sole-reader-scan probe
// enforces this in CI.

import { createAccessValidator } from './jwt-validator.mjs';

function silentSink() { return () => {}; }

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response('ok\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const validator = createAccessValidator({ env, eventSink: silentSink() });
    const result = await validator.middleware(request);
    if (result.rejected) return result.response;
    const body = JSON.stringify({ path: url.pathname, auth: request.auth });
    return new Response(body + '\n', { headers: { 'content-type': 'application/json; charset=utf-8' } });
  },
};
