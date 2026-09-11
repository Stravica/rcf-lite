// Anatomy + apply + probe-pack test for the application-onboarding-tour
// v1.0.0 shelf blueprint (visual round T-5, spec section 5.5).
// Covers TS-057.

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
import { main as runDefineValidate } from '../../src/cli/validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-onboarding-tour');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-onboarding-tour.pack.mjs');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-onboarding-tour');
const README_ABS = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG_ABS = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE_ABS = join(BLUEPRINT_ROOT, 'guide', 'application-onboarding-tour.md');
const TOPICS_ABS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');

test('blueprint.json declares 21 contributions with no requiresAppliedCapabilities and elicits[] (TC-057-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-onboarding-tour');
  assert.equal(doc.version, '1.1.3');
  assert.equal(doc.category, 'application');
  assert.equal(doc.providesRoles, undefined, 'providesRoles absent');
  assert.equal(doc.capabilities, undefined, 'capabilities absent');
  assert.equal(doc.requiresAppliedCapabilities, undefined, 'requiresAppliedCapabilities absent (T-5 has no hard dependency)');
  const reqs = doc.contributions.filter((c) => c.kind === 'req');
  const uss = doc.contributions.filter((c) => c.kind === 'us');
  const tacs = doc.contributions.filter((c) => c.kind === 'tac');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(reqs.length, 6);
  assert.equal(uss.length, 9);
  assert.equal(tacs.length, 3);
  assert.equal(adrs.length, 3);
  assert.equal(doc.contributions.length, 21);
  const elicitIds = doc.elicits.map((e) => e.id).sort();
  assert.deepEqual(elicitIds, [
    'anchor-selectors',
    'checklist-anchor',
    'completion-state-store',
    'dismissal-policy',
    'per-step-content-voice',
    'tour-step-manifest',
  ]);
  const dismissalPolicy = doc.elicits.find((e) => e.id === 'dismissal-policy');
  assert.equal(dismissalPolicy.default, 'dismiss-permanently');
  const storeElicit = doc.elicits.find((e) => e.id === 'completion-state-store');
  assert.equal(storeElicit.default, 'spa-local-storage', 'Q4 default: spa-local-storage');
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
});

test('ADR JSON documents validate against 0.6.1 and standardsTraceClause is non-null on ADR contribution entries (TC-057-adr-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(adrs.length, 3);
  const required = ['adrId', 'prdId', 'tadId', 'version', 'status', 'title', 'context', 'decision', 'consequences', 'alternativesConsidered', 'createdAt', 'updatedAt'];
  for (const adr of adrs) {
    assert.ok(typeof adr.standardsTraceClause === 'string' && adr.standardsTraceClause.length > 0, `${adr.id} missing standardsTraceClause on contribution entry`);
    assert.equal(adr.elicited, true, `${adr.id} elicited=true (all three ADRs are operator-elicited per spec 5.5)`);
    assert.equal(adr.recommendedDefault, true, `${adr.id} recommendedDefault=true`);
    const body = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'contributions', adr.path), 'utf8'));
    for (const field of required) {
      assert.ok(field in body, `${adr.id} body missing ${field}`);
    }
    assert.equal(body.status, 'accepted');
    // Closed 0.6.1 shape refuses standardsTraceClause inside the ADR body.
    assert.equal(body.standardsTraceClause, undefined, `${adr.id} body must NOT carry standardsTraceClause (belongs on the contribution entry per spec 8a.2)`);
  }
});

test('applies cleanly on a fresh project with 21 contributions and no requiresAppliedCapabilities refusal (TC-057-applies-clean)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'onboarding-tour-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  const apply = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(apply.applied, true, JSON.stringify(apply));
  const sidecar = JSON.parse(await readFile(join(scratch, apply.sidecarPath), 'utf8'));
  assert.equal(sidecar.slug, 'application-onboarding-tour');
  assert.equal(sidecar.version, '1.1.3');
  // TC-057-applies-clean also runs `rcf define validate` on the scratch
  // project so applied contributions are exercised against the closed
  // rcf-schemas 0.6.1 shape. A schema violation in a shipped contribution
  // (for example an out-of-enum TAC dependency kind) will surface here
  // even when the anatomy assertions above still pass.
  const walked = await walkTree({ projectRoot: scratch });
  assert.deepEqual(walked.errors, [], `walker errors after apply: ${JSON.stringify(walked.errors)}`);
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = { write: (s) => { stdoutChunks.push(String(s)); } };
  const stderr = { write: (s) => { stderrChunks.push(String(s)); } };
  const exitCode = await runDefineValidate(['--json'], { cwd: scratch, stdout, stderr });
  const rawOut = stdoutChunks.join('');
  const rawErr = stderrChunks.join('');
  const envelope = JSON.parse(rawOut);
  assert.equal(exitCode, 0, `rcf define validate exit ${exitCode}: stdout=${rawOut} stderr=${rawErr}`);
  assert.equal(envelope.ok, true, `rcf define validate not ok: ${JSON.stringify(envelope.issues)}`);
  assert.deepEqual(envelope.issues, [], `rcf define validate issues: ${JSON.stringify(envelope.issues)}`);
});

