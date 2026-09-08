// H-2 CF platform probe-integrity train: cf-edge tunnel shim.
//
// Fixture-side shim for the edge-cloudflare-tunnel real-account drivers.
// Five seams (all env-token gated on the fixture side so probe bodies
// stay mutation-pure per brief section 5):
//
//   1) provisionScratchServer({ runId }): production path delegates to
//      the shared hetzner-throwaway-server fixture provisioner
//      (packages/rcf-lite/test/fixtures/hetzner-throwaway-server/
//      provision.mjs). Synthetic path returns a shaped record without
//      any hcloud call. Provision-fail synthetic mode throws with a
//      pointer to the fixture step so the driver's env-present +
//      fixture-fail FAIL tail is locally observable.
//
//   2) destroyScratchServer(record): production path delegates to
//      destroy.mjs. Synthetic path is a no-op.
//
//   3) cloudflaredTunnelInfo({ tunnelName }): returns { connectors: [...] }
//      matching `cloudflared tunnel info --output json`. Production path
//      shells to a local cloudflared binary. Synthetic path returns a
//      shaped response based on the H2_CF_TUNNEL_SHIM_MODE env token so
//      the driver code path can be exercised locally without a real
//      Cloudflare account.
//
//   4) fetchTunnelHostname(url, { headers }): returns { status, headers,
//      textBody }. Production path calls Node's global fetch (undici
//      built into Node 24). Synthetic path returns a shaped response
//      based on the H2_CF_TUNNEL_HOSTNAME_SHIM_MODE env token so the
//      public-hostname and access-gated sub-cases can prove their
//      driver paths without hitting a real scratch subdomain.
//
//   5) mintScratchIdentity({ audience, subject, secret, expiresInSec }):
//      HS256-signed JWT for the access-gated sub-case. Node built-ins
//      only (no external dep). Used by the driver to send an
//      authorised request; the driver also sends an unauthenticated
//      request in the same call for the refusal check.
//
// Mutation-purity discipline (brief section 5): the SIMULATE_ literal
// never appears in the probe body; env-token reads live inside this
// shim only. Env tokens carry the H2_CF_TUNNEL_ prefix.
//
// Env tokens (fixture-side, shim-only):
//   H2_CF_TUNNEL_SHIM_MODE = production | synthetic-healthy |
//     synthetic-unhealthy | synthetic-no-connectors | synthetic-error |
//     synthetic-provision-fail
//   H2_CF_TUNNEL_HOSTNAME_SHIM_MODE = production | synthetic-public-200 |
//     synthetic-public-500 | synthetic-gate-open | synthetic-gate-closed
//
// Default (unset or production): the real cloudflared / hcloud / fetch
// path. The default fails locally without account access; that is by
// design. Synthetic modes are for local driver-path verification only;
// HQ's real-account gate step uses the default production path.

import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

const TUNNEL_MODE_ENV = 'H2_CF_TUNNEL_SHIM_MODE';
const HOSTNAME_MODE_ENV = 'H2_CF_TUNNEL_HOSTNAME_SHIM_MODE';

export function currentTunnelMode() {
  return process.env[TUNNEL_MODE_ENV] || 'production';
}

export function currentHostnameMode() {
  return process.env[HOSTNAME_MODE_ENV] || 'production';
}

// ------------ provisionScratchServer / destroyScratchServer ------------

export async function provisionScratchServer({ runId }) {
  const mode = currentTunnelMode();
  if (mode === 'synthetic-provision-fail') {
    const err = new Error('shim synthetic-provision-fail mode: fixture provisioner refused (mutation switch fired on fixture-side)');
    err.code = 'H2_CF_TUNNEL_SHIM_SYNTHETIC_PROVISION_FAIL';
    throw err;
  }
  if (mode !== 'production') {
    // Any other synthetic mode returns a shim record; the connector
    // healthcheck outcome then depends on the tunnel-info synthetic
    // response (healthy / unhealthy / no-connectors / error).
    return {
      shimMode: mode,
      id: `shim-server-${Date.now()}`,
      name: `h2-cf-shim-${runId}`,
      primaryIpv4: '203.0.113.1',
      location: 'shim-eu-central',
      serverType: 'shim-cx11',
    };
  }
  const { provisionThrowawayServer } = await import(
    '../hetzner-throwaway-server/provision.mjs'
  );
  const record = await provisionThrowawayServer({ runId });
  return { shimMode: 'production', ...record };
}

