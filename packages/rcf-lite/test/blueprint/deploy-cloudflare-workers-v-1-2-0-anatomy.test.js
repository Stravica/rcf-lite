// Anatomy + shape + probe + fixture + shelf-doc test for the
// deploy-cloudflare-workers v1.2.0 additive minor bump (T-0 of the
// Cloudflare round 6 spec, 2026-09-06 section 5.0).
// Covers TS-073, TS-074, TS-075.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';
import { loadBlueprint } from '../../src/blueprint/loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'deploy-cloudflare-workers');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'cf-platform');
const PROBE_MODULE = join(BLUEPRINT_ROOT, 'contributions', 'probes', 'assets-manifest-scan.mjs');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'deploy-cloudflare-workers.md');
const OWN_TOPICS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const SPA_TOPICS = join(REPO_ROOT, 'blueprints', 'application-spa', 'docs', 'topics.md');
const SCHEMAS_ROOT = join(
  REPO_ROOT,
  'node_modules',
  '@stravica-ai',
  'rcf-schemas',
  'schemas',
);

// TS-073 (US-2901): shelf shape + probe module + chain-slice cross-check.

test('blueprint.json declares 41 contributions with v1.2.0, delta shape and unchanged v1.1.0 companions (TC-073-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'deploy-cloudflare-workers');
  assert.equal(doc.version, '1.3.2');
  assert.equal(doc.category, 'deploy');
  assert.equal(doc.contributions.length, 41);
  const kinds = doc.contributions.reduce((acc, c) => {
    acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, {});
  assert.equal(kinds.req, 14, 'v1.2.0 delta adds 2 REQs on top of the shipped 12');
  assert.equal(kinds.us, 15, 'v1.2.0 delta adds 3 USs on top of the shipped 12');
  assert.equal(kinds.tac, 6, 'no new TACs at v1.2.0');
  assert.equal(kinds.adr, 6, 'v1.2.0 delta adds ADR-1306 on top of the shipped 5');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  for (const adr of adrs) {
    assert.ok(
      typeof adr.standardsTraceClause === 'string' && adr.standardsTraceClause.length > 0,
      `ADR entry ${adr.id} must carry a non-null standardsTraceClause per section 8a.2`,
    );
  }
  const spaShape = doc.contributions.find(
    (c) => c.id === 'ADR-1306-deploy-cloudflare-workers-spa-shape',
  );
  assert.ok(spaShape, 'ADR-1306 contribution entry present on v1.2.0');
  assert.equal(spaShape.recommendedDefault, true);
  assert.equal(spaShape.elicited, false);
  assert.equal(
    spaShape.standardsTraceClause,
    'Cloudflare Pages landing-page recommendation (2026-09-06)',
  );
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  assert.equal(doc.capabilities, undefined, 'no capability minted at v1.2.0 (T-0 owns none)');
  assert.equal(doc.requiresAppliedCapabilities, undefined);
});

test('assets-manifest-scan probe module contract and cf-platform fixture scan-pass (TC-073-probe-module-and-scan-pass)', async () => {
  const probe = await import(pathToFileURL(PROBE_MODULE).href);
  assert.equal(probe.anchorAcId, 'AC-12113-1');
  assert.equal(probe.accountBound, false);
  assert.equal(typeof probe.scan, 'function');
  assert.equal(typeof probe.parseWranglerToml, 'function');
  assert.equal(typeof probe.writeReport, 'function');
  const wranglerText = await readFile(join(FIXTURE_ROOT, 'wrangler.toml'), 'utf8');
  const parsed = probe.parseWranglerToml(wranglerText);
  assert.equal(parsed.assets && parsed.assets.directory, './dist');
  assert.equal(parsed.assets && parsed.assets.run_worker_first, true);
  assert.equal(parsed.pages_build_output_dir, undefined);
  const report = await probe.scan({
    fixtureRoot: FIXTURE_ROOT,
    elicited: { 'assets-directory': './dist', 'run-worker-first': 'true' },
  });
  assert.equal(report.aggregateVerdict, 'pass');
  assert.equal(report.anchorAcId, 'AC-12113-1');
  assert.ok(
    report.results.every((r) => r.anchorAcId === 'AC-12113-1'),
    'every result carries the anchorAcId',
  );
});