test('every pack check id matches a contributed AC id; pack-level appliesTo names tacIds AND route; withUrl helper used; browser.resize breakpoints appear (TC-057-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-onboarding-tour', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, [], `every check id must be a contributed AC id; missing: ${missing.join(', ')}`);
  const checkIds = validation.pack.checks.map((c) => c.id).sort();
  assert.deepEqual(checkIds, ['AC-26101-1', 'AC-26102-1', 'AC-26103-1', 'AC-26104-1']);
  for (const check of validation.pack.checks) {
    assert.ok(typeof check.description === 'string' && check.description.length > 0, `${check.id} missing description`);
    assert.equal(typeof check.appliesTo, 'function', `${check.id} declares its own appliesTo predicate`);
  }
  const packSrc = await readFile(PACK_ABS, 'utf8');
  assert.ok(!/`\$\{.*runtimeUrl\}/.test(packSrc), 'no template-literal URL concatenation in pack (use withUrl helper)');
  assert.ok(/withUrl\(runtimeUrl/.test(packSrc), 'pack uses withUrl(runtimeUrl, ...) helper');
  assert.ok(/browser\.resize\(1440/.test(packSrc), 'pack probes the 1440 wide breakpoint via browser.resize');
  assert.ok(/browser\.resize\(360/.test(packSrc), 'pack probes the 360 narrow breakpoint via browser.resize');
  const packAppliesSrc = String(validation.pack.appliesTo);
  assert.ok(/tacIds/.test(packAppliesSrc), 'pack appliesTo references tacIds');
  assert.ok(/route|path/.test(packAppliesSrc), 'pack appliesTo references route/path');
});

// The AC-26103-1 description names both application-dashboard and settings-page
// per spec section 6 T-5 gate row (checklist collapse).
test('AC-26103-1 pack check description names both application-dashboard and settings-page (TC-057-checklist-collapse-description)', async () => {
  const packSrc = await readFile(PACK_ABS, 'utf8');
  const idx = packSrc.indexOf("id: 'AC-26103-1'");
  assert.ok(idx > 0, 'AC-26103-1 check block not found');
  const slice = packSrc.slice(idx, idx + 2000);
  assert.ok(/dashboard/i.test(slice), 'AC-26103-1 check description names dashboard');
  assert.ok(/settings-page/i.test(slice) || /settings page/i.test(slice), 'AC-26103-1 check description names settings-page');
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

async function fixtureUp({ apps = '', store = 'spa-local-storage', anchor = '' } = {}) {
  const port = await pickPort();
  const proc = await import('node:child_process');
  const env = { ...process.env, PORT: String(port), TOUR_APPS: apps, TOUR_STORE: store };
  if (anchor) env.TOUR_ANCHOR = anchor;
  const child = proc.spawn(process.execPath, [join(FIXTURE_ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolveP, rejectP) => {
    const t = setTimeout(() => rejectP(new Error('server did not print LISTENING within 3s')), 3000);
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

test('sample-app fixture serves the honest tour on both apps=dashboard and apps= (empty) branches and multiple store branches (TC-057-fixture-and-switches)', async () => {
  // Dashboard-applied branch: checklist open at dashboard-top.
  const dash = await fixtureUp({ apps: 'application-dashboard,application-notifications-in-app,application-account-settings,application-spa', store: 'spa-local-storage' });
  try {
    const dashboardHtml = await get(dash.url, '/dashboard');
    assert.ok(/details data-role="onboarding-tour-checklist" data-anchor="dashboard-top" open/.test(dashboardHtml), 'dashboard renders details open on dashboard-top');
    const tourHtml = await get(dash.url, '/tour?first-run=1');
    assert.ok(/id="anchor-1"/.test(tourHtml), 'tour surface renders anchors 1..3');
    assert.ok(tourHtml.includes('data-tour-control="next"') || tourHtml.includes('data-tour-control='), 'tour surface ships tour-control markup (client-mounted)');
    const settingsHtml = await get(dash.url, '/settings');
    assert.ok(settingsHtml.includes('button type="button" data-action="restart-tour"'), 'settings renders restart-tour control');
  } finally {
    dash.child.kill();
  }
  // Bare branch: checklist closed at settings-page.
  const bare = await fixtureUp({ apps: '', store: 'spa-local-storage' });
  try {
    const settingsHtml = await get(bare.url, '/settings');
    assert.ok(/details data-role="onboarding-tour-checklist" data-anchor="settings-page"/.test(settingsHtml), 'settings renders details on settings-page');
    assert.ok(!/data-anchor="settings-page" open/.test(settingsHtml), 'settings-page checklist is closed by default');
  } finally {
    bare.child.kill();
  }
  // Session-store branch: store is passed through as ?store=.
  const sess = await fixtureUp({ apps: '', store: 'spa-session-storage' });
  try {
    const tourHtml = await get(sess.url, '/tour?first-run=1&store=spa-session-storage');
    assert.ok(/STORE\s*=\s*"spa-session-storage"/.test(tourHtml), 'tour client script encodes the session store branch');
  } finally {
    sess.child.kill();
  }
});

test('sample-app fixture break switches surface the four defects (TC-057-negative-runs)', async () => {
  const { url, child } = await fixtureUp({ apps: 'application-dashboard', store: 'spa-local-storage' });
  try {
    // no-role: client script skips role="dialog" on the tooltip.
    const noRole = await get(url, '/tour?first-run=1&break=no-role');
    assert.ok(/BREAK\s*=\s*"no-role"/.test(noRole), 'no-role break switch encoded in client script');
    // focus-escape: client script skips the focus trap.
    const focusEsc = await get(url, '/tour?first-run=1&break=focus-escape');
    assert.ok(/BREAK\s*=\s*"focus-escape"/.test(focusEsc), 'focus-escape break switch encoded in client script');
    // no-collapse: dashboard renders <section> instead of <details> for the checklist.
    const noColl = await get(url, '/dashboard?break=no-collapse');
    assert.ok(/section data-role="onboarding-tour-checklist"/.test(noColl), 'no-collapse renders <section> instead of <details>');
    assert.ok(!/details data-role="onboarding-tour-checklist"/.test(noColl), 'no-collapse suppresses the <details> wrapper');
    // no-persist: client script drops the completion write.
    const noPersist = await get(url, '/tour?first-run=1&break=no-persist');
    assert.ok(/BREAK\s*=\s*"no-persist"/.test(noPersist), 'no-persist break switch encoded in client script');
  } finally {
    child.kill();
  }
});

test('AC ids and cross-reference blueprint slugs appear identically across README, guide, pack descriptions and topics.md (TC-057-shelf-doc-consistency)', async () => {
  const readme = await readFile(README_ABS, 'utf8');
  const guide = await readFile(GUIDE_ABS, 'utf8');
  const topics = await readFile(TOPICS_ABS, 'utf8');
  const packSrc = await readFile(PACK_ABS, 'utf8');
  const ACs = ['AC-26101-1', 'AC-26102-1', 'AC-26103-1', 'AC-26104-1'];
  for (const id of ACs) {
    assert.ok(readme.includes(id), `README references ${id}`);
    assert.ok(topics.includes(id), `topics.md references ${id}`);
    assert.ok(packSrc.includes(id), `pack references ${id}`);
  }
  const crossRefs = ['application-dashboard', 'application-notifications-in-app', 'application-account-settings', 'application-spa'];
  for (const slug of crossRefs) {
    assert.ok(readme.includes(slug), `README references ${slug}`);
    assert.ok(topics.includes(slug), `topics.md references ${slug}`);
  }
  // Q4 default named in ADR-2702 and README.
  assert.ok(readme.includes('spa-local-storage'), 'README names the Q4 default spa-local-storage');
  assert.ok(guide.includes('spa-local-storage'), 'guide names the Q4 default');
});

test('README lists mechanism-reach gaps per AC and guide names WCAG SCs and the ARIA APG dialog-modal pattern with URLs (TC-057-changelog-guide-and-mechanism-reach)', async () => {
  const readme = await readFile(README_ABS, 'utf8');
  const guide = await readFile(GUIDE_ABS, 'utf8');
  const changelog = await readFile(CHANGELOG_ABS, 'utf8');
  // README's mechanism-reach gap section names each gap AC id individually.
  const gapSection = readme.slice(readme.indexOf('## Known mechanism-reach gaps'));
  assert.ok(gapSection.includes('AC-26105-1'), 'README names AC-26105-1 mechanism-reach gap');
  assert.ok(gapSection.includes('AC-26107-1'), 'README names AC-26107-1 mechanism-reach gap');
  // Guide names each of the WCAG 2.2 AA SCs with URLs.
  assert.ok(/2\.1\.1 Keyboard.*https:\/\/www\.w3\.org\/WAI\/WCAG22/s.test(guide), 'guide names 2.1.1 Keyboard with URL');
  assert.ok(/2\.1\.2 No Keyboard Trap.*https:\/\/www\.w3\.org\/WAI\/WCAG22/s.test(guide), 'guide names 2.1.2 No Keyboard Trap with URL');
  assert.ok(/2\.4\.3 Focus Order.*https:\/\/www\.w3\.org\/WAI\/WCAG22/s.test(guide), 'guide names 2.4.3 Focus Order with URL');
  assert.ok(/2\.4\.11 Focus Not Obscured Minimum.*https:\/\/www\.w3\.org\/WAI\/WCAG22/s.test(guide), 'guide names 2.4.11 Focus Not Obscured Minimum with URL');
  assert.ok(/ARIA APG dialog-modal pattern.*https:\/\/www\.w3\.org\/WAI\/ARIA\/apg\/patterns\/dialog-modal\//s.test(guide), 'guide names the ARIA APG dialog-modal pattern with URL');
  // Blueprint CHANGELOG has exactly one 1.0.0 entry (positive check on the
  // blueprint-owned CHANGELOG; the round-close release PR owns
  // packages/rcf-lite/CHANGELOG.md and its release entry is asserted by the
  // release recipe, not by this anatomy test).
  assert.equal((changelog.match(/^## 1\.0\.0 /gm) || []).length, 1, 'blueprint CHANGELOG carries one 1.0.0 entry');
});

// Criterion-e (positive-evidence) probe pack pins. The pack lives at
// blueprints/application-onboarding-tour/contributions/probes/. Every probe file
// listed here must exist, its run wrapper must exist, and (when the
// probe has already been executed against the fixture) its run
// record in .rcf/reports/ must carry an evidence object of one of
// the four rule-7d shapes on every result row.

test('application-onboarding-tour contributions/probes/ pack files exist (TC-criterion-e-pack-shape)', async () => {
  const contribRoot = join(REPO_ROOT, 'blueprints', 'application-onboarding-tour', 'contributions', 'probes');
  const utilsPath = join(contribRoot, 'probe-utils.mjs');
  await readFile(utilsPath, 'utf8'); // throws if missing
  const probes = ['first-run-detection', 'stepper-role-dialog', 'checklist-anchor-open', 'completion-persistence'];
  const runners = ['run-first-run-detection', 'run-stepper-role-dialog', 'run-checklist-anchor-open', 'run-completion-persistence'];
  for (const name of probes) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
  for (const name of runners) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
});

test('application-onboarding-tour criterion-e run records carry rule-7d evidence when present (TC-criterion-e-evidence-shape)', async () => {
  const reportsDir = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', 'application-onboarding-tour');
  let entries = [];
  try {
    const { readdir } = await import('node:fs/promises');
    entries = await readdir(reportsDir);
  } catch (_) {
    // Reports must exist for this check to mean anything (master
    // brief addendum 2026-09-11 point 8: the reviewer reads the
    // records; so do you). A missing reports directory is a fail:
    // run 'pnpm test:blueprint-probes' or 'node blueprints/application-onboarding-tour/contributions/probes/run-*.mjs'
    // before the anatomy suite.
    assert.fail('reports directory absent: ' + reportsDir + ' - run the probes first');
  }
  const jsonEntries = entries.filter((f) => f.endsWith('.json'));
  assert.ok(jsonEntries.length > 0, 'no report files in ' + reportsDir);
  for (const filename of jsonEntries) {
    const raw = await readFile(join(reportsDir, filename), 'utf8');
    const doc = JSON.parse(raw);
    assert.ok(Array.isArray(doc.results) && doc.results.length > 0, filename + ' has no results');
    assert.notEqual(doc.aggregateVerdict, 'fail', filename + ' aggregateVerdict=fail');
    for (const r of doc.results) {
      // The anchor is either a real AC/REQ id string or null (an
      // exception-fallback row). The literal string "unknown" is
      // refused: probe-utils no longer emits it (master brief
      // addendum §3).
      assert.notEqual(r.anchorAcId, 'unknown', filename + ' carries anchorAcId="unknown"');
      const ev = r.evidence && typeof r.evidence === 'object' ? r.evidence : null;
      const hasRequestId = ev && typeof ev.requestId === 'string' && ev.requestId.length > 0;
      const hasBodyExcerpt = ev && typeof ev.bodyExcerpt === 'string' && ev.bodyExcerpt.length > 0;
      const hasDerived = ev && ev.derived && typeof ev.derived === 'object';
      const hasErrorExcerpt = ev && typeof ev.errorExcerpt === 'string' && ev.errorExcerpt.length > 0;
      const hasEvidenceObject = ev && (hasRequestId || hasBodyExcerpt || hasDerived || hasErrorExcerpt);
      const isHonestSkip = r.accountBoundSkipped === true && typeof r.reason === 'string' && r.reason.length > 0;
      assert.ok(hasEvidenceObject || isHonestSkip, filename + ' result ' + (r.anchorAcId || '(no anchor)') + ' has no rule-7d evidence object and no honest skip');
    }
  }
});
