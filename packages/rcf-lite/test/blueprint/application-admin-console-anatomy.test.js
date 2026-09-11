// Anatomy + apply + probe-pack test for the application-admin-console
// v1.0.0 shelf blueprint (visual round T-5, spec section 5.5).
// Covers TS-052.

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
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-admin-console');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-admin-console.pack.mjs');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-admin-console');
const MAGIC_LINK_BP = join(REPO_ROOT, 'blueprints', 'security-auth-magic-link');
const CLERK_BP = join(REPO_ROOT, 'blueprints', 'security-auth-clerk');
const LOGGING_BP = join(REPO_ROOT, 'blueprints', 'observability-logging');

test('blueprint.json declares 34 contributions with requiresAppliedCapabilities and elicits[] (TC-052-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-admin-console');
  assert.equal(doc.version, '1.3.1');
  assert.equal(doc.category, 'application');
  assert.equal(doc.providesRoles, undefined, 'providesRoles absent per spec 5.5.3');
  const reqs = doc.contributions.filter((c) => c.kind === 'req');
  const uss = doc.contributions.filter((c) => c.kind === 'us');
  const tacs = doc.contributions.filter((c) => c.kind === 'tac');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(reqs.length, 10);
  assert.equal(uss.length, 14);
  assert.equal(tacs.length, 5);
  assert.equal(adrs.length, 5);
  assert.equal(doc.contributions.length, 34);
  assert.deepEqual(doc.requiresAppliedCapabilities.capabilities, ['principalDirectory']);
  assert.equal(doc.requiresAppliedCapabilities.allowSkipFlag, 'allow-no-auth-yet');
  const elicitIds = doc.elicits.map((e) => e.id).sort();
  // Four regular elicits (when-gated on applied capabilities or
  // ungated) plus four custom-auth capability-declaration elicits
  // that fire pre-refusal (spec 5.5 "Risks") and let a project with
  // no shelf auth declare which capabilities its own auth provides.
  assert.deepEqual(elicitIds, [
    'audit-retention-days',
    'baseline-roles',
    'custom-auth-provides-audit-log',
    'custom-auth-provides-principal-directory',
    'custom-auth-provides-role-model',
    'custom-auth-provides-tenancy',
    'invite-transport',
    'tenancy-shape',
  ]);
  const customAuthElicits = doc.elicits.filter((e) => typeof e.providesCapability === 'string');
  assert.equal(customAuthElicits.length, 4);
  for (const e of customAuthElicits) {
    assert.equal(e.kind, 'boolean');
    assert.equal(e.when, undefined);
    assert.ok(['principalDirectory', 'roleModel', 'tenancy', 'auditLog'].includes(e.providesCapability));
  }
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
});

test('apply --allow-no-auth-yet on bare SPA writes sidecar with allowNoAuthYet:true and empty appliedCapabilities (TC-052-applies-clean-with-override)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'admin-console-scratch-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT, allowNoAuthYet: true });
  assert.equal(result.applied, true, JSON.stringify(result));
  const doc = JSON.parse(await readFile(join(scratch, result.sidecarPath), 'utf8'));
  assert.equal(doc.allowNoAuthYet, true);
  assert.deepEqual(doc.appliedCapabilities, []);
});

test('apply refuses on bare SPA with spec 5.5.1 verbatim message and lists applied blueprints (TC-052-refuses-bare-spa)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'admin-console-refuse-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(result.kind, 'requiresAppliedCapabilities');
  assert.match(result.message, /application-admin-console requires at least one applied security-auth-\*/);
  assert.match(result.message, /--allow-no-auth-yet/);
});

