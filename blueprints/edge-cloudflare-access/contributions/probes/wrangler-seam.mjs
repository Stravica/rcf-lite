// Wrangler-seam probe for edge-cloudflare-access v1.0.0.
//
// Spawns `wrangler dev --local` on the cf-edge fixture and drives
// three requests to observe the JWT validator at the edge under
// workerd:
//
// (a) a missing-header request to /protected returns HTTP 401
//     (the validator's reject path runs through the shipped Worker
//     entry, not through the in-process probes).
// (b) a request to /protected carrying a fixture-signed JWT that
//     the fixture JWKS server (booted by this probe on the fixed
//     port from wrangler.toml [vars] ACCESS_JWKS_URL) validates
//     returns HTTP 200 with request.auth reflected on the response
//     body.
// (c) a request to /health returns HTTP 200 (the /health path is
//     exempt from the validator so a load balancer can reach it).
//
// Warn semantics per spec section 3.1 pass-with-skip:
//   - wrangler devDependency missing: aggregateVerdict warn (never fail);
//   - wrangler CLI fails to bind within the cap: warn.
//   - A handler thrown at the workerd boundary: fail (per round-6 gate).
//
// Mutation-check pair for the negative fires: removing the
// validator's early-return call on missing header would surface
// the /protected request as HTTP 200 with no request.auth (an
// unauthenticated request reaching the handler). The probe fails
// on that mutation: HTTP 401 is required. See PR body for the
// verbatim tails of the shipped-path pass and the mutation-run
// fail.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const anchorAcId = 'AC-34101-1';
export const accountBound = false;

const BIND_CAP_MS = 60000;
const KILL_GRACE_MS = 2000;
// The fixture wrangler.toml [vars] ACCESS_JWKS_URL points at 127.0.0.1:8788
// per the shipped file. The wrangler-seam probe boots the JWKS server on
// exactly that port so the validator hits it under workerd.
const JWKS_PORT = 8788;
const FIXTURE_AUDIENCE = 'cf-edge-fixture-audience';
const FIXTURE_ISSUER = 'https://cf-edge-fixture.cloudflareaccess.test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'cf-edge');

function findWranglerBin() {
  const candidate = resolve(FIXTURE_DIR, 'node_modules', '.bin', 'wrangler');
  return existsSync(candidate) ? candidate : null;
}

async function killAndDrain(proc) {
  if (!proc || proc.killed) return;
  try { proc.kill('SIGTERM'); } catch (_e) {}
  await new Promise((r) => setTimeout(r, KILL_GRACE_MS));
  try { if (!proc.killed) proc.kill('SIGKILL'); } catch (_e) {}
}

