// Anatomy + shape + probe + fixture + shelf-doc test for the
// edge-cloudflare-turnstile v1.0.0 blueprint (T-5 of the Cloudflare
// round 6 spec, 2026-09-06 section 5.5). Covers TS-120..127 on the
// T-5 repo chain slice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'edge-cloudflare-turnstile');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-edge-cloudflare-turnstile');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const PACK_PATH = join(BLUEPRINT_ROOT, 'probe-packs', 'edge-cloudflare-turnstile.pack.mjs');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'edge-cloudflare-turnstile.md');
const OWN_TOPICS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const AUTHORING = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

async function bootFixture(env = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: FIXTURE_ROOT,
      env: { ...process.env, PORT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const to = setTimeout(() => rejectP(new Error('fixture boot timeout')), 8000);
    child.stdout.on('data', (d) => {
      buf += String(d);
      const m = buf.match(/LISTENING (\d+)/);
      if (m) { clearTimeout(to); resolveP({ child, url: `http://127.0.0.1:${m[1]}` }); }
    });
    child.stderr.on('data', (d) => { buf += String(d); });
    child.on('exit', (c) => { clearTimeout(to); rejectP(new Error(`fixture exited: ${c} ${buf}`)); });
  });
}

async function postForm(url, path, fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
  const resp = await fetch(`${url}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: resp.status, text, json };
}

// TS-120 (US-9001): widget mount fixture renders the Turnstile iframe from Cloudflare origin only and populates the token on submit.
test('widget mount fixture renders the Turnstile iframe from Cloudflare origin only and populates the token on submit (TC-120-widget-mount-pass)', async () => {
  const fx = await bootFixture();
  try {
    const resp = await fetch(`${fx.url}/?sitekey=pass`);
    assert.equal(resp.status, 200);
    const body = await resp.text();
    assert.ok(body.includes('data-role="turnstile-widget"'), 'Turnstile widget div present');
    assert.ok(body.includes('data-sitekey="1x00000000000000000000AA"'), 'always-pass sitekey applied');
    assert.ok(body.includes('https://challenges.cloudflare.com/turnstile/v0/api.js'), 'Cloudflare Turnstile JS injected from Cloudflare origin');
    // No third-party script src on default load.
    const scriptSrcs = [...body.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    const thirdParty = scriptSrcs.filter((s) => !s.startsWith('https://challenges.cloudflare.com'));
    assert.deepEqual(thirdParty, [], 'no third-party script src on default load; scriptSrcs=' + JSON.stringify(scriptSrcs));
    // With ?break=other-origin, the third-party script pins.
    const body2 = await (await fetch(`${fx.url}/?sitekey=pass&break=other-origin`)).text();
    assert.ok(body2.includes('https://example.com/not-cloudflare.js'), 'break=other-origin injects a non-Cloudflare script');
  } finally { fx.child.kill('SIGTERM'); }
});

// TS-121 (US-9002): secret-shape scan reports env-shaped reads only and no inline literals in the pack fixture.
test('secret-shape scan reports env-shaped reads only and no inline literals in the pack fixture (TC-121-secret-shape-scan)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'secret-shape-scan.mjs')).href)).default;
  const out = await runProbe();
  assert.ok(Array.isArray(out.results) && out.results.length >= 2);
  for (const r of out.results) assert.equal(r.verdict, 'pass', 'secret-shape-scan result: ' + r.detail);
});

// TS-122 (US-9101): siteverify pass posts to Cloudflare with the always-pass secret and returns success true.
test('siteverify pass posts to Cloudflare with the always-pass secret and returns success true (TC-122-siteverify-pass)', async () => {
  const fx = await bootFixture({
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    TURNSTILE_SITEKEY: '1x00000000000000000000AA',
  });
  try {
    const r = await postForm(fx.url, '/api/submit', {
      email: 'reviewer@example.com',
      'turnstile-sitekey': '1x00000000000000000000AA',
      'cf-turnstile-response': 'ANATOMY-TEST-PASS-TOKEN',
    });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text}`);
    assert.deepEqual(r.json, { received: 'ok' });
  } finally { fx.child.kill('SIGTERM'); }
});

