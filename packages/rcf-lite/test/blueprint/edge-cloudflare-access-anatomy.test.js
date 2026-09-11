// Anatomy + shape + probe + fixture + shelf-doc test for the
// edge-cloudflare-access v1.0.0 blueprint (T-4 of the Cloudflare
// round 6 spec, 2026-09-06 section 5.4). Covers TS-110..119 on the
// T-4 repo chain slice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'edge-cloudflare-access');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'cf-edge');
const ADMIN_FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-admin-console');
const ADMIN_BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-admin-console');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'edge-cloudflare-access.md');
const OWN_TOPICS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const SPA_TOPICS = join(REPO_ROOT, 'blueprints', 'application-spa', 'docs', 'topics.md');
const AUTHORING = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

const FIXTURE_AUDIENCE = 'cf-edge-fixture-audience';
const FIXTURE_ISSUER = 'https://cf-edge-fixture.cloudflareaccess.test';

async function bootJwks() {
  const signerMod = await import(pathToFileURL(join(FIXTURE_ROOT, 'test', 'jwt-signer.mjs')).href);
  const jwksMod = await import(pathToFileURL(join(FIXTURE_ROOT, 'test', 'jwks-server.mjs')).href);
  const key = signerMod.createFixtureKey('cf-edge-anatomy-kid');
  const server = await jwksMod.startJwksServer({ port: 0, keys: [key] });
  return { key, server, signerMod, jwksUrl: server.url };
}

async function loadValidator() {
  return (await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'jwt-validator.mjs')).href)).createAccessValidator;
}

// TS-110 (US-8001): JWT validator validates a fixture-signed JWT and reduces principal onto request.auth.