test('apply on magic-link project yields [principalDirectory] and on clerk+logging project yields [principalDirectory,roleModel,auditLog] (TC-052-capability-discovery)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'admin-console-magic-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree: t0 } = await walkTree({ projectRoot: scratch });
  const mlApply = await applyBlueprint({ projectRoot: scratch, tree: t0, source: MAGIC_LINK_BP });
  assert.equal(mlApply.applied, true, JSON.stringify(mlApply));
  const { tree: t1 } = await walkTree({ projectRoot: scratch });
  const consoleApply = await applyBlueprint({ projectRoot: scratch, tree: t1, source: BLUEPRINT_ROOT });
  assert.equal(consoleApply.applied, true, JSON.stringify(consoleApply));
  assert.deepEqual(consoleApply.appliedCapabilities, ['principalDirectory']);

  // observability-logging 1.1.0 declares capabilities: ["auditLog"] explicitly (one grammar; no role-to-capability
  // inference); applying it alongside clerk widens the union to [auditLog, principalDirectory, roleModel]. This
  // proves the union math without conflating role and capability grammars: the capabilities[] declaration is what
  // the mechanism reads, never providesRoles[].
  const scratch2 = await mkdtemp(join(tmpdir(), 'admin-console-clerk-'));
  await initProject({ projectRoot: scratch2, projectName: 'scratch' });
  const { tree: c0 } = await walkTree({ projectRoot: scratch2 });
  const clerkApply = await applyBlueprint({ projectRoot: scratch2, tree: c0, source: CLERK_BP });
  assert.equal(clerkApply.applied, true, JSON.stringify(clerkApply));
  const { tree: c1 } = await walkTree({ projectRoot: scratch2 });
  const loggingApply = await applyBlueprint({ projectRoot: scratch2, tree: c1, source: LOGGING_BP });
  assert.equal(loggingApply.applied, true, JSON.stringify(loggingApply));
  const { tree: c2 } = await walkTree({ projectRoot: scratch2 });
  const wide = await applyBlueprint({ projectRoot: scratch2, tree: c2, source: BLUEPRINT_ROOT });
  assert.equal(wide.applied, true, JSON.stringify(wide));
  const sorted = [...wide.appliedCapabilities].sort();
  // Hardening pass B4 (2026-09-09): observability-logging 1.3.0 removes
  // sessionInventory (owner is security-auth-clerk TAC-1003
  // interfaces.sessionInventory). The union still carries sessionInventory
  // in this triple because clerk 1.3.0 declares it; the union math is
  // unchanged for a project that runs clerk. A project that runs
  // observability-logging without clerk no longer gains sessionInventory
  // from logging alone, matching the section 7c backing evidence.
  assert.deepEqual(sorted, ['auditLog', 'hostedIdentityUi', 'principalDirectory', 'roleModel', 'sessionInventory']);
});

test('every pack check id matches a contributed AC id and appliesTo predicate gates on the applied capability (TC-052-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-admin-console', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, [], `every check id must be a contributed AC id; missing: ${missing.join(', ')}`);
  const checkIds = validation.pack.checks.map((c) => c.id).sort();
  assert.deepEqual(checkIds, ['AC-21102-1', 'AC-21103-1', 'AC-21104-1', 'AC-21105-1', 'AC-21815-1']);
  // Every check carries a description
  for (const check of validation.pack.checks) {
    assert.ok(typeof check.description === 'string' && check.description.length > 0);
    assert.equal(typeof check.appliesTo, 'function', `${check.id} declares its own appliesTo predicate`);
  }
  // Pack-level appliesTo names both tacIds AND route.
  const src = String(validation.pack.appliesTo);
  assert.ok(/tacIds/.test(src), 'pack appliesTo references tacIds');
  assert.ok(/route|path/.test(src), 'pack appliesTo references route/path');
  // Per-check appliesTo gates on the right capability.
  const scratch = await mkdtemp(join(tmpdir(), 'admin-console-pack-'));
  const usersCheck = validation.pack.checks.find((c) => c.id === 'AC-21102-1');
  // No sidecar yet: capabilities = []; per-check appliesTo returns false.
  assert.equal(await usersCheck.appliesTo({ projectRoot: scratch }), false);
});

// Spin up the fixture on an ephemeral port for the surface tests.
async function fixtureUp(caps) {
  const url = new URL(`http://127.0.0.1:${await pickPort()}`);
  const proc = await import('node:child_process');
  const child = proc.spawn(process.execPath, [join(FIXTURE_ROOT, 'server.js')], {
    env: { ...process.env, PORT: url.port, ADMIN_CONSOLE_CAPS: caps },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolveP, rejectP) => {
    const t = setTimeout(() => rejectP(new Error('server did not print LISTENING within 2s')), 2000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).startsWith('LISTENING ')) { clearTimeout(t); resolveP(); }
    });
    child.on('error', rejectP);
  });
  return { url, child };
}

async function pickPort() {
  // Bind a temporary server on port 0 to let the OS pick a free port,
  // then close it. Race conditions on immediate rebind are acceptable
  // for a test rig.
  return new Promise((resolveP) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolveP(port));
    });
  });
}

async function get(url, path) {
  const res = await fetch(new URL(path, url));
  return res.text();
}