// TS-123 (US-9102): siteverify fail returns success false and event records carry sitekeyHash outcome and timestamp only.
test('siteverify fail returns success false and event records carry sitekeyHash outcome and timestamp only (TC-123-siteverify-fail-secrecy)', async () => {
  const fx = await bootFixture({
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    TURNSTILE_FAIL_SECRET: '2x0000000000000000000000000000000AA',
  });
  try {
    await fetch(`${fx.url}/api/events/clear`, { method: 'POST' });
    const r = await postForm(fx.url, '/api/submit?fail-secret=1', {
      email: 'reviewer@example.com',
      'turnstile-sitekey': '2x00000000000000000000AB',
      'cf-turnstile-response': 'ANATOMY-TEST-FAIL-TOKEN',
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.errorCode, 'turnstile.siteverify-failed');
    assert.ok(Array.isArray(r.json.errorCodes) && r.json.errorCodes.length > 0, 'errorCodes present');
    assert.ok(!r.text.includes('2x00000000000000000000AB'), 'refusal body does not carry the sitekey');
    const events = await (await fetch(`${fx.url}/api/events`)).json();
    assert.equal(events.length, 1, 'one event captured for the fail request');
    const allowed = ['outcome', 'sitekeyHash', 'timestamp'];
    assert.deepEqual(Object.keys(events[0]).sort(), allowed, 'event carries only metadata keys');
    assert.ok(!JSON.stringify(events).includes('ANATOMY-TEST-FAIL-TOKEN'), 'event does not carry the token');
    assert.ok(!JSON.stringify(events).includes('2x0000000000000000000000000000000AA'), 'event does not carry the secret');
  } finally { fx.child.kill('SIGTERM'); }
});

// TS-124 (US-9201): guard shape scan and pack-fixture missing-token submit refuses with 400.
test('guard shape scan and pack-fixture missing-token submit refuses with 400 (TC-124-guard-shape-refuse)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'guard-shape-scan.mjs')).href)).default;
  const out = await runProbe();
  for (const r of out.results) assert.equal(r.verdict, 'pass', 'guard-shape-scan result: ' + r.detail);
});

// TS-125 (US-9301): composition wire on the pack fixture magic-link mint reads the Turnstile guard first.
test('composition wire on the pack fixture magic-link mint reads the Turnstile guard first (TC-125-composition-wire)', async () => {
  const src = await readFile(join(FIXTURE_ROOT, 'server.js'), 'utf8');
  // The composition wire has two properties: (a) /api/magic-link is in GUARDED_SURFACES; (b) tokenRequiredGuard runs before any /api/magic-link mint action.
  assert.ok(src.includes('/api/magic-link'), 'magic-link route registered');
  assert.ok(src.includes('GUARDED_SURFACES.includes(url.pathname)'), 'surface-check gate present');
  // The guard call must appear textually before the magic-link mint 200 response.
  const guardIdx = src.indexOf('tokenRequiredGuard(req, res, params)');
  const magicMintIdx = src.indexOf("url.pathname === '/api/magic-link'");
  assert.ok(guardIdx >= 0 && magicMintIdx >= 0);
  assert.ok(guardIdx < magicMintIdx, 'guard call sits before the magic-link mint branch');
});

// TS-126 (US-9302): magic-link mint route refuses on missing token and on always-fail token.
test('magic-link mint route refuses on missing token and on always-fail token (TC-126-magic-link-guard-refuse)', async () => {
  const fx = await bootFixture({
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    TURNSTILE_FAIL_SECRET: '2x0000000000000000000000000000000AA',
  });
  try {
    // Missing-token branch.
    const rMissing = await postForm(fx.url, '/api/magic-link', {
      email: 'reviewer@example.com',
      'turnstile-sitekey': '1x00000000000000000000AA',
    });
    assert.equal(rMissing.status, 400);
    assert.equal(rMissing.json.errorCode, 'turnstile.token-missing');
    // Fail-secret branch (siteverify fail).
    const rFail = await postForm(fx.url, '/api/magic-link?fail-secret=1', {
      email: 'reviewer@example.com',
      'turnstile-sitekey': '2x00000000000000000000AB',
      'cf-turnstile-response': 'ANATOMY-MAGIC-LINK-FAIL',
    });
    assert.equal(rFail.status, 400);
    assert.equal(rFail.json.errorCode, 'turnstile.siteverify-failed');
  } finally { fx.child.kill('SIGTERM'); }
});