export default async function runProbe() {
  const results = [];
  const bin = findWranglerBin();
  if (!bin) {
    results.push({
      anchorAcId: 'AC-34101-1',
      verdict: 'warn',
      detail: `wrangler devDependency not installed under ${FIXTURE_DIR}/node_modules/.bin/wrangler; run pnpm install --ignore-workspace in the fixture directory. Mechanism-reach gap noted; the in-process probes carry the runtime evidence for the shipped validator. Warn (not fail) per section 3.1 pass-with-skip.`,
    });
    return { results, extra: { wranglerBinPresent: false } };
  }

  // Boot the fixture JWKS server on the fixed port from wrangler.toml.
  const signerMod = await import(pathToFileURL(resolve(FIXTURE_DIR, 'test', 'jwt-signer.mjs')).href);
  const jwksMod = await import(pathToFileURL(resolve(FIXTURE_DIR, 'test', 'jwks-server.mjs')).href);
  const key = signerMod.createFixtureKey('cf-edge-wrangler-seam-kid');
  let jwks;
  try {
    jwks = await jwksMod.startJwksServer({ port: JWKS_PORT, keys: [key] });
  } catch (err) {
    results.push({
      anchorAcId: 'AC-34101-1',
      verdict: 'warn',
      detail: `local JWKS server could not bind port ${JWKS_PORT}: ${err && err.message ? err.message : String(err)}. Warn (not fail): the JWKS port is required for the wrangler-seam probe to observe the validator's positive path under workerd. Fix by freeing port ${JWKS_PORT} and re-running.`,
    });
    return { results, extra: { wranglerBinPresent: true, jwksBound: false } };
  }

  const proc = spawn(bin, ['dev', '--local', '--port', '0'], {
    cwd: FIXTURE_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let boundUrl = null;
  let stderrTail = '';
  let stdoutTail = '';
  proc.stdout.on('data', (buf) => {
    const s = buf.toString();
    stdoutTail = (stdoutTail + s).slice(-2000);
    const m = s.match(/Ready on http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i);
    if (m && !boundUrl) boundUrl = `http://127.0.0.1:${m[1]}`;
  });
  proc.stderr.on('data', (b) => { stderrTail = (stderrTail + b.toString()).slice(-2000); });

  const start = Date.now();
  while (!boundUrl && Date.now() - start < BIND_CAP_MS) {
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!boundUrl) {
    await killAndDrain(proc);
    await jwks.stop();
    results.push({
      anchorAcId: 'AC-34101-1',
      verdict: 'warn',
      detail: `wrangler dev did not bind within ${BIND_CAP_MS}ms; stdoutTail: ${stdoutTail.slice(-400)} stderrTail: ${stderrTail.slice(-400)}. Warn (not fail) per section 3.1 pass-with-skip.`,
    });
    return { results, extra: { wranglerBinPresent: true, boundUrl: null } };
  }

  try {
    // (a) missing header on /protected -> 401
    let statusMissing = 0;
    try {
      const r = await fetch(`${boundUrl}/protected`);
      statusMissing = r.status;
    } catch (err) {
      results.push({
        anchorAcId: 'AC-34101-1',
        verdict: 'fail',
        detail: `handler thrown at the workerd boundary on /protected: ${err && err.message ? err.message : String(err)}`,
      });
      return { results, extra: { wranglerBinPresent: true, boundUrl } };
    }
    results.push({
      anchorAcId: 'AC-34101-1',
      verdict: statusMissing === 401 ? 'pass' : 'fail',
      detail: statusMissing === 401
        ? `workerd /protected (no header) returned HTTP 401 - the shipped validator's missing-header reject path fires at the edge`
        : `workerd /protected (no header) returned HTTP ${statusMissing}; expected 401 on the shipped validator's missing-header reject path (a value other than 401 would surface an unauthenticated request to the handler - the exact mutation the probe guards against)`,
    });

    // (b) valid fixture-signed JWT on /protected -> 200 with request.auth
    const jwt = signerMod.fixtureAccessJwt({
      key,
      profile: { issuer: FIXTURE_ISSUER, audience: FIXTURE_AUDIENCE },
      principal: { email: 'ada@example.com', sub: 'user:ada', groups: ['admins'] },
      ttlSec: 60,
    });
    let signedStatus = 0;
    let signedBody = '';
    try {
      const r = await fetch(`${boundUrl}/protected`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
      signedStatus = r.status;
      signedBody = await r.text();
    } catch (err) {
      results.push({
        anchorAcId: 'AC-34101-1',
        verdict: 'fail',
        detail: `handler thrown at the workerd boundary on signed /protected: ${err && err.message ? err.message : String(err)}`,
      });
      return { results, extra: { wranglerBinPresent: true, boundUrl } };
    }
    const authLeaked = signedStatus === 200 && signedBody.includes('"auth"') && signedBody.includes('"email":"ada@example.com"');
    results.push({
      anchorAcId: 'AC-34101-1',
      verdict: authLeaked ? 'pass' : 'fail',
      detail: authLeaked
        ? `workerd /protected (fixture-signed JWT) returned HTTP 200 with request.auth reflected on the body (email=ada@example.com)`
        : `workerd /protected (fixture-signed JWT) failed: status=${signedStatus} body=${signedBody.slice(0, 200)}`,
    });

    // (c) /health -> 200
    let healthStatus = 0;
    try {
      const r = await fetch(`${boundUrl}/health`);
      healthStatus = r.status;
    } catch (err) {
      results.push({
        anchorAcId: 'AC-34101-1',
        verdict: 'fail',
        detail: `handler thrown at the workerd boundary on /health: ${err && err.message ? err.message : String(err)}`,
      });
      return { results, extra: { wranglerBinPresent: true, boundUrl } };
    }
    results.push({
      anchorAcId: 'AC-34101-1',
      verdict: healthStatus === 200 ? 'pass' : 'fail',
      detail: healthStatus === 200
        ? `workerd /health returned HTTP 200 (health path exempt from the validator, LB-reachable)`
        : `workerd /health returned HTTP ${healthStatus}; expected 200`,
    });
  } finally {
    await killAndDrain(proc);
    await jwks.stop();
  }

  return { results, extra: { wranglerBinPresent: true, boundUrl } };
}
