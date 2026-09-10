// Anatomy + shape + probe + fixture + shelf-doc test for the
// edge-cloudflare-tunnel v1.0.0 blueprint (T-3 of the Hetzner round 7
// spec, 2026-09-07 section 5.6). Covers TS-160 (eight TCs) on the T-3
// repo chain slice:
// TC-160-connector-shape-variants-shipped,
// TC-160-real-account-connector-healthy-declared-and-skipped-shape,
// TC-160-manifest-schema-validate-refuses-invalid,
// TC-160-cloudflared-config-lint-passes-and-refuses-invalid-ingress,
// TC-160-no-public-origin-port-refused,
// TC-160-aud-presence-flip-on-both-fixture-variants,
// TC-160-aud-presence-check-refuses-on-drift,
// TC-160-credentials-discipline-and-event-secrecy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'edge-cloudflare-tunnel');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'hetzner-throwaway-server');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const CANONICAL = join(FIXTURE_ROOT, 'cloudflared');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'edge-cloudflare-tunnel.md');
const OWN_TOPICS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const AUTHORING = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

async function runProbe(name, { env = {}, fixtureRoot } = {}) {
  const modUrl = pathToFileURL(join(PROBES_DIR, `${name}.mjs`)).href + '?ts=' + Date.now() + Math.random();
  const mod = await import(modUrl);
  const saved = {};
  const envFinal = { ...env };
  if (fixtureRoot) envFinal.RCF_LITE_T3_FIXTURE_ROOT = fixtureRoot;
  else if (!('RCF_LITE_T3_FIXTURE_ROOT' in envFinal)) envFinal.RCF_LITE_T3_FIXTURE_ROOT = CANONICAL;
  for (const [k, v] of Object.entries(envFinal)) { saved[k] = process.env[k]; process.env[k] = v; }
  try {
    return await mod.default();
  } finally {
    for (const [k] of Object.entries(envFinal)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

async function scratchFixture() {
  const scratch = await mkdtemp(join(tmpdir(), 'rcf-lite-t3-anatomy-'));
  await cp(CANONICAL, scratch, { recursive: true });
  return scratch;
}

// TC-160-connector-shape-variants-shipped (AC-13001-1 / AC-tunnel-connectorShape):
// blueprint declares tunnelBridge; both runtime variants ship under
// cloudflared/{compose-service,systemd-unit}/ with the expected shapes.
test('T-3 edge-cloudflare-tunnel AC-13001-1 connector shape variants shipped (TC-160-connector-shape-variants-shipped)', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'edge-cloudflare-tunnel');
  assert.equal(bp.version, '1.1.0');
  assert.equal(bp.category, 'edge');
  assert.deepEqual(bp.capabilities, ['tunnelBridge']);
  const compose = await readFile(join(CANONICAL, 'compose-service/compose-fragment.yaml'), 'utf8');
  assert.match(compose, /^\s{2}cloudflared:\s*$/m, 'compose-service variant defines cloudflared service');
  assert.match(compose, /- web-net/, 'cloudflared service joins web-net');
  assert.doesNotMatch(compose, /ports:\s*\n\s*-\s*\d+/, 'cloudflared service exposes no host ports');
  const unit = await readFile(join(CANONICAL, 'systemd-unit/cloudflared.service'), 'utf8');
  assert.match(unit, /\[Service\]/, 'systemd unit file present');
  assert.match(unit, /ExecStart=\/usr\/bin\/cloudflared/, 'systemd unit invokes cloudflared binary');
});

// TC-160-real-account-connector-healthy-declared-and-skipped-shape (AC-13002-1):
// probe declares accountBound true and records accountBoundSkipped when env is unset.
test('T-3 edge-cloudflare-tunnel AC-13002-1 real-account-connector-healthy declared and skipped shape (TC-160-real-account-connector-healthy-declared-and-skipped-shape)', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-connector-healthy.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  assert.ok(mod.anchorAcIds.includes('AC-tunnel-connectorHealthy'));
  const out = await runProbe('real-account-connector-healthy', { env: { CI_HAS_CLOUDFLARE_ACCOUNT: 'false', CI_HAS_HETZNER_ACCOUNT: 'false' } });
  assert.ok(out.results.some((r) => r.accountBoundSkipped === true));
});