test('T-0 chain slice adds two REQs three USs three TSs one FBS and one CN under the HQ block (TC-073-chain-slice-cross-check)', async () => {
  const rcfRoot = join(REPO_ROOT, 'packages', 'rcf-lite', 'rcf');
  const reqIds = [
    'req-029.json',
    'req-030.json',
  ];
  for (const f of reqIds) {
    const raw = await readFile(join(rcfRoot, 'requirements', f), 'utf8');
    const doc = JSON.parse(raw);
    assert.match(doc.reqId, /^REQ-0(29|30)$/);
    assert.equal(doc.prdId, 'PRD-001');
  }
  const usFiles = ['us-2901.json', 'us-2902.json', 'us-3001.json'];
  for (const f of usFiles) {
    const raw = await readFile(join(rcfRoot, 'user-stories', f), 'utf8');
    const doc = JSON.parse(raw);
    assert.ok(doc.acceptanceCriteria.length >= 1);
    for (const ac of doc.acceptanceCriteria) {
      assert.match(ac.id, /^AC-\d{3,}(-\d+)?$/);
    }
  }
  const tsFiles = ['ts-073.json', 'ts-074.json', 'ts-075.json'];
  for (const f of tsFiles) {
    const raw = await readFile(join(rcfRoot, 'test-suites', f), 'utf8');
    const doc = JSON.parse(raw);
    for (const tc of doc.testCases) {
      assert.equal(
        tc.testPointer.startsWith('test/blueprint/deploy-cloudflare-workers-v-1-2-0-anatomy.test.js'),
        true,
        `TC ${tc.id} testPointer must resolve into this file`,
      );
    }
  }
  const fbs = JSON.parse(await readFile(join(rcfRoot, 'fbs', 'fbs-063.json'), 'utf8'));
  assert.equal(fbs.fbsId, 'FBS-063');
  assert.equal(fbs.acIds.length, 8);
  const cn = JSON.parse(await readFile(join(rcfRoot, 'code-nodes', 'cn-209.json'), 'utf8'));
  assert.equal(cn.cnId, 'CN-209');
  assert.ok(cn.path.endsWith('assets-manifest-scan.mjs'));
});

// TS-074 (US-2902): elicits + fixture files.

test('elicits[] declares assets-directory string default empty and run-worker-first boolean default false and loader accepts blueprint.json (TC-074-elicits-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(Array.isArray(doc.elicits), true);
  assert.equal(doc.elicits.length, 2);
  const assetsDir = doc.elicits.find((e) => e.id === 'assets-directory');
  assert.ok(assetsDir, 'assets-directory elicit present');
  assert.equal(assetsDir.kind, 'string');
  assert.equal(assetsDir.default, '');
  assert.equal(assetsDir.providesCapability, undefined);
  const runFirst = doc.elicits.find((e) => e.id === 'run-worker-first');
  assert.ok(runFirst, 'run-worker-first elicit present');
  assert.equal(runFirst.kind, 'string');
  assert.equal(runFirst.default, 'false');
  assert.equal(runFirst.providesCapability, undefined);
  // Loader accepts the blueprint (validation is shape-only for the top-
  // level elicits[] block; the loader-side when-elicitedNonEmpty
  // predicate is a mechanism follow-up, so run-worker-first ships
  // without a when block this round).
  const loaded = await loadBlueprint(BLUEPRINT_ROOT);
  assert.equal(loaded.slug, 'deploy-cloudflare-workers');
  assert.equal(loaded.version, '1.3.2');
  assert.equal(loaded.elicits.length, 2);
});