test('JWT validator validates a fixture-signed JWT and reduces principal onto request auth (TC-110-jwt-validator-pass)', async () => {
  const { key, server, signerMod, jwksUrl } = await bootJwks();
  try {
    const createValidator = await loadValidator();
    const sink = [];
    const validator = createValidator({ env: { ACCESS_JWKS_URL: jwksUrl, ACCESS_AUDIENCE: FIXTURE_AUDIENCE }, eventSink: (r) => sink.push(r) });
    const jwt = signerMod.fixtureAccessJwt({ key, profile: { issuer: FIXTURE_ISSUER, audience: FIXTURE_AUDIENCE }, principal: { email: 'ada@example.com', sub: 'user:ada', groups: ['admins'] }, ttlSec: 60 });
    const req = new Request('https://cf-edge.test/protected', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
    const outcome = await validator.middleware(req);
    assert.equal(outcome.rejected, false, 'expected middleware to accept the fixture JWT');
    assert.equal(req.auth.email, 'ada@example.com');
    assert.equal(req.auth.sub, 'user:ada');
    assert.deepEqual(req.auth.groups, ['admins']);
    assert.equal(sink.length, 1);
    assert.equal(sink[0].outcome, 'validated');
    assert.deepEqual(Object.keys(sink[0]).sort(), ['email', 'outcome', 'path', 'timestamp']);
  } finally {
    await server.stop();
  }
});

// TS-111 (US-8002): JWT validator rejects missing, expired, mis-signed with metadata-only audit event.

test('JWT validator rejects missing expired and mis-signed with metadata-only audit event (TC-111-jwt-validator-reject)', async () => {
  const { key, server, signerMod, jwksUrl } = await bootJwks();
  try {
    const createValidator = await loadValidator();
    const allowed = ['email', 'outcome', 'path', 'timestamp'];

    // missing
    {
      const sink = [];
      const v = createValidator({ env: { ACCESS_JWKS_URL: jwksUrl, ACCESS_AUDIENCE: FIXTURE_AUDIENCE }, eventSink: (r) => sink.push(r) });
      const req = new Request('https://cf-edge.test/protected');
      const o = await v.middleware(req);
      assert.equal(o.rejected, true);
      assert.equal(o.response.status, 401);
      assert.equal(sink[0].outcome, 'missing');
      assert.deepEqual(Object.keys(sink[0]).sort(), allowed);
    }
    // expired via simulate
    {
      const sink = [];
      const v = createValidator({ env: { ACCESS_JWKS_URL: jwksUrl, ACCESS_AUDIENCE: FIXTURE_AUDIENCE }, eventSink: (r) => sink.push(r) });
      const jwt = signerMod.fixtureAccessJwt({ key, profile: { issuer: FIXTURE_ISSUER, audience: FIXTURE_AUDIENCE }, principal: { email: 'g@example.com', sub: 'user:g' }, ttlSec: 60 });
      const req = new Request('https://cf-edge.test/protected', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
      const o = await v.middleware(req, { SIMULATE_EXPIRED_JWT: true });
      assert.equal(o.rejected, true);
      assert.equal(sink[0].outcome, 'expired');
      assert.deepEqual(Object.keys(sink[0]).sort(), allowed);
    }
    // mis-signed
    {
      const sink = [];
      const v = createValidator({ env: { ACCESS_JWKS_URL: jwksUrl, ACCESS_AUDIENCE: FIXTURE_AUDIENCE }, eventSink: (r) => sink.push(r) });
      const wrongKey = signerMod.createFixtureKey(key.kid);
      const jwt = signerMod.fixtureAccessJwt({ key: wrongKey, profile: { issuer: FIXTURE_ISSUER, audience: FIXTURE_AUDIENCE }, principal: { email: 'e@example.com', sub: 'user:e' }, ttlSec: 60 });
      const req = new Request('https://cf-edge.test/protected', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
      const o = await v.middleware(req);
      assert.equal(o.rejected, true);
      assert.equal(sink[0].outcome, 'invalid');
      assert.deepEqual(Object.keys(sink[0]).sort(), allowed);
    }
  } finally {
    await server.stop();
  }
});

// TS-112 (US-8003): jwt-validator.mjs is the sole reader of Cf-Access-Jwt-Assertion in the fixture source tree.

test('jwt-validator mjs is the sole reader of the Cf-Access-Jwt-Assertion header in the fixture source tree (TC-112-sole-reader-boundary)', async () => {
  const srcDir = join(FIXTURE_ROOT, 'src');
  const files = await readdir(srcDir);
  const HEADER = 'Cf-Access-Jwt-Assertion';
  const hits = [];
  for (const f of files) {
    if (!/\.mjs$|\.js$/.test(f)) continue;
    const src = await readFile(join(srcDir, f), 'utf8');
    // Strip line comments and block comments (naive but sufficient for the fixture's small tree)
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    if (stripped.includes(HEADER)) hits.push(f);
  }
  assert.deepEqual(hits, ['jwt-validator.mjs'], `expected only jwt-validator.mjs to reference ${HEADER} in live source; found ${JSON.stringify(hits)}`);
});

// TS-113 (US-8101): blueprint.json elicits Access application host or self-hosted-app id plus policy shape enum.

test('blueprint json elicits Access application host or self-hosted id plus policy shape enum (TC-113-elicits-application-declaration)', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  const ids = new Set(bp.elicits.map((e) => e.id));
  assert.ok(ids.has('access-application-host'), 'access-application-host elicit missing');
  assert.ok(ids.has('access-selfhosted-app-id'), 'access-selfhosted-app-id elicit missing');
  assert.ok(ids.has('access-audience'), 'access-audience elicit missing');
  assert.ok(ids.has('access-jwks-url'), 'access-jwks-url elicit missing');
  const shape = bp.elicits.find((e) => e.id === 'access-policy-shape');
  assert.ok(shape, 'access-policy-shape elicit missing');
  assert.deepEqual(shape.options.sort(), ['email-domain', 'group-membership', 'service-token-only', 'service-token-plus-email-domain'].sort());
  assert.equal(shape.default, 'email-domain');
  assert.deepEqual(bp.capabilities, ['zeroTrustGate']);
});

// TS-114 (US-8201): guide carries dashboard walk-through and API alternative with vendor URL.

test('guide carries dashboard walk-through and API alternative with vendor URL (TC-114-guide-policy-issuance)', async () => {
  const g = await readFile(GUIDE, 'utf8');
  assert.match(g, /## Zero Trust dashboard walk-through/, 'guide missing dashboard walk-through heading');
  assert.match(g, /## API alternative/, 'guide missing API alternative heading');
  assert.match(g, /api\.cloudflare\.com\/client\/v4\/accounts\/\{account_id\}\/access\/apps\/\{app_id\}\/policies/, 'guide missing curl endpoint');
  assert.match(g, /https:\/\/developers\.cloudflare\.com\/cloudflare-one\/policies\/access\//, 'guide missing vendor URL citation');
  // Policy shape enum table
  assert.match(g, /email-domain/);
  assert.match(g, /service-token-only/);
  assert.match(g, /service-token-plus-email-domain/);
  assert.match(g, /group-membership/);
});

// TS-115 (US-8301): audit sink after 5 pass + 5 reject holds 10 metadata-only records with no forbidden substrings.

test('audit sink after 5 pass 5 reject holds 10 metadata-only records with no forbidden substrings (TC-115-audit-metadata-secrecy)', async () => {
  const { key, server, signerMod, jwksUrl } = await bootJwks();
  try {
    const createValidator = await loadValidator();
    const sink = [];
    const v = createValidator({ env: { ACCESS_JWKS_URL: jwksUrl, ACCESS_AUDIENCE: FIXTURE_AUDIENCE }, eventSink: (r) => sink.push(r) });
    const tokens = [];
    for (let i = 0; i < 5; i++) {
      const jwt = signerMod.fixtureAccessJwt({ key, profile: { issuer: FIXTURE_ISSUER, audience: FIXTURE_AUDIENCE }, principal: { email: `u${i}@example.com`, sub: `user:u${i}` }, ttlSec: 60 });
      tokens.push(jwt);
      await v.middleware(new Request(`https://cf-edge.test/pass/${i}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } }));
    }
    for (let i = 0; i < 5; i++) {
      await v.middleware(new Request(`https://cf-edge.test/reject/${i}`));
    }
    assert.equal(sink.length, 10);
    for (const r of sink) {
      assert.deepEqual(Object.keys(r).sort(), ['email', 'outcome', 'path', 'timestamp']);
    }
    const ser = JSON.stringify(sink);
    for (const jwt of tokens) {
      const [h, p, s] = jwt.split('.');
      for (const seg of [jwt, h, p, s]) {
        assert.ok(!ser.includes(seg), `forbidden JWT segment (len=${seg.length}) leaked into audit sink`);
      }
    }
    for (const header of ['Cf-Access-Jwt-Assertion', 'Authorization', 'CF-Access-Client-Id', 'CF-Access-Client-Secret']) {
      assert.ok(!ser.includes(header), `forbidden header name ${header} leaked into audit sink`);
    }
  } finally {
    await server.stop();
  }
});

// TS-116 (US-8401): break-glass bypass-service-auth pair authenticates and audits outcome=bypass with allowed keys.

test('break-glass bypass-service-auth pair authenticates and audits outcome bypass with allowed keys (TC-116-break-glass-bypass)', async () => {
  const { server, jwksUrl } = await bootJwks();
  try {
    const createValidator = await loadValidator();
    const sink = [];
    const bypass = { id: 'ci-token', secret: 's3cret' };
    const v = createValidator({ env: { ACCESS_JWKS_URL: jwksUrl, ACCESS_AUDIENCE: FIXTURE_AUDIENCE }, eventSink: (r) => sink.push(r), bypassServiceAuth: bypass });
    const req = new Request('https://cf-edge.test/ci', {
      headers: {
        'CF-Access-Client-Id': bypass.id,
        'CF-Access-Client-Secret': bypass.secret,
      },
    });
    const outcome = await v.middleware(req);
    assert.equal(outcome.rejected, false);
    assert.equal(req.auth.email, `service:${bypass.id}`);
    assert.equal(sink.length, 1);
    assert.equal(sink[0].outcome, 'bypass');
    assert.deepEqual(Object.keys(sink[0]).sort(), ['email', 'outcome', 'path', 'timestamp']);
  } finally {
    await server.stop();
  }
});

// Fixture server helpers for the admin-console gate-surface tests

async function bootAdminConsoleFixture() {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ADMIN_FIXTURE_ROOT,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let url = null;
  let stderrTail = '';
  proc.stdout.on('data', (buf) => {
    const s = buf.toString();
    const m = s.match(/LISTENING\s+(\d+)/);
    if (m && !url) url = `http://127.0.0.1:${m[1]}`;
  });
  proc.stderr.on('data', (b) => { stderrTail = (stderrTail + b.toString()).slice(-2000); });
  const start = Date.now();
  while (!url && Date.now() - start < 8000) {
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!url) {
    try { proc.kill('SIGTERM'); } catch (_e) {}
    throw new Error(`admin-console fixture did not bind: ${stderrTail}`);
  }
  return { proc, url, stop: () => new Promise((r) => { try { proc.kill('SIGTERM'); } catch (_e) {} setTimeout(r, 200); }) };
}

// TS-117 (US-8501): extended admin-console pack fixture flips sign-in surface per applied capability set.

test('extended admin-console pack fixture flips sign-in surface per applied capability set (TC-117-admin-console-gate-surface)', async () => {
  const { url, stop } = await bootAdminConsoleFixture();
  try {
    // Gated combination: fixture refuses unauthenticated gated
    // requests with HTTP 403 (AC-21815-2), so the probe supplies a
    // fixture Authorization header to observe the access-gated
    // surface (AC-21815-1).
    const gated = await fetch(`${url}/admin/sign-in?caps=principalDirectory,roleModel,auditLog,zeroTrustGate`, {
      headers: { Authorization: 'Principal probe-signin@example.test' },
    });
    const gatedBody = await gated.text();
    assert.equal(gated.status, 200);
    assert.ok(gatedBody.includes('data-surface="access-gated"'));
    assert.ok(!gatedBody.includes('data-surface="local-login"'));
    assert.ok(gatedBody.includes('data-role="principal-read"'));

    const local = await fetch(`${url}/admin/sign-in?caps=principalDirectory,roleModel,auditLog`);
    const localBody = await local.text();
    assert.equal(local.status, 200);
    assert.ok(localBody.includes('data-surface="local-login"'));
    assert.ok(!localBody.includes('data-surface="access-gated"'));
  } finally {
    await stop();
  }
});

// TS-118 (US-8601): admin-console v1.1.0 pack check AC-21815-1 fires on gated caps combination.

test('admin-console v1_1_0 pack check AC-21815-1 fires on gated caps combination (TC-118-admin-console-gated-pack-check)', async () => {
  // Load the pack module and locate the AC-21815-1 check
  const pack = (await import(pathToFileURL(join(ADMIN_BLUEPRINT_ROOT, 'probe-packs', 'application-admin-console.pack.mjs')).href)).default;
  assert.equal(pack.version, '1.1.0');
  const check = pack.checks.find((c) => c.id === 'AC-21815-1');
  assert.ok(check, 'AC-21815-1 check missing from application-admin-console.pack.mjs');
  // The check.appliesTo predicate reads an applied-sidecar; simulate a gated project
  // by writing a temporary sidecar under a scratch projectRoot.
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const scratch = await mkdtemp(join(tmpdir(), 'cf-edge-anatomy-'));
  await mkdir(join(scratch, 'rcf', 'blueprints'), { recursive: true });
  await writeFile(join(scratch, 'rcf', 'blueprints', 'application-admin-console.applied.json'), JSON.stringify({ appliedCapabilities: ['principalDirectory', 'zeroTrustGate'] }), 'utf8');
  try {
    const applicable = await check.appliesTo({ projectRoot: scratch });
    assert.equal(applicable, true, 'AC-21815-1 should applyTo a project with zeroTrustGate applied');
    // Drive the check against the fixture with a stubbed browser (Playwright is not
    // available here; the pack.run body reads DOM via browser.evaluate -- we invoke
    // it against the fixture via a minimal stub that mirrors the pack browser API
    // for what the check needs).
    const { url, stop } = await bootAdminConsoleFixture();
    try {
      const stubBrowser = {
        async goto(target) {
          // Fixture refuses unauthenticated gated requests with HTTP
          // 403 (AC-21815-2); when the target URL carries the
          // zeroTrustGate capability, supply a fixture Authorization
          // header so the pack check can observe the access-gated
          // surface.
          const headers = String(target).includes('zeroTrustGate')
            ? { Authorization: 'Principal probe-signin@example.test' }
            : undefined;
          this._body = await (await fetch(target, headers ? { headers } : undefined)).text();
        },
        async evaluate(fn) {
          // Parse the DOM shape the check reads via a lightweight matcher.
          const body = this._body ?? '';
          const gatedPresent = body.includes('data-surface="access-gated"');
          const localPresent = body.includes('data-surface="local-login"');
          const principalReadPresent = body.includes('data-role="principal-read"');
          const textMatch = body.match(/data-role="principal-read"[^>]*>([^<]+)</);
          const principalText = textMatch ? textMatch[1].trim() : null;
          return { gatedPresent, localPresent, principalReadPresent, principalText };
        },
      };
      const result = await check.run({ browser: stubBrowser, runtimeUrl: url });
      assert.equal(result.verdict, 'pass', `AC-21815-1 verdict was ${result.verdict}: ${result.detail}`);
    } finally {
      await stop();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

// TS-119 (US-8602): admin-console v1.1.0 renders local-login surface on the non-gated caps combination.

test('admin-console v1_1_0 renders local-login surface on the non-gated caps combination (TC-119-admin-console-fallback)', async () => {
  const { url, stop } = await bootAdminConsoleFixture();
  try {
    const res = await fetch(`${url}/admin/sign-in?caps=principalDirectory,roleModel,auditLog`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(body.includes('data-surface="local-login"'));
    assert.ok(!body.includes('data-surface="access-gated"'));
    assert.ok(body.includes('data-role="local-login-form"'));
  } finally {
    await stop();
  }
});

// TS-119 (US-8502): real-account-gated-url probe records accountBoundSkipped when env vars absent.

test('real-account-gated-url probe records accountBoundSkipped when env vars absent (TC-119-real-account-gated-url-skipped)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-gated-url.mjs')).href)).default;
  // Force the skip branch (unset the env vars for this call).
  const saved = { has: process.env.CI_HAS_CLOUDFLARE_ACCOUNT, host: process.env.CF_ACCESS_HOST };
  delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  delete process.env.CF_ACCESS_HOST;
  try {
    const out = await runProbe();
    const r = out.results[0];
    assert.equal(r.verdict, 'pass');
    assert.equal(r.accountBoundSkipped, true);
  } finally {
    if (saved.has !== undefined) process.env.CI_HAS_CLOUDFLARE_ACCOUNT = saved.has;
    if (saved.host !== undefined) process.env.CF_ACCESS_HOST = saved.host;
  }
});