// TC-160-manifest-schema-validate-refuses-invalid (AC-13101-1):
// manifest-schema-validate passes on canonical; fails on each of three mutations.
test('T-3 edge-cloudflare-tunnel AC-13101-1 manifest schema validate refuses invalid (TC-160-manifest-schema-validate-refuses-invalid)', async () => {
  const clean = await runProbe('manifest-schema-validate');
  assert.ok(!clean.results.some((r) => r.verdict === 'fail'), 'canonical fixture passes');
  // Mutation 1: invalid tunnel id.
  const s1 = await scratchFixture();
  {
    const target = join(s1, 'compose-service/cloudflare/tunnels/public-hostname.yaml');
    let text = await readFile(target, 'utf8');
    text = text.replace(/^tunnel: .*/m, 'tunnel: NOT-A-UUID');
    await writeFile(target, text, 'utf8');
  }
  const r1 = await runProbe('manifest-schema-validate', { fixtureRoot: s1 });
  assert.ok(r1.results.some((r) => r.verdict === 'fail' && /NOT-A-UUID/.test(r.detail)), 'invalid tunnel id fails');
  // Mutation 2: credentials inlined instead of secretRef.
  const s2 = await scratchFixture();
  {
    const target = join(s2, 'compose-service/cloudflare/tunnels/public-hostname.yaml');
    let text = await readFile(target, 'utf8');
    text = text.replace(/^credentialsFile:\n  secretRef: .*/m, 'credentialsFile:\n  AccountTag: 00000000000000000000000000000000\n  TunnelSecret: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n  TunnelID: 00000000-0000-4000-8000-000000000c01');
    await writeFile(target, text, 'utf8');
  }
  const r2 = await runProbe('manifest-schema-validate', { fixtureRoot: s2 });
  assert.ok(r2.results.some((r) => r.verdict === 'fail' && /secretRef/.test(r.detail)), 'inlined credentials fails');
  // Mutation 3: missing catch-all.
  const s3 = await scratchFixture();
  {
    const target = join(s3, 'compose-service/cloudflare/tunnels/public-hostname.yaml');
    let text = await readFile(target, 'utf8');
    text = text.replace(/^\s*- service: http_status:404\n?/m, '');
    await writeFile(target, text, 'utf8');
  }
  const r3 = await runProbe('manifest-schema-validate', { fixtureRoot: s3 });
  assert.ok(r3.results.some((r) => r.verdict === 'fail' && /catch-all/.test(r.detail)), 'missing catch-all fails');
});

// TC-160-cloudflared-config-lint-passes-and-refuses-invalid-ingress (AC-13102-1):
// cloudflared-config-lint passes on canonical; fails when ingress URL is invalid.
test('T-3 edge-cloudflare-tunnel AC-13102-1 cloudflared-config-lint passes and refuses invalid ingress (TC-160-cloudflared-config-lint-passes-and-refuses-invalid-ingress)', async () => {
  const clean = await runProbe('cloudflared-config-lint');
  // pass or warn (docker/cloudflared may be absent on some review machines)
  const hasFail = clean.results.some((r) => r.verdict === 'fail');
  assert.ok(!hasFail, 'canonical fixture does not fail');
  // Skip the mutation half of the check if the engine did not run at all.
  const engineRan = clean.results.some((r) => r.verdict === 'pass' || r.verdict === 'fail');
  if (!engineRan) return;
  const s = await scratchFixture();
  const target = join(s, 'compose-service/cloudflare/tunnels/public-hostname.yaml');
  let text = await readFile(target, 'utf8');
  text = text.replace(/service: http:\/\/web:8080/, 'service: bogus-scheme-here');
  await writeFile(target, text, 'utf8');
  const r = await runProbe('cloudflared-config-lint', { fixtureRoot: s });
  assert.ok(r.results.some((rr) => rr.verdict === 'fail' && /bogus-scheme-here|invalid/.test(rr.detail)), 'invalid ingress URL fails');
});

