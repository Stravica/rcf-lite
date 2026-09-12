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
  assert.equal(doc.version, '1.3.6');
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
// listed here must exist, its run wrapper must exist, and when the
// anatomy suite invokes each probe module in-memory the returned
// results[] rows must satisfy one of the four rule-7d shapes on every
// row. The anatomy test never reads .rcf/reports/ and never writes a
// report file; the probe invocation loop lives inside the test.

test('application-admin-console contributions/probes/ pack files exist (TC-criterion-e-pack-shape)', async () => {
  const contribRoot = join(REPO_ROOT, 'blueprints', 'application-admin-console', 'contributions', 'probes');
  const utilsPath = join(contribRoot, 'probe-utils.mjs');
  await readFile(utilsPath, 'utf8'); // throws if missing
  const probes = ['users-directory-surface', 'permission-matrix-grid', 'org-switcher-surface', 'audit-log-surface', 'sign-in-access-gated-surface'];
  const runners = ['run-users-directory-surface', 'run-permission-matrix-grid', 'run-org-switcher-surface', 'run-audit-log-surface', 'run-sign-in-access-gated-surface'];
  for (const name of probes) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
  for (const name of runners) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
});

// Family-local helper: enumerate the valid anchor-id set from the
// blueprint's shipped user stories and requirements. Every AC id in
// contributions/user-stories/*.json and every REQ id in
// contributions/requirements/*.json is prefixed with the slug to form
// a slug-prefixed anchor id, matching the shape probes emit. Kept
// inline (not on the shared _probe-anatomy-helpers.mjs) so the mixed
// branch's helper owner is undisturbed.
async function loadContributedAnchorIds(blueprintRoot, slug) {
  const { readdir, readFile: rf } = await import('node:fs/promises');
  const ids = new Set();
  async function collect(subdir, key) {
    const dir = join(blueprintRoot, 'contributions', subdir);
    let files = [];
    try { files = (await readdir(dir)).filter((f) => f.endsWith('.json')); } catch (_) { return; }
    for (const f of files) {
      const doc = JSON.parse(await rf(join(dir, f), 'utf8'));
      if (Array.isArray(doc.acceptanceCriteria)) {
        for (const ac of doc.acceptanceCriteria) if (typeof ac.id === 'string' && ac.id.length > 0) ids.add(slug + '-' + ac.id);
      }
      if (key === 'req' && typeof doc[key + 'Id'] === 'string' && doc[key + 'Id'].length > 0) ids.add(doc[key + 'Id']);
      // Also collect REQ id if present on a US doc (the reqId back-reference).
      if (typeof doc.reqId === 'string' && doc.reqId.length > 0) ids.add(doc.reqId);
    }
  }
  await collect('user-stories', 'story');
  await collect('requirements', 'req');
  return ids;
}

function aggregateOf(results) {
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r && r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r && r.verdict === 'warn')) return 'warn';
  return 'pass';
}

test('application-admin-console criterion-e probes aggregate to fail under each shipped fixture break (TC-criterion-e-negative-variants)', async () => {
  const probesDir = join(REPO_ROOT, 'blueprints', 'application-admin-console', 'contributions', 'probes');
  // Break switch -> probes that must aggregate fail when the fixture
  // is booted with that break as PROBE_BREAK. Only observable-side
  // breaks are covered; client-JS-only breaks are documented as
  // browser-verify territory in the fixture README.
  const brokenExpectations = [{"brk":"matrix-grid","probes":["permission-matrix-grid"]},{"brk":"local-login-form","probes":["sign-in-access-gated-surface"]}];
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

test('application-admin-console criterion-e probes invoked in-memory carry rule-7d evidence rows (TC-criterion-e-evidence-shape)', async () => {
  const probesDir = join(REPO_ROOT, 'blueprints', 'application-admin-console', 'contributions', 'probes');
  const probeNames = ['users-directory-surface', 'permission-matrix-grid', 'org-switcher-surface', 'audit-log-surface', 'sign-in-access-gated-surface'];
  const validAnchorIds = await loadContributedAnchorIds(BLUEPRINT_ROOT, 'application-admin-console');
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
    anchorAcId: 'application-admin-console-AC-21102-1',
    conformanceOnly: true,
    limitation: 'a partial observation',
    verdict: 'warn',
    evidence: { requestId: 'r', bodyExcerpt: 'x', derived: {} },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case'),
    /conformanceOnly row anchorAcId=application-admin-console-AC-21102-1 violates the rule-7d null-anchor \+ limitation shape/);
});


test('rule-7d row-shape check refuses a positive row with an empty derived object and no excerpt (TC-criterion-e-evidence-shape-negative-empty-derived)', async () => {
  const badRow = {
    anchorAcId: 'application-admin-console-AC-21102-1',
    verdict: 'pass',
    detail: 'positive row with only an empty derived',
    evidence: { requestId: 'r', derived: {} },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case-empty-derived'),
    /positive-evidence row anchorAcId=application\-admin\-console\-AC\-21102\-1 has no rule-7d evidence object/);
});

test('rule-7d row-shape check refuses a positive row with only a request id (TC-criterion-e-evidence-shape-negative-id-only)', async () => {
  const badRow = {
    anchorAcId: 'application-admin-console-AC-21102-1',
    verdict: 'pass',
    detail: 'positive row with only a request id',
    evidence: { requestId: 'r' },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case-id-only'),
    /positive-evidence row anchorAcId=application\-admin\-console\-AC\-21102\-1 has no rule-7d evidence object/);
});