// TS-127 (US-9401): widget mode enum honours managed non-interactive and invisible on the pack fixture.
test('widget mode enum honours managed non-interactive and invisible on the pack fixture (TC-127-widget-mode-enum)', async () => {
  const fx = await bootFixture();
  try {
    for (const mode of ['managed', 'non-interactive', 'invisible']) {
      const resp = await fetch(`${fx.url}/?mode=${mode}`);
      assert.equal(resp.status, 200);
      const body = await resp.text();
      assert.ok(body.includes(`data-role="mode">${mode}<`), `mode ${mode} recorded on page`);
      assert.ok(body.includes('https://challenges.cloudflare.com/turnstile/v0/api.js'), 'Cloudflare Turnstile origin only');
      // Extract every script src attribute and check origins.
      const scriptSrcs = [...body.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
      const thirdParty = scriptSrcs.filter((s) => !s.startsWith('https://challenges.cloudflare.com'));
      assert.deepEqual(thirdParty, [], `no third-party script on mode=${mode}; scriptSrcs=${JSON.stringify(scriptSrcs)}`);
    }
    // Blueprint elicit shape: enum values match spec.
    const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
    const modeElicit = bp.elicits.find((e) => e.id === 'turnstile-widget-mode');
    assert.ok(modeElicit && modeElicit.kind === 'enum');
    assert.deepEqual(modeElicit.options, ['managed', 'non-interactive', 'invisible']);
    assert.equal(modeElicit.default, 'managed');
  } finally { fx.child.kill('SIGTERM'); }
});

// Shape checks: blueprint.json anatomy and shelf-doc anatomy.
test('blueprint.json anatomy: 5 REQ, 8 US, 3 TAC, 3 ADR; capabilities humanCheck; humanVerificationGate scope global on ADR-3601', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'edge-cloudflare-turnstile');
  assert.equal(bp.version, '1.1.0');
  assert.equal(bp.category, 'edge');
  assert.deepEqual(bp.capabilities, ['humanCheck']);
  const kinds = {};
  for (const c of bp.contributions) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  assert.deepEqual(kinds, { req: 5, us: 8, tac: 3, adr: 3 });
  const globalAdr = bp.contributions.find((c) => c.kind === 'adr' && c.scope === 'global');
  assert.ok(globalAdr, 'one scope-global ADR');
  assert.equal(globalAdr.topic, 'humanVerificationGate');
  assert.equal(globalAdr.standardsTraceClause, 'Cloudflare Turnstile siteverify endpoint documented shape');
  for (const c of bp.contributions.filter((c) => c.kind === 'adr')) {
    assert.ok(typeof c.standardsTraceClause === 'string' && c.standardsTraceClause.length > 0, 'ADR carries standardsTraceClause: ' + c.id);
  }
});

test('shelf-doc anatomy: README, CHANGELOG, guide, own topics.md, section 6a humanCheck row', async () => {
  assert.ok(existsSync(README) && (await readFile(README, 'utf8')).includes('humanVerificationGate'));
  assert.ok(existsSync(CHANGELOG) && (await readFile(CHANGELOG, 'utf8')).includes('## 1.0.0 (2026-09-07)'));
  assert.ok(existsSync(GUIDE) && (await readFile(GUIDE, 'utf8')).includes('siteverify'));
  const own = await readFile(OWN_TOPICS, 'utf8');
  assert.ok(own.includes('humanVerificationGate'));
  assert.ok(own.includes('| edge-cloudflare-turnstile | 35101-35899 | 36xx | shipped v1.0.0 | `humanVerificationGate` |'));
  const authoring = await readFile(AUTHORING, 'utf8');
  assert.ok(authoring.match(/^\| `humanCheck` /m), 'section 6a: humanCheck row present');
});

test('probe pack anatomy: 4 checks with expected ids; no appliesTo gate (always fires)', async () => {
  const pack = (await import(pathToFileURL(PACK_PATH).href)).default;
  assert.equal(pack.packName, 'edge-cloudflare-turnstile');
  assert.equal(pack.version, '1.0.0');
  assert.equal(pack.blueprintSlug, 'edge-cloudflare-turnstile');
  assert.equal(pack.appliesTo(), true, 'pack always applies');
  const ids = pack.checks.map((c) => c.id).sort();
  assert.deepEqual(ids, ['AC-turnstile-magicLinkGuard', 'AC-turnstile-serverVerified-fail', 'AC-turnstile-serverVerified-pass', 'AC-turnstile-widgetRendered']);
});