// TC-160-no-public-origin-port-refused (AC-13201-1):
// manifest-schema-validate refuses when ingress binds to host public interface.
test('T-3 edge-cloudflare-tunnel AC-13201-1 no public origin port refused (TC-160-no-public-origin-port-refused)', async () => {
  const s = await scratchFixture();
  const target = join(s, 'compose-service/cloudflare/tunnels/public-hostname.yaml');
  let text = await readFile(target, 'utf8');
  text = text.replace(/service: http:\/\/web:8080/, 'service: http://0.0.0.0:80');
  await writeFile(target, text, 'utf8');
  const r = await runProbe('manifest-schema-validate', { fixtureRoot: s });
  assert.ok(r.results.some((rr) => rr.verdict === 'fail' && /0\.0\.0\.0|public interface/.test(rr.detail)), 'origin port open refused');
});

// TC-160-aud-presence-flip-on-both-fixture-variants (AC-13301-1):
// aud-presence-check reads sidecars and asserts AUD attach flips correctly.
test('T-3 edge-cloudflare-tunnel AC-13301-1 aud-presence-check flips on both fixture variants (TC-160-aud-presence-flip-on-both-fixture-variants)', async () => {
  const r = await runProbe('aud-presence-check');
  assert.ok(!r.results.some((rr) => rr.verdict === 'fail'), 'canonical fixture passes');
  // Both variants should surface a per-runtime pass line for both modes.
  const composeGated = r.results.find((rr) => /compose-service\/access-gated/.test(rr.detail));
  const composePublic = r.results.find((rr) => /compose-service\/public-hostname/.test(rr.detail));
  const systemdGated = r.results.find((rr) => /systemd-unit\/access-gated/.test(rr.detail));
  const systemdPublic = r.results.find((rr) => /systemd-unit\/public-hostname/.test(rr.detail));
  assert.ok(composeGated && composePublic && systemdGated && systemdPublic, 'all four runtime x mode lines surfaced');
});

// TC-160-aud-presence-check-refuses-on-drift (AC-13302-1):
// aud-presence-check refuses when the gated variant drifts to omit AUD.
test('T-3 edge-cloudflare-tunnel AC-13302-1 aud-presence-check refuses on drift (TC-160-aud-presence-check-refuses-on-drift)', async () => {
  const s = await scratchFixture();
  const target = join(s, 'compose-service/cloudflare/tunnels/access-gated.yaml');
  let text = await readFile(target, 'utf8');
  text = text.replace(/\n    originRequest:\n      access:\n        aud: [^\n]+\n        teamName: [^\n]+\n        required: [^\n]+/, '');
  await writeFile(target, text, 'utf8');
  const r = await runProbe('aud-presence-check', { fixtureRoot: s });
  assert.ok(r.results.some((rr) => rr.verdict === 'fail' && /drift|AUD|missing/.test(rr.detail)), 'gated drift refuses');
});

// TC-160-credentials-discipline-and-event-secrecy (AC-13401-1):
// credentials placeholder documents 0o400 + secretRef; event-secrecy scan
// passes on canonical and FAILS under a fixture-side event-leak mutation.
test('T-3 edge-cloudflare-tunnel AC-13401-1 credentials discipline and event-secrecy scan (TC-160-credentials-discipline-and-event-secrecy)', async () => {
  const readmeText = await readFile(README, 'utf8');
  assert.match(readmeText, /mode 0o400/i, 'README documents 0o400 host-mode discipline');
  assert.match(readmeText, /secretRef/, 'README documents secretRef pattern');
  const guideText = await readFile(GUIDE, 'utf8');
  assert.match(guideText, /grep across the working tree/i, 'guide documents grep-refuse');
  // Mutation: seed a _leakedEvent object into the credentials placeholder.
  const s = await scratchFixture();
  const credPath = join(s, 'compose-service/credentials/probe.json.example');
  const cred = JSON.parse(await readFile(credPath, 'utf8'));
  cred._leakedEvent = { boundTunnelSecret: cred.TunnelSecret };
  await writeFile(credPath, JSON.stringify(cred, null, 2) + '\n', 'utf8');
  const r = await runProbe('manifest-schema-validate', { fixtureRoot: s });
  assert.ok(r.results.some((rr) => rr.verdict === 'fail' && /event-secrecy scan FAILED/i.test(rr.detail)), 'event-secrecy leak refuses');
});

