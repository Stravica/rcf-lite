// Anatomy + apply + probe-pack test for the application-account-settings
// v1.0.0 shelf blueprint (visual round T-4, spec section 5.4).
// Covers TS-056.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';
import { readContributedAcIds } from '../../src/browser-verify/pack-loader.js';
import { validatePackModule } from '../../src/browser-verify/pack-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-account-settings');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-account-settings.pack.mjs');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-account-settings');
const MAGIC_LINK_BP = join(REPO_ROOT, 'blueprints', 'security-auth-magic-link');
const CLERK_BP = join(REPO_ROOT, 'blueprints', 'security-auth-clerk');
const KEYCLOAK_BP = join(REPO_ROOT, 'blueprints', 'security-auth-keycloak');
const OAUTH2_BP = join(REPO_ROOT, 'blueprints', 'security-auth-oauth2');
const LOGGING_BP = join(REPO_ROOT, 'blueprints', 'observability-logging');

test('blueprint.json declares 28 contributions with requiresAppliedCapabilities and elicits[] (TC-056-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-account-settings');
  assert.equal(doc.version, '1.2.7');
  assert.equal(doc.category, 'application');
  assert.equal(doc.providesRoles, undefined, 'providesRoles absent');
  assert.equal(doc.capabilities, undefined, 'capabilities absent');
  const reqs = doc.contributions.filter((c) => c.kind === 'req');
  const uss = doc.contributions.filter((c) => c.kind === 'us');
  const tacs = doc.contributions.filter((c) => c.kind === 'tac');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(reqs.length, 8);
  assert.equal(uss.length, 12);
  assert.equal(tacs.length, 4);
  assert.equal(adrs.length, 4);
  assert.equal(doc.contributions.length, 28);
  assert.deepEqual(doc.requiresAppliedCapabilities.capabilities, ['principalDirectory']);
  assert.equal(doc.requiresAppliedCapabilities.allowSkipFlag, 'allow-no-auth-yet');
  assert.equal(doc.requiresAppliedCapabilities.refusalMessageId, 'application-account-settings-bare-spa');
  const elicitIds = doc.elicits.map((e) => e.id).sort();
  assert.deepEqual(elicitIds, [
    'custom-auth-provides-credential-self-service',
    'custom-auth-provides-hosted-identity-ui',
    'custom-auth-provides-principal-directory',
    'custom-auth-provides-session-inventory',
    'hosted-identity-url',
    'reauth-window',
    'security-surface-shape',
    'theme-persistence',
  ]);
  const customAuthElicits = doc.elicits.filter((e) => typeof e.providesCapability === 'string');
  assert.equal(customAuthElicits.length, 4);
  for (const e of customAuthElicits) {
    assert.equal(e.kind, 'boolean');
    assert.ok(['principalDirectory', 'credentialSelfService', 'sessionInventory', 'hostedIdentityUi'].includes(e.providesCapability));
  }
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  // ADR contribution entries carry standardsTraceClause per spec 8a.2 / 8a.4.
  for (const adr of adrs) {
    assert.ok(typeof adr.standardsTraceClause === 'string' && adr.standardsTraceClause.length > 0, `${adr.id} missing standardsTraceClause`);
  }
});

test('applies cleanly on a magic-link project with 28 contributions and appliedCapabilities=[principalDirectory] (TC-056-applies-clean)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'acct-settings-magic-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree: t0 } = await walkTree({ projectRoot: scratch });
  const mlApply = await applyBlueprint({ projectRoot: scratch, tree: t0, source: MAGIC_LINK_BP });
  assert.equal(mlApply.applied, true, JSON.stringify(mlApply));
  const { tree: t1 } = await walkTree({ projectRoot: scratch });
  const acctApply = await applyBlueprint({ projectRoot: scratch, tree: t1, source: BLUEPRINT_ROOT });
  assert.equal(acctApply.applied, true, JSON.stringify(acctApply));
  assert.deepEqual(acctApply.appliedCapabilities, ['principalDirectory']);
  const sidecar = JSON.parse(await readFile(join(scratch, acctApply.sidecarPath), 'utf8'));
  assert.equal(sidecar.slug, 'application-account-settings');
  assert.equal(sidecar.version, '1.2.7');
});