export async function destroyScratchServer(record) {
  const mode = currentTunnelMode();
  if (mode !== 'production') {
    return { shimMode: mode, destroyed: record?.id ?? null };
  }
  const { destroyThrowawayServer } = await import(
    '../hetzner-throwaway-server/destroy.mjs'
  );
  const result = await destroyThrowawayServer(record);
  return { shimMode: 'production', ...(result ?? {}) };
}

// ------------ cloudflaredTunnelInfo ------------

export async function cloudflaredTunnelInfo({ tunnelName }) {
  const mode = currentTunnelMode();
  if (mode === 'synthetic-healthy') {
    return {
      shimMode: mode,
      connectors: [
        {
          id: 'shim-connector-1',
          region: 'shim-eu-central',
          version: '2026.8.3',
          status: 'HEALTHY',
        },
      ],
    };
  }
  if (mode === 'synthetic-unhealthy') {
    return {
      shimMode: mode,
      connectors: [
        {
          id: 'shim-connector-1',
          region: 'shim-eu-central',
          version: '2026.8.3',
          status: 'UNHEALTHY',
        },
      ],
    };
  }
  if (mode === 'synthetic-no-connectors') {
    return { shimMode: mode, connectors: [] };
  }
  if (mode === 'synthetic-error') {
    const err = new Error('shim synthetic-error mode: cloudflared control surface unreachable');
    err.code = 'H2_CF_TUNNEL_SHIM_SYNTHETIC_ERROR';
    throw err;
  }
  // Production path: shell to cloudflared tunnel info <name> --output json.
  const parsed = await runCloudflared(['tunnel', 'info', String(tunnelName), '--output', 'json']);
  const connectors = Array.isArray(parsed?.conns)
    ? parsed.conns
    : Array.isArray(parsed?.connectors) ? parsed.connectors : [];
  return { shimMode: 'production', connectors };
}

function runCloudflared(argv) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn('cloudflared', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`cloudflared ${argv.join(' ')} exited ${code}: ${stderr.trim()}`));
      }
      try {
        resolvePromise(stdout.trim().length > 0 ? JSON.parse(stdout) : {});
      } catch (err) {
        reject(new Error(`cloudflared stdout is not JSON: ${err.message}`));
      }
    });
  });
}

// ------------ fetchTunnelHostname ------------

export async function fetchTunnelHostname(url, { headers = {}, method = 'GET' } = {}) {
  const mode = currentHostnameMode();
  if (mode === 'synthetic-public-200') {
    return {
      shimMode: mode,
      status: 200,
      headers: { 'content-type': 'text/plain' },
      textBody: 'shim internal-service-payload OK',
    };
  }
  if (mode === 'synthetic-public-500') {
    return {
      shimMode: mode,
      status: 500,
      headers: { 'content-type': 'text/plain' },
      textBody: 'shim internal-service failure',
    };
  }
  if (mode === 'synthetic-gate-closed') {
    // Access gate configured correctly: no JWT rejected, valid JWT accepted.
    if (headers.authorization && headers.authorization.startsWith('Bearer ')) {
      return {
        shimMode: mode,
        status: 200,
        headers: { 'content-type': 'text/plain' },
        textBody: 'shim access-gated payload (JWT accepted)',
      };
    }
    return {
      shimMode: mode,
      status: 401,
      headers: { 'content-type': 'text/plain', 'cf-access-authenticated-user-email': '' },
      textBody: 'shim access-gate refused: JWT missing',
    };
  }
  if (mode === 'synthetic-gate-open') {
    // Broken Access gate: both requests succeed (i.e. gate drift).
    return {
      shimMode: mode,
      status: 200,
      headers: { 'content-type': 'text/plain' },
      textBody: 'shim gate-open payload (gate broken, request unauthenticated but accepted)',
    };
  }
  // Production path: undici built-in fetch on Node 24.
  const resp = await fetch(url, { method, headers });
  const textBody = await resp.text();
  const outHeaders = {};
  for (const [k, v] of resp.headers) outHeaders[k] = v;
  return { shimMode: 'production', status: resp.status, headers: outHeaders, textBody };
}

// ------------ mintScratchIdentity ------------

export function mintScratchIdentity({ audience, subject, secret, expiresInSec = 300 }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: 'h2-cf-tunnel-shim',
    sub: String(subject),
    aud: String(audience),
    iat: now,
    exp: now + expiresInSec,
  };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signing = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac('sha256', String(secret)).update(signing).digest('base64url');
  return `${signing}.${sig}`;
}