// H-2 chain slice coverage.

// TS-183 / TC-183-tunnel-connector-healthy-real-driver (AC-15301-1):
// real-account-connector-healthy provisions the throwaway hetzner server via the
// cf-edge shim and asserts healthy connector count via cloudflared tunnel info;
// a fixture-step failure fails the driver with a pointer, never warn.
test('H-2 tunnel AC-15301-1 real-account-connector-healthy asserts healthy connector count via cloudflared tunnel info', async () => {
  const mod = await import(pathToFileURL(join(PROBES_DIR, 'real-account-connector-healthy.mjs')).href);
  assert.equal(mod.accountBound, true, 'real-account-connector-healthy must declare accountBound true');
  assert.ok(mod.anchorAcIds.includes('AC-tunnel-connectorHealthy'), 'anchorAcIds must include AC-tunnel-connectorHealthy');
  // Env-absent branch: pass-with-skip shape preserved.
  const out = await runProbe('real-account-connector-healthy', { env: { CI_HAS_CLOUDFLARE_ACCOUNT: 'false', CI_HAS_HETZNER_ACCOUNT: 'false' } });
  assert.ok(out.results.some((r) => r.accountBoundSkipped === true), 'env-absent branch records accountBoundSkipped true on the AC-tunnel-connectorHealthy result');
  // Fixture-fail branch via the shim synthetic mode: fail with fixture-step pointer, never warn.
  const failOut = await runProbe('real-account-connector-healthy', {
    env: {
      CI_HAS_CLOUDFLARE_ACCOUNT: 'true',
      CI_HAS_HETZNER_ACCOUNT: 'true',
      H2_CF_TUNNEL_SHIM_MODE: 'synthetic-provision-fail',
    },
  });
  const failResult = failOut.results.find((r) => r.anchorAcId === 'AC-tunnel-connectorHealthy');
  assert.ok(failResult, 'account-set branch emits an AC-tunnel-connectorHealthy result');
  assert.equal(failResult.verdict, 'fail', `fixture-fail branch must return fail (never warn); observed=${failResult.verdict} detail=${failResult.detail}`);
  assert.match(failResult.detail, /fixture|provision|hetzner|cf-edge shim/i, 'fail detail names the fixture-step / shim pointer');
});

