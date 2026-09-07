// Shared helpers for edge-cloudflare-access probes.
//
// Runtime-dependency posture: probes import the fixture's JWT
// validator, fixture-JWT signer and JWKS server from the cf-edge
// fixture src/ and test/ trees so rcf-lite itself gains no new
// runtime dependency. Four probes drive the shipped code path
// in-process; one probe (real-account-gated-url) opens a network
// fetch against the elicited hostname when CI_HAS_CLOUDFLARE_ACCOUNT
// and CF_ACCESS_HOST are set. Without both env vars it records
// accountBoundSkipped and aggregates to pass per spec section 3.5.
//
// The wrangler dev seam is documented in the fixture README under
// the "Two-line wrangler-seam boot" section; the wrangler-seam
// probe drives it under workerd.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/cf-edge');
export const REPORT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/edge-cloudflare-access');

export function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    slug: 'edge-cloudflare-access',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
    aggregateVerdict: aggregate(results),
    ...(extra ?? {}),
  };
  const path = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { report, path };
}

// Wraps a probe's async main body and reports. Sets process.exitCode
// on fail; drains stdout naturally per shelf convention.
export async function runShim(probeName, engine, mainFn) {
  try {
    const { results, extra } = await mainFn();
    const { report, path } = await writeReport({ probeName, engine, results, extra });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`report written to ${path}\n`);
    if (report.aggregateVerdict === 'fail') process.exitCode = 1;
  } catch (err) {
    const results = [{
      anchorAcId: 'unknown',
      verdict: 'fail',
      detail: `probe threw: ${err && err.message ? err.message : String(err)}`,
    }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}

// Boot a fixture JWT keypair + JWKS server on 127.0.0.1:0 and
// return {key, server, jwksUrl, stop}.
export async function bootFixtureJwks(kid = 'cf-edge-fixture-kid-1') {
  const signerMod = await import(`${FIXTURE_DIR}/test/jwt-signer.mjs`);
  const jwksMod = await import(`${FIXTURE_DIR}/test/jwks-server.mjs`);
  const key = signerMod.createFixtureKey(kid);
  const server = await jwksMod.startJwksServer({ port: 0, keys: [key] });
  return { key, server, signerMod, jwksUrl: server.url, stop: () => server.stop() };
}

export async function loadValidator() {
  return (await import(`${FIXTURE_DIR}/src/jwt-validator.mjs`)).createAccessValidator;
}

export function fixtureEnv(jwksUrl, audience = 'cf-edge-fixture-audience') {
  return { ACCESS_JWKS_URL: jwksUrl, ACCESS_AUDIENCE: audience };
}

export const FIXTURE_AUDIENCE = 'cf-edge-fixture-audience';
export const FIXTURE_ISSUER = 'https://cf-edge-fixture.cloudflareaccess.test';