test('cf-platform fixture ships wrangler.toml dist index.html src index.mjs package.json shim and README with SIMULATE_MIXED_SHAPE and SIMULATE_EMPTY_ASSETS switches (TC-074-cf-platform-fixture-files)', async () => {
  const wrangler = await readFile(join(FIXTURE_ROOT, 'wrangler.toml'), 'utf8');
  assert.match(wrangler, /\[assets\]/);
  assert.match(wrangler, /directory\s*=\s*"\.\/dist"/);
  assert.match(wrangler, /run_worker_first\s*=\s*true/);
  assert.doesNotMatch(wrangler, /pages_build_output_dir/);
  const html = await readFile(join(FIXTURE_ROOT, 'dist', 'index.html'), 'utf8');
  assert.match(html, /cf-platform fixture/);
  const worker = await readFile(join(FIXTURE_ROOT, 'src', 'index.mjs'), 'utf8');
  assert.match(worker, /export default/);
  const pkg = JSON.parse(await readFile(join(FIXTURE_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.start, 'wrangler dev');
  assert.ok(pkg.devDependencies && pkg.devDependencies.wrangler, 'wrangler devDependency declared');
  const shim = await readFile(join(FIXTURE_ROOT, 'run-assets-manifest-scan.mjs'), 'utf8');
  assert.match(shim, /assets-manifest-scan\.mjs/);
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /SIMULATE_MIXED_SHAPE/);
  assert.match(readme, /SIMULATE_EMPTY_ASSETS/);
  assert.match(readme, /wrangler dev/);
});

// TS-075 (US-3001): ADR-1306 + guide + three-state probed verdicts.

test('ADR-1306 body validates against 0.6.1 with verbatim Cloudflare quote and standardsTraceClause on the contribution entry (TC-075-adr-1306-body-and-clause)', async () => {
  const adrBody = JSON.parse(
    await readFile(
      join(BLUEPRINT_ROOT, 'contributions', 'adrs', 'adr-1306-deploy-cloudflare-workers-spa-shape.json'),
      'utf8',
    ),
  );
  const requiredFields = [
    'adrId', 'prdId', 'tadId', 'version', 'status', 'title', 'context',
    'decision', 'consequences', 'createdAt', 'updatedAt',
  ];
  for (const f of requiredFields) {
    assert.ok(f in adrBody, `ADR body must carry required field '${f}'`);
  }
  assert.equal(adrBody.adrId, 'ADR-1306-deploy-cloudflare-workers-spa-shape');
  assert.equal(adrBody.status, 'accepted');
  assert.equal(
    adrBody.standardsTraceClause,
    undefined,
    'the standardsTraceClause belongs on the blueprint.json contribution entry, not the ADR body (rcf-schemas 0.6.1 closed shape)',
  );
  const quote = 'Workers supports most Pages use cases and offers a broader feature set. It is Cloudflare\'s primary platform for building applications. Start new projects with Workers.';
  const bodyText = adrBody.context + '\n' + adrBody.decision + '\n' + adrBody.consequences;
  assert.ok(
    bodyText.includes(quote),
    'ADR-1306 body carries the verbatim Cloudflare Pages landing-page quote in context/decision/consequences',
  );
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  const entry = doc.contributions.find(
    (c) => c.id === 'ADR-1306-deploy-cloudflare-workers-spa-shape',
  );
  assert.equal(
    entry.standardsTraceClause,
    'Cloudflare Pages landing-page recommendation (2026-09-06)',
  );
  assert.equal(entry.recommendedDefault, true);
  assert.equal(entry.elicited, false);
});

test('guide section Workers-with-static-assets adds the two Cloudflare URLs and the elicit signatures and the wrangler.toml snippet (TC-075-guide-section-and-urls)', async () => {
  const guide = await readFile(GUIDE, 'utf8');
  assert.match(guide, /Workers-with-static-assets: the SPA-on-Workers shape/);
  assert.ok(guide.includes('assets-directory'), 'guide names the assets-directory elicit');
  assert.ok(guide.includes('run-worker-first'), 'guide names the run-worker-first elicit');
  assert.ok(
    guide.includes('https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/'),
    'guide links the Cloudflare migrate-from-Pages guide',
  );
  assert.ok(
    guide.includes('https://developers.cloudflare.com/workers/static-assets/'),
    'guide cites the Cloudflare workers static-assets doc',
  );
  assert.match(guide, /\[assets\]/);
  assert.match(guide, /directory\s*=\s*"\.\/dist"/);
  const readme = await readFile(README, 'utf8');
  assert.match(readme, /v1\.2\.0/);
  const changelog = await readFile(CHANGELOG, 'utf8');
  assert.match(changelog, /1\.2\.0/);
  const topicsOwn = await readFile(OWN_TOPICS, 'utf8');
  assert.match(topicsOwn, /shipped v1\.2\.0/);
  const topicsSpa = await readFile(SPA_TOPICS, 'utf8');
  assert.match(
    topicsSpa,
    /\| deploy-cloudflare-workers \| 12101-12899 \| 13xx \| shipped v1\.2\.0 \| `deploymentTarget` \|/,
  );
});

test('assets-manifest-scan drives three fixture states and produces the expected pass fail pass verdicts (TC-075-probed-spa-fallback-shape)', async () => {
  const probe = await import(pathToFileURL(PROBE_MODULE).href);
  // Canonical state: pass.
  const canonical = await probe.scan({
    fixtureRoot: FIXTURE_ROOT,
    elicited: { 'assets-directory': './dist', 'run-worker-first': 'true' },
  });
  assert.equal(canonical.aggregateVerdict, 'pass');
  // SIMULATE_MIXED_SHAPE: prepend pages_build_output_dir and expect fail.
  const scratchDir = await mkdtemp(join(tmpdir(), 'cf-platform-mixed-'));
  const mixedManifestPath = join(scratchDir, 'wrangler.mixed.toml');
  const baseText = await readFile(join(FIXTURE_ROOT, 'wrangler.toml'), 'utf8');
  await writeFile(
    mixedManifestPath,
    'pages_build_output_dir = "./public"\n\n' + baseText,
    'utf8',
  );
  const mixed = await probe.scan({
    fixtureRoot: scratchDir,
    manifestPath: mixedManifestPath,
    elicited: { 'assets-directory': './dist', 'run-worker-first': 'true' },
  });
  assert.equal(mixed.aggregateVerdict, 'fail');
  const offending = mixed.results.find((r) => r.verdict === 'fail');
  assert.ok(offending && /pages_build_output_dir/.test(offending.detail));
  // SIMULATE_EMPTY_ASSETS: strip [assets] table and elicited empty answer -> pass.
  const emptyManifestPath = join(scratchDir, 'wrangler.empty-assets.toml');
  const stripped = baseText
    .split(/\r?\n/)
    .reduce(
      (acc, line) => {
        if (line.trim().startsWith('[assets]')) {
          acc.inAssets = true;
          return acc;
        }
        if (acc.inAssets && /^\s*\[/.test(line)) {
          acc.inAssets = false;
        }
        if (!acc.inAssets) acc.out.push(line);
        return acc;
      },
      { inAssets: false, out: [] },
    )
    .out.join('\n');
  await writeFile(emptyManifestPath, stripped, 'utf8');
  const empty = await probe.scan({
    fixtureRoot: scratchDir,
    manifestPath: emptyManifestPath,
    elicited: { 'assets-directory': '', 'run-worker-first': 'false' },
  });
  assert.equal(empty.aggregateVerdict, 'pass');
  assert.ok(
    empty.results.some((r) => /bare-Worker shape/.test(r.detail)),
    'empty-assets branch records the bare-Worker shape',
  );
  await rm(scratchDir, { recursive: true, force: true });
});

// Extra: apply-clean smoke bookmark against the shipped blueprint so a
// re-application on a fresh scratch project keeps landing the 41
// contributions AND records the two elicit answers on the applied
// sidecar. Not gated by any AC (belt-and-braces on the apply seam).

test('apply deploy-cloudflare-workers v1.2.0 lands 41 contributions and records the two elicit answers on the applied sidecar (bookmark)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'cf-t0-apply-'));
  try {
    await initProject({ projectRoot: scratch, projectName: 'cf-t0-apply', now: new Date() });
    const { tree } = await walkTree({ projectRoot: scratch });
    const result = await applyBlueprint({
      projectRoot: scratch,
      tree,
      source: BLUEPRINT_ROOT,
      elicitAnswers: { 'assets-directory': './public', 'run-worker-first': 'false' },
    });
    assert.equal(result.applied, true, JSON.stringify(result));
    assert.equal(result.slug, 'deploy-cloudflare-workers');
    const sidecar = JSON.parse(
      await readFile(join(scratch, 'rcf', 'blueprints', 'deploy-cloudflare-workers.applied.json'), 'utf8'),
    );
    assert.equal(sidecar.version, '1.3.2');
    assert.deepEqual(sidecar.appliedElicitations, {
      'assets-directory': './public',
      'run-worker-first': 'false',
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