test('apply refuses on bare SPA with the [application-account-settings-bare-spa] message; --allow-no-auth-yet applies with a scaffolding note (TC-056-apply-refusal-and-override)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'acct-settings-bare-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  const refuse = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(refuse.kind, 'requiresAppliedCapabilities');
  assert.match(refuse.message, /application-account-settings requires at least one applied security-auth-\*/);
  assert.match(refuse.message, /--allow-no-auth-yet/);

  const scratch2 = await mkdtemp(join(tmpdir(), 'acct-settings-override-'));
  await initProject({ projectRoot: scratch2, projectName: 'scratch' });
  const { tree: t2 } = await walkTree({ projectRoot: scratch2 });
  const override = await applyBlueprint({ projectRoot: scratch2, tree: t2, source: BLUEPRINT_ROOT, allowNoAuthYet: true });
  assert.equal(override.applied, true, JSON.stringify(override));
  const sidecar = JSON.parse(await readFile(join(scratch2, override.sidecarPath), 'utf8'));
  assert.equal(sidecar.allowNoAuthYet, true);
  assert.deepEqual(sidecar.appliedCapabilities, []);
  assert.ok(typeof sidecar.notes === 'string' && sidecar.notes.length > 0);
});

test('Q3 gate: security-surface-shape is silently gated when neither credentialSelfService nor hostedIdentityUi is applied; sidecar records no shape entry; TAC-2603 hosted-ui-bridge enforces the refusal at surface load (TC-056-q3-refusal)', async () => {
  // The Q3 refusal is enforced by the shell / hosted-UI bridge at surface
  // load time, not by the mechanism at apply time (the general elicits
  // mechanism silently drops gated-elicit answers to preserve backwards
  // compatibility with the round-3 T-5 TTY prompt seam). This test asserts
  // the silent-gate behaviour at apply, and the AC-25110-1 documented
  // mechanism-reach gap in the README names the surface-side enforcement.
  const scratch = await mkdtemp(join(tmpdir(), 'acct-settings-q3-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree: t0 } = await walkTree({ projectRoot: scratch });
  await applyBlueprint({ projectRoot: scratch, tree: t0, source: MAGIC_LINK_BP });
  const { tree: t1 } = await walkTree({ projectRoot: scratch });
  const q3 = await applyBlueprint({ projectRoot: scratch, tree: t1, source: BLUEPRINT_ROOT, answers: { 'security-surface-shape': 'self-service' } });
  assert.equal(q3.applied, true, JSON.stringify(q3));
  const sidecar = JSON.parse(await readFile(join(scratch, q3.sidecarPath), 'utf8'));
  assert.deepEqual(sidecar.appliedCapabilities, ['principalDirectory']);
  assert.equal(sidecar.appliedElicitations['security-surface-shape'], undefined, 'security-surface-shape gated silently on magic-link (no credentialSelfService, no hostedIdentityUi)');
});

test('every pack check id matches a contributed AC id; pack-level appliesTo names tacIds AND route; per-check appliesTo gates on the applied capability (TC-056-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-account-settings', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, [], `every check id must be a contributed AC id; missing: ${missing.join(', ')}`);
  const checkIds = validation.pack.checks.map((c) => c.id).sort();
  assert.deepEqual(checkIds, ['AC-25101-1', 'AC-25102-1', 'AC-25105-1', 'AC-25106-1', 'AC-25108-1']);
  for (const check of validation.pack.checks) {
    assert.ok(typeof check.description === 'string' && check.description.length > 0, `${check.id} missing description`);
    assert.equal(typeof check.appliesTo, 'function', `${check.id} declares its own appliesTo predicate`);
  }
  const packSrc = await readFile(PACK_ABS, 'utf8');
  assert.ok(!/`\$\{.*runtimeUrl\}/.test(packSrc), 'no template-literal URL concatenation in pack (use withUrl helper)');
  assert.ok(/withUrl\(runtimeUrl/.test(packSrc), 'pack uses withUrl(runtimeUrl, ...) helper');
  const packAppliesSrc = String(validation.pack.appliesTo);
  assert.ok(/tacIds/.test(packAppliesSrc), 'pack appliesTo references tacIds');
  assert.ok(/route|path/.test(packAppliesSrc), 'pack appliesTo references route/path');
});

async function pickPort() {
  return new Promise((resolveP) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolveP(port));
    });
  });
}

async function fixtureUp({ caps = 'principalDirectory', apps = '', shape = 'self-service', persist = 'spa-local-storage' } = {}) {
  const port = await pickPort();
  const proc = await import('node:child_process');
  const child = proc.spawn(process.execPath, [join(FIXTURE_ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), ACCOUNT_SETTINGS_CAPS: caps, ACCOUNT_SETTINGS_APPS: apps, ACCOUNT_SETTINGS_SECURITY_SHAPE: shape, ACCOUNT_SETTINGS_THEME_PERSIST: persist },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolveP, rejectP) => {
    const t = setTimeout(() => rejectP(new Error('server did not print LISTENING within 2s')), 2000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).startsWith('LISTENING ')) { clearTimeout(t); resolveP(); }
    });
    child.on('error', rejectP);
  });
  return { url: new URL(`http://127.0.0.1:${port}`), child };
}

async function get(url, path) {
  const res = await fetch(new URL(path, url));
  return res.text();
}

test('sample-app fixture serves the five conditional surfaces honestly (TC-056-fixture-and-switches)', async () => {
  // Case a: clerk-like (hostedIdentityUi + sessionInventory + notifications + spa)
  const { url, child } = await fixtureUp({ caps: 'principalDirectory,roleModel,sessionInventory,hostedIdentityUi', apps: 'application-notifications-in-app,application-spa', shape: 'hosted-link-out' });
  try {
    const shellHtml = await get(url, '/account');
    assert.ok(shellHtml.includes('role="tablist"'), 'shell nav is tablist');
    assert.ok(shellHtml.includes('data-tab-id="profile"'), 'profile tab present');
    assert.ok(shellHtml.includes('data-tab-id="security"'), 'security tab present when hostedIdentityUi applied');
    assert.ok(shellHtml.includes('data-tab-id="sessions"'), 'sessions tab present when sessionInventory applied');
    assert.ok(shellHtml.includes('data-tab-id="notifications"'), 'notifications tab present when notifications-in-app applied');
    assert.ok(shellHtml.includes('data-tab-id="theme"'), 'theme tab present when application-spa applied');
    const profileHtml = await get(url, '/account/profile');
    assert.ok(profileHtml.includes('autocomplete="name"'), 'profile name autocomplete present');
    assert.ok(profileHtml.includes('autocomplete="email"'), 'profile email autocomplete present');
    assert.ok(profileHtml.includes('autocomplete="bday"'), 'profile bday autocomplete present');
    assert.ok(profileHtml.includes('autocomplete="country"'), 'profile country autocomplete present');
    const secHtml = await get(url, '/account/security?security-surface-shape=hosted-link-out');
    assert.ok(secHtml.includes('data-role="hosted-link-out"'), 'hosted-link-out branch present');
    assert.ok(secHtml.includes('rel="noopener"'), 'hosted-link-out carries rel=noopener');
    const sessHtml = await get(url, '/account/sessions');
    assert.ok(sessHtml.match(/data-session-id="s1"/), 'sessions row s1');
    assert.ok(sessHtml.match(/data-current-session="true"/), 'current session marked');
    assert.ok(sessHtml.includes('data-column="device"'), 'device column present');
    assert.ok(sessHtml.includes('data-column="lastActive"'), 'lastActive column present');
    assert.ok(/<div\s+role="dialog"/.test(sessHtml), 'terminate dialog element present');
    assert.ok(sessHtml.includes('aria-modal="true"'), 'dialog is modal');
    const themeHtml = await get(url, '/account/theme');
    assert.ok(themeHtml.includes('role="radiogroup"'), 'theme radiogroup present');
    assert.ok(themeHtml.match(/name="theme".*value="light"/), 'theme light option');
    assert.ok(themeHtml.match(/name="theme".*value="dark"/), 'theme dark option');
    assert.ok(themeHtml.match(/name="theme".*value="system"/), 'theme system option');
  } finally {
    child.kill();
  }
});

test('sample-app fixture break switches surface the four defects (TC-056-negative-runs)', async () => {
  const { url, child } = await fixtureUp({ caps: 'principalDirectory,sessionInventory', apps: 'application-spa' });
  try {
    // leak-tab: security tab renders even though no security cap is declared
    const shellLeak = await get(url, '/account?break=leak-tab');
    assert.ok(shellLeak.includes('data-tab-id="security"'), 'break=leak-tab renders security tab (leak)');
    // no-autocomplete: profile autocomplete tokens missing
    const profileBroken = await get(url, '/account/profile?break=no-autocomplete');
    assert.ok(!profileBroken.includes('autocomplete="name"'), 'break=no-autocomplete drops name token');
    // no-dialog: sessions terminate has no dialog element (the CSS block still
    // contains a [role="dialog"] selector; the assertion targets the element tag)
    const sessionsBroken = await get(url, '/account/sessions?break=no-dialog');
    assert.ok(!/<div\s+role="dialog"/.test(sessionsBroken), 'break=no-dialog drops the terminate dialog element');
    // no-persist: theme surface data-persist mismatch and no persist script
    const themeBroken = await get(url, '/account/theme?break=no-persist');
    assert.ok(!themeBroken.includes('localStorage.setItem'), 'break=no-persist drops the theme persistence write');
  } finally {
    child.kill();
  }
});

test('four amended auth blueprints declare the ratified capability sets and observability-logging drops sessionInventory (TC-056-shelf-doc-consistency)', async () => {
  const clerk = JSON.parse(await readFile(join(CLERK_BP, 'blueprint.json'), 'utf8'));
  assert.equal(clerk.version, '1.5.1');
  assert.deepEqual([...clerk.capabilities].sort(), ['hostedIdentityUi', 'principalDirectory', 'roleModel', 'sessionInventory']);
  const kc = JSON.parse(await readFile(join(KEYCLOAK_BP, 'blueprint.json'), 'utf8'));
  assert.equal(kc.version, '1.4.1');
  assert.deepEqual([...kc.capabilities].sort(), ['credentialSelfService', 'principalDirectory', 'roleModel', 'sessionInventory']);
  const ox = JSON.parse(await readFile(join(OAUTH2_BP, 'blueprint.json'), 'utf8'));
  assert.equal(ox.version, '1.3.3');
  assert.deepEqual([...ox.capabilities].sort(), ['authorisationCodeFlow', 'credentialSelfService', 'hostedIdentityUi', 'principalDirectory', 'roleModel', 'sessionInventory']);
  const ml = JSON.parse(await readFile(join(MAGIC_LINK_BP, 'blueprint.json'), 'utf8'));
  assert.equal(ml.version, '1.2.4');
  assert.deepEqual(ml.capabilities, ['principalDirectory']);
  const log = JSON.parse(await readFile(join(LOGGING_BP, 'blueprint.json'), 'utf8'));
  // Hardening pass B4 (2026-09-09): observability-logging 1.3.0 removes
  // sessionInventory per section 7c criterion a (no requirement, story or
  // TAC responsibility ever backed it on this blueprint). Ownership stays
  // with security-auth-clerk TAC-1003 interfaces.sessionInventory. The
  // account-settings sessions surface reads the union across applied
  // blueprints (this shelf-wide test) unchanged.
  assert.equal(log.version, '1.3.1');
  assert.deepEqual([...log.capabilities].sort(), ['auditLog']);
  // Section 6a table extension carries the three new capability strings.
  const authoring = await readFile(join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md'), 'utf8');
  assert.match(authoring, /`credentialSelfService`/);
  assert.match(authoring, /`sessionInventory`/);
  assert.match(authoring, /`hostedIdentityUi`/);
  // README shelf table includes the new blueprint row.
  const topics = await readFile(join(BLUEPRINT_ROOT, 'docs', 'topics.md'), 'utf8');
  assert.match(topics, /application-account-settings \| 25101-25899/);
  // CHANGELOG entry present.
  const changelog = await readFile(join(BLUEPRINT_ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## 1\.0\.0 \(visual round,/);
});

// Criterion-e (positive-evidence) probe pack pins. The pack lives at
// blueprints/application-account-settings/contributions/probes/. Every probe file
// listed here must exist, its run wrapper must exist, and when the
// anatomy suite invokes each probe module in-memory the returned
// results[] rows must satisfy one of the four rule-7d shapes on every
// row. The anatomy test never reads .rcf/reports/ and never writes a
// report file; the probe invocation loop lives inside the test.

test('application-account-settings contributions/probes/ pack files exist (TC-criterion-e-pack-shape)', async () => {
  const contribRoot = join(REPO_ROOT, 'blueprints', 'application-account-settings', 'contributions', 'probes');
  const utilsPath = join(contribRoot, 'probe-utils.mjs');
  await readFile(utilsPath, 'utf8'); // throws if missing
  const probes = ['shell-tablist-per-capability', 'profile-form-autocomplete', 'sessions-surface-shape', 'sessions-adapter-uniform', 'theme-radiogroup'];
  const runners = ['run-shell-tablist-per-capability', 'run-profile-form-autocomplete', 'run-sessions-surface-shape', 'run-sessions-adapter-uniform', 'run-theme-radiogroup'];
  for (const name of probes) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
  for (const name of runners) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
});

async function loadContributedAnchorIds(blueprintRoot, slug) {
  const { readdir, readFile: rf } = await import('node:fs/promises');
  const ids = new Set();
  async function collect(subdir) {
    const dir = join(blueprintRoot, 'contributions', subdir);
    let files = [];
    try { files = (await readdir(dir)).filter((f) => f.endsWith('.json')); } catch (_) { return; }
    for (const f of files) {
      const doc = JSON.parse(await rf(join(dir, f), 'utf8'));
      if (Array.isArray(doc.acceptanceCriteria)) {
        for (const ac of doc.acceptanceCriteria) if (typeof ac.id === 'string' && ac.id.length > 0) ids.add(slug + '-' + ac.id);
      }
      if (typeof doc.reqId === 'string' && doc.reqId.length > 0) ids.add(doc.reqId);
    }
  }
  await collect('user-stories');
  await collect('requirements');
  return ids;
}

function aggregateOf(results) {
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r && r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r && r.verdict === 'warn')) return 'warn';
  return 'pass';
}

test('application-account-settings criterion-e probes aggregate to fail under each shipped fixture break (TC-criterion-e-negative-variants)', async () => {
  const probesDir = join(REPO_ROOT, 'blueprints', 'application-account-settings', 'contributions', 'probes');
  // Break switch -> probes that must aggregate fail when the fixture
  // is booted with that break as PROBE_BREAK. Only observable-side
  // breaks are covered; client-JS-only breaks are documented as
  // browser-verify territory in the fixture README.
  const brokenExpectations = [{"brk":"no-autocomplete","probes":["profile-form-autocomplete"]},{"brk":"leak-tab","probes":["shell-tablist-per-capability"]},{"brk":"no-persist","probes":["theme-radiogroup"]}];
  for (const { brk, probes: probeNames } of brokenExpectations) {
    for (const name of probeNames) {
      const prior = process.env.PROBE_BREAK;
      process.env.PROBE_BREAK = brk;
      try {
        const modUrl = pathToFileURL(join(probesDir, name + '.mjs')).href + '?nv=' + brk;
        const mod = await import(modUrl);
        const outcome = await mod.default();
        const results = (outcome && outcome.results) || [];
        const agg = aggregateOf(results);
        assert.equal(agg, 'fail', name + ' under PROBE_BREAK=' + brk + ' aggregated ' + agg + ' expected fail; verdicts=' + JSON.stringify(results.map((r) => r.verdict)));
      } finally {
        if (prior === undefined) delete process.env.PROBE_BREAK;
        else process.env.PROBE_BREAK = prior;
      }
    }
  }
});

test('application-account-settings criterion-e probes invoked in-memory carry rule-7d evidence rows (TC-criterion-e-evidence-shape)', async () => {
  const probesDir = join(REPO_ROOT, 'blueprints', 'application-account-settings', 'contributions', 'probes');
  const probeNames = ['shell-tablist-per-capability', 'profile-form-autocomplete', 'sessions-surface-shape', 'sessions-adapter-uniform', 'theme-radiogroup'];
  const validAnchorIds = await loadContributedAnchorIds(BLUEPRINT_ROOT, 'application-account-settings');
  for (const name of probeNames) {
    const mod = await import(pathToFileURL(join(probesDir, name + '.mjs')).href);
    const runProbe = mod.default;
    assert.equal(typeof runProbe, 'function', name + ': probe module must default-export a runProbe function');
    let outcome;
    try {
      outcome = await runProbe();
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      assert.fail(name + ': runProbe threw ' + message);
    }
    const results = outcome && Array.isArray(outcome.results) ? outcome.results : null;
    assert.ok(results && results.length > 0, name + ' returned no results[]');
    const failRow = results.find((r) => r && r.verdict === 'fail');
    assert.equal(failRow, undefined, name + ' has a fail-verdict row');
    for (const r of results) {
      assert.notEqual(r.anchorAcId, 'unknown', name + ' carries anchorAcId="unknown"');
      if (typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0) {
        assert.ok(validAnchorIds.has(r.anchorAcId), name + ' anchorAcId=' + r.anchorAcId + ' is not a shipped AC or REQ id');
      }
      if (typeof r.notObservableAcId === 'string' && r.notObservableAcId.length > 0) {
        assert.ok(validAnchorIds.has(r.notObservableAcId), name + ' notObservableAcId=' + r.notObservableAcId + ' is not a shipped AC or REQ id');
      }
      assertRule7dRowShape(r, name);
    }
  }
});

// Rule-7d row-shape helper (see application-charts-anatomy.test.js
// for the full rationale). Kept per-file so each anatomy suite carries
// its own negative-case test with no shared-helper coupling.
function assertRule7dRowShape(r, name) {
  const ev = r && r.evidence && typeof r.evidence === 'object' ? r.evidence : null;
  const hasRequestId = ev && typeof ev.requestId === 'string' && ev.requestId.length > 0;
  const hasBodyExcerpt = ev && typeof ev.bodyExcerpt === 'string' && ev.bodyExcerpt.length > 0;
  const hasDerived = ev && ev.derived && typeof ev.derived === 'object';
  const hasDerivedNonEmpty = hasDerived && Object.keys(ev.derived).length > 0;
  const hasEvidenceObject = ev && hasRequestId && (hasBodyExcerpt || hasDerivedNonEmpty);
  if (r.conformanceOnly === true) {
    const nullAnchor = r.anchorAcId === null || r.anchorAcId === undefined;
    assert.ok(nullAnchor && typeof r.limitation === 'string' && r.limitation.length > 0,
      name + ' conformanceOnly row anchorAcId=' + r.anchorAcId + ' violates the rule-7d null-anchor + limitation shape');
    return;
  }
  if (r.notObservableHere === true) {
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0
      && typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0,
      name + ' notObservableHere row violates the rule-7d anchor + reason shape');
    return;
  }
  if (r.accountBoundSkipped === true) {
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0,
      name + ' accountBoundSkipped row is missing a reason field (rule 7d)');
    return;
  }
  assert.ok(typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0,
    name + ' positive-evidence row has no anchorAcId (rule 7d)');
  assert.ok(hasEvidenceObject, name + ' positive-evidence row anchorAcId=' + r.anchorAcId + ' has no rule-7d evidence object');
}

test('rule-7d row-shape check refuses an anchored conformanceOnly row (TC-criterion-e-evidence-shape-negative)', async () => {
  const badRow = {
    anchorAcId: 'application-account-settings-AC-25101-1',
    conformanceOnly: true,
    limitation: 'a partial observation',
    verdict: 'warn',
    evidence: { requestId: 'r', bodyExcerpt: 'x', derived: {} },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case'),
    /conformanceOnly row anchorAcId=application-account-settings-AC-25101-1 violates the rule-7d null-anchor \+ limitation shape/);
});


test('rule-7d row-shape check refuses a positive row with an empty derived object and no excerpt (TC-criterion-e-evidence-shape-negative-empty-derived)', async () => {
  const badRow = {
    anchorAcId: 'application-account-settings-AC-25101-1',
    verdict: 'pass',
    detail: 'positive row with only an empty derived',
    evidence: { requestId: 'r', derived: {} },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case-empty-derived'),
    /positive-evidence row anchorAcId=application\-account\-settings\-AC\-25101\-1 has no rule-7d evidence object/);
});

test('rule-7d row-shape check refuses a positive row with only a request id (TC-criterion-e-evidence-shape-negative-id-only)', async () => {
  const badRow = {
    anchorAcId: 'application-account-settings-AC-25101-1',
    verdict: 'pass',
    detail: 'positive row with only a request id',
    evidence: { requestId: 'r' },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case-id-only'),
    /positive-evidence row anchorAcId=application\-account\-settings\-AC\-25101\-1 has no rule-7d evidence object/);
});