// TS-183 / TC-183-tunnel-hostname-routes-real-driver (AC-15301-2):
// real-account-tunnel-hostname-routes drives undici for the public-hostname
// sub-case and (with Access) a two-identity JWT check; amendment-4 gating means
// the AUD sub-case activates only when CI_HAS_CLOUDFLARE_ACCESS is also set.
test('H-2 tunnel AC-15301-2 real-account-tunnel-hostname-routes drives undici and (with Access) two-identity JWT', async () => {
  const mod = await import(pathToFileURL(join(PROBES_DIR, 'real-account-tunnel-hostname-routes.mjs')).href);
  assert.equal(mod.accountBound, true, 'real-account-tunnel-hostname-routes must declare accountBound true');
  assert.ok(mod.anchorAcIds.includes('AC-tunnel-hostnameRoutes'), 'anchorAcIds must include AC-tunnel-hostnameRoutes');
  assert.ok(mod.anchorAcIds.includes('AC-tunnel-accessGated'), 'anchorAcIds must include AC-tunnel-accessGated');
  // Env-absent branch: pass-with-skip on both sub-cases.
  const skipOut = await runProbe('real-account-tunnel-hostname-routes', { env: { CI_HAS_CLOUDFLARE_ACCOUNT: 'false', CI_HAS_HETZNER_ACCOUNT: 'false', CI_HAS_CLOUDFLARE_ACCESS: 'false' } });
  const skipHost = skipOut.results.find((r) => r.anchorAcId === 'AC-tunnel-hostnameRoutes');
  const skipAud = skipOut.results.find((r) => r.anchorAcId === 'AC-tunnel-accessGated');
  assert.ok(skipHost, 'env-absent emits an AC-tunnel-hostnameRoutes result');
  assert.equal(skipHost.accountBoundSkipped, true, 'env-absent branch records accountBoundSkipped on public sub-case');
  assert.ok(skipAud, 'env-absent emits an AC-tunnel-accessGated result');
  assert.equal(skipAud.accountBoundSkipped, true, 'env-absent branch records accountBoundSkipped on AUD sub-case');
  // Account-set-no-Access branch: public sub-case activates via shim public-200; AUD sub-case stays pass-with-skip.
  const partialOut = await runProbe('real-account-tunnel-hostname-routes', {
    env: {
      CI_HAS_CLOUDFLARE_ACCOUNT: 'true',
      CI_HAS_HETZNER_ACCOUNT: 'true',
      CI_HAS_CLOUDFLARE_ACCESS: 'false',
      H2_CF_TUNNEL_HOSTNAME_SHIM_MODE: 'synthetic-public-200',
    },
  });
  const partialAud = partialOut.results.find((r) => r.anchorAcId === 'AC-tunnel-accessGated');
  assert.ok(partialAud, 'account-set-no-Access branch still emits an AC-tunnel-accessGated result');
  assert.equal(partialAud.accountBoundSkipped, true, 'AUD sub-case stays pass-with-skip until CI_HAS_CLOUDFLARE_ACCESS is also set (amendment-4 gating)');
});

// TS-183 / TC-183-manifest-schema-fail-with-pointer (AC-15301-3):
// manifest-schema-validate returns fail (not warn) with a fixture-setup pointer
// when the credentials placeholder is missing; C3 removed the warn branch.
test('H-2 tunnel AC-15301-3 manifest-schema-validate fails with fixture-setup pointer when credentials placeholder is missing', async () => {
  const s = await scratchFixture();
  // Remove the credentials placeholder on both runtime variants so the probe
  // hits the read-failed branch. C3 converted the earlier warn return here to a
  // fail with a fixture-setup pointer.
  const { unlink } = await import('node:fs/promises');
  for (const variant of ['compose-service', 'systemd-unit']) {
    const p = join(s, variant, 'credentials/probe.json.example');
    try { await unlink(p); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  const r = await runProbe('manifest-schema-validate', { fixtureRoot: s });
  assert.ok(r.results && r.results.length > 0, 'probe emits at least one result on the scratch fixture');
  const anyFailWithPointer = r.results.some((rr) =>
    rr.verdict === 'fail'
    && /credentials placeholder read failed/i.test(rr.detail)
    && /fixture setup step/i.test(rr.detail)
  );
  assert.ok(anyFailWithPointer, `expected at least one fail result naming the credentials placeholder read failure and the fixture-setup pointer; observed=${JSON.stringify(r.results.map((rr) => ({ ac: rr.anchorAcId, verdict: rr.verdict, detail: rr.detail && rr.detail.slice(0, 220) })))}`);
  // Prove the removed warn shape is not reachable: no result carries verdict warn
  // paired with a credentials-placeholder-read message.
  const anyWarnRead = r.results.some((rr) => rr.verdict === 'warn' && /credentials placeholder/i.test(rr.detail));
  assert.equal(anyWarnRead, false, 'no result should return warn for the credentials-placeholder-read branch after C3');
});