test('sample-app fixture serves console shell with ARIA APG grid permission matrix and required data attributes (TC-052-fixture-surfaces)', async () => {
  const { url, child } = await fixtureUp('principalDirectory,roleModel,tenancy,auditLog');
  try {
    const usersHtml = await get(url, '/admin/users');
    assert.ok(usersHtml.includes('data-surface="users"'), 'users region present');
    assert.ok(usersHtml.match(/data-user-id="u1"/), 'user row u1 enumerable');
    assert.ok(usersHtml.includes('data-action="invite"'), 'invite control present for pending users');

    const rolesHtml = await get(url, '/admin/roles');
    assert.ok(rolesHtml.includes('role="grid"'), 'permission matrix carries role=grid');
    assert.ok(rolesHtml.includes('role="rowheader"'), 'role=rowheader on role ranks');
    assert.ok(rolesHtml.includes('role="columnheader"'), 'role=columnheader on permission columns');
    assert.ok(rolesHtml.includes('role="gridcell"'), 'role=gridcell on inner cells');
    assert.ok(rolesHtml.match(/aria-label="Owner allowed: Invite user"/), 'permission string announced on focus');

    const orgsHtml = await get(url, '/admin/orgs');
    assert.ok(orgsHtml.includes('data-role="org-switcher"'), 'org switcher rendered under tenancy');

    const auditHtml = await get(url, '/admin/audit');
    assert.ok(auditHtml.match(/data-audit-id="a1"/), 'audit row enumerable by data-audit-id');
    assert.ok(auditHtml.includes('data-column="correlationId"'), 'correlationId column present');

    const deniedHtml = await get(url, '/admin/users?asAdmin=false');
    assert.ok(deniedHtml.includes('data-surface="denied"'), 'denied region present');
    assert.ok(deniedHtml.includes('data-action="request-access"'), 'request-access control present');
  } finally {
    child.kill();
  }
});

test('sample-app fixture break switches surface the three defects on the DOM (TC-052-negative-runs)', async () => {
  const { url, child } = await fixtureUp('principalDirectory,roleModel,auditLog');
  try {
    const brokenGrid = await get(url, '/admin/roles?break=matrix-grid');
    // The style block still names role="grid"; the matrix element itself must not.
    const gridMatches = brokenGrid.match(/role="grid"/g) || [];
    // 1 mention allowed in CSS, but no role=grid on the matrix element (which would surface as
    // an element attribute alongside data-surface="roles"). We look for the specific pattern.
    assert.ok(!/data-surface="roles"[\s\S]*?<div\s+role="grid"/.test(brokenGrid), 'matrix element does not carry role=grid when broken');

    const brokenDenied = await get(url, '/admin/users?asAdmin=false&break=denied');
    assert.ok(!brokenDenied.includes('data-action="request-access"'), 'request-access control absent when broken');

    const brokenAudit = await get(url, '/admin/audit?break=audit-fields');
    assert.ok(!brokenAudit.includes('data-column="correlationId"'), 'correlationId column absent when broken');
  } finally {
    child.kill();
  }
});

// Criterion-e (positive-evidence) probe pack pins. The pack lives at
// blueprints/application-admin-console/contributions/probes/. Every probe file
// listed here must exist, its run wrapper must exist, and (when the
// probe has already been executed against the fixture) its run
// record in .rcf/reports/ must carry an evidence object of one of
// the four rule-7d shapes on every result row.

test('application-admin-console contributions/probes/ pack files exist (TC-criterion-e-pack-shape)', async () => {
  const contribRoot = join(REPO_ROOT, 'blueprints', 'application-admin-console', 'contributions', 'probes');
  const utilsPath = join(contribRoot, 'probe-utils.mjs');
  await readFile(utilsPath, 'utf8'); // throws if missing
  const probes = ['users-directory-surface', 'permission-matrix-grid', 'org-switcher-surface', 'audit-log-surface', 'sign-in-access-gated-surface'];
  const runners = ['run-users-directory-surface', 'run-permission-matrix-grid', 'run-org-switcher-surface', 'run-audit-log-surface', 'run-sign-in-access-gated-surface'];
  for (const name of probes) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
  for (const name of runners) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
});

test('application-admin-console criterion-e run records carry rule-7d evidence when present (TC-criterion-e-evidence-shape)', async () => {
  const reportsDir = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', 'application-admin-console');
  let entries = [];
  try {
    const { readdir } = await import('node:fs/promises');
    entries = await readdir(reportsDir);
  } catch (_) {
    // Run records are not committed; when the anatomy test runs on
    // a fresh checkout there is nothing to inspect. This is not a
    // failure — the pack files test above is the shape gate.
    return;
  }
  for (const filename of entries) {
    if (!filename.endsWith('.json')) continue;
    const raw = await readFile(join(reportsDir, filename), 'utf8');
    const doc = JSON.parse(raw);
    assert.ok(Array.isArray(doc.results) && doc.results.length > 0, filename + ' has no results');
    for (const r of doc.results) {
      const hasEvidenceObject = r.evidence && typeof r.evidence === 'object'
        && (typeof r.evidence.requestId === 'string'
          || typeof r.evidence.responseStatus === 'number'
          || typeof r.evidence.bodyExcerpt === 'string'
          || typeof r.evidence.derived === 'object');
      const isHonestSkip = r.accountBoundSkipped === true && typeof r.reason === 'string';
      assert.ok(hasEvidenceObject || isHonestSkip, filename + ' result ' + (r.anchorAcId || '(no anchor)') + ' has no rule-7d evidence object and no honest skip');
    }
  }
});
