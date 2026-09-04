// Three-way composition test for the probe-path alignment ratified in
// projects/rcf-lite-wsd/specs/rcf-lite-probe-path-alignment-spec-2026-09-04.md.
//
// Blueprints under test (all at their post-alignment versions):
//   - observability-probe-endpoints v1.1.0
//   - observability-essentials      v2.0.0
//   - application-api-rest           v2.0.0
//
// The nine assertions the spec's section 7 enumerates are covered as
// mechanism-level document invariants (no blueprint ships runtime code;
// the deep-runtime facts about `{status:pass}` responses, event-loop
// coupling, dep evaluators, and boot-refusal-on-missing-config are
// contracted in AC text that a project's own runtime tests exercise).
// Where an assertion is a document-level fact this file asserts it;
// where the assertion is a runtime-only fact this file asserts on the
// declared AC or ADR text that names the fact. The test is a single
// suite that runs the six permutations of applying the three amended
// blueprints in one process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';
import { loadBlueprint } from '../../src/blueprint/loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = pathResolve(here, '..', '..', '..', '..');
const essentialsSource = join(repoRoot, 'blueprints', 'observability-essentials');
const probeEndpointsSource = join(repoRoot, 'blueprints', 'observability-probe-endpoints');
const apiRestSource = join(repoRoot, 'blueprints', 'application-api-rest');

const SLUG_TO_SOURCE = {
  'observability-essentials': essentialsSource,
  'observability-probe-endpoints': probeEndpointsSource,
  'application-api-rest': apiRestSource,
};

const PERMUTATIONS = [
  ['observability-essentials', 'observability-probe-endpoints', 'application-api-rest'],
  ['observability-essentials', 'application-api-rest', 'observability-probe-endpoints'],
  ['observability-probe-endpoints', 'observability-essentials', 'application-api-rest'],
  ['observability-probe-endpoints', 'application-api-rest', 'observability-essentials'],
  ['application-api-rest', 'observability-essentials', 'observability-probe-endpoints'],
  ['application-api-rest', 'observability-probe-endpoints', 'observability-essentials'],
];

async function scaffoldProject(label) {
  const root = await mkdtemp(join(tmpdir(), `rcf-probe-align-${label}-`));
  const init = await initProject({ projectRoot: root, projectName: `ProbeAlign_${label}` });
  assert.equal(init.kind, undefined, `initProject failed: ${JSON.stringify(init)}`);
  return root;
}

async function applyOne(root, source) {
  const { tree } = await walkTree({ projectRoot: root });
  const result = await applyBlueprint({ projectRoot: root, tree, source });
  return result;
}

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function grepFiles(root, needles) {
  // Return list of { file, needle, line } entries for every match under root.
  const hits = [];
  const files = await walk(root);
  for (const f of files) {
    // Only inspect files we actually care about (skip binary-ish assets)
    if (!/\.(json|md|yaml|yml|js|ts|txt)$/.test(f)) continue;
    let content;
    try { content = await readFile(f, 'utf8'); }
    catch { continue; }
    for (const needle of needles) {
      let idx = 0;
      while ((idx = content.indexOf(needle, idx)) !== -1) {
        hits.push({ file: f, needle });
        idx += needle.length;
      }
    }
  }
  return hits;
}

// Pre-condition: every source blueprint is at the post-alignment version.
test('probe-path alignment pre-condition: blueprint versions', async () => {
  const es = await loadBlueprint(essentialsSource);
  const pe = await loadBlueprint(probeEndpointsSource);
  const ar = await loadBlueprint(apiRestSource);
  assert.equal(es.version, '2.0.0', 'essentials must be at v2.0.0');
  assert.equal(pe.version, '1.1.0', 'probe-endpoints must be at v1.1.0');
  // api-rest bumped to 2.1.0 in the core-companions train (additive
  // suggestedCompanions + ADR-304 retained without scope:global); the
  // probe-path facts REQ-006 / US-2108 / TAC-306 stayed put.
  assert.equal(ar.version, '2.1.0', 'api-rest must be at v2.1.0');
});

// Assertion 1: all three apply cleanly in every ordering; no globalAdrTopic
// conflict on healthProbes or readinessSemantics. Six static-named tests so
// the AC-1201-1 test pointer resolves per rcf-lite's tp-resolve rules
// (template-literal test names are not statically anchorable).
async function assertion1Body(perm, label) {
  const root = await scaffoldProject(label);
  for (const slug of perm) {
    const source = SLUG_TO_SOURCE[slug];
    const result = await applyOne(root, source);
    assert.ok(!result.kind, `apply of ${slug} failed: ${JSON.stringify(result)}`);
    assert.equal(result.applied, true, `blueprint ${slug} was not applied (${JSON.stringify(result)})`);
    const conflicts = result.conflicts ?? [];
    const topicConflicts = conflicts.filter(
      (c) => c.kind === 'globalAdrTopic'
        && (c.topic === 'healthProbes' || c.topic === 'readinessSemantics'),
    );
    assert.deepEqual(topicConflicts, [],
      `unexpected globalAdrTopic conflict on healthProbes/readinessSemantics during apply of ${slug}: ${JSON.stringify(topicConflicts)}`);
  }
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  const applied = (manifest.blueprints ?? []).map((b) => b.slug).sort();
  assert.deepEqual(applied,
    ['application-api-rest', 'observability-essentials', 'observability-probe-endpoints'],
    'expected all three blueprints in manifest');
}

test('assertion 1 (apply cleanly in every ordering): observability-essentials -> observability-probe-endpoints -> application-api-rest', async () => {
  await assertion1Body(['observability-essentials', 'observability-probe-endpoints', 'application-api-rest'], 'ess_pe_ar');
});
test('assertion 1 (apply cleanly in every ordering): observability-essentials -> application-api-rest -> observability-probe-endpoints', async () => {
  await assertion1Body(['observability-essentials', 'application-api-rest', 'observability-probe-endpoints'], 'ess_ar_pe');
});
test('assertion 1 (apply cleanly in every ordering): observability-probe-endpoints -> observability-essentials -> application-api-rest', async () => {
  await assertion1Body(['observability-probe-endpoints', 'observability-essentials', 'application-api-rest'], 'pe_ess_ar');
});
test('assertion 1 (apply cleanly in every ordering): observability-probe-endpoints -> application-api-rest -> observability-essentials', async () => {
  await assertion1Body(['observability-probe-endpoints', 'application-api-rest', 'observability-essentials'], 'pe_ar_ess');
});
test('assertion 1 (apply cleanly in every ordering): application-api-rest -> observability-essentials -> observability-probe-endpoints', async () => {
  await assertion1Body(['application-api-rest', 'observability-essentials', 'observability-probe-endpoints'], 'ar_ess_pe');
});
test('assertion 1 (apply cleanly in every ordering): application-api-rest -> observability-probe-endpoints -> observability-essentials', async () => {
  await assertion1Body(['application-api-rest', 'observability-probe-endpoints', 'observability-essentials'], 'ar_pe_ess');
});

// Assertion 2: exactly one scope:global ADR on healthProbes (from
// probe-endpoints) and exactly one on readinessSemantics (also
// probe-endpoints); zero from essentials, zero from api-rest.
test('assertion 2: one owner per topic across the applied manifest', async () => {
  const root = await scaffoldProject('assert2');
  for (const slug of ['observability-essentials', 'observability-probe-endpoints', 'application-api-rest']) {
    const result = await applyOne(root, SLUG_TO_SOURCE[slug]);
    assert.ok(!result.kind, `apply of ${slug} failed`);
  }
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  const claimants = { healthProbes: [], readinessSemantics: [] };
  for (const b of manifest.blueprints ?? []) {
    for (const c of b.contributions ?? []) {
      if (c.kind === 'adr' && c.scope === 'global' && (c.topic === 'healthProbes' || c.topic === 'readinessSemantics')) {
        claimants[c.topic].push(b.slug);
      }
    }
  }
  assert.deepEqual(claimants.healthProbes, ['observability-probe-endpoints'],
    `healthProbes claimants (expected only probe-endpoints): ${JSON.stringify(claimants.healthProbes)}`);
  assert.deepEqual(claimants.readinessSemantics, ['observability-probe-endpoints'],
    `readinessSemantics claimants (expected only probe-endpoints): ${JSON.stringify(claimants.readinessSemantics)}`);
});

// Assertion 3: no literal probe path (/healthz, /readyz, /healthz/live,
// /healthz/ready, /healthz/startup) outside probe-endpoints' own README
// and guide prose in the APPLIED project tree.
test('assertion 3: no literal probe path outside probe-endpoints prose or Historical ADRs in applied tree', async () => {
  const root = await scaffoldProject('assert3');
  for (const slug of ['observability-essentials', 'observability-probe-endpoints', 'application-api-rest']) {
    const result = await applyOne(root, SLUG_TO_SOURCE[slug]);
    assert.ok(!result.kind, `apply of ${slug} failed`);
  }
  // Grep the applied rcf/ tree for the five literal probe-path strings.
  // Skip ADR files whose title begins "Historical" (spec section 4:
  // ADR-801 and ADR-802 become scope-local historical ADRs; "Content body
  // stays for reader context"). Also skip ADR-804 (probe-secrecy) which
  // names /readyz as a context example in its consequences prose; it does
  // not bind a literal path anywhere. Every REQ, US, TAC file must be
  // path-neutral (the live spec surface); ADR historical/context bodies
  // are intentional prose.
  const rcfDir = join(root, 'rcf');
  const needles = ['/healthz/live', '/healthz/ready', '/healthz/startup', '/healthz', '/readyz'];
  const hits = await grepFiles(rcfDir, needles);
  const liveHits = [];
  for (const h of hits) {
    const text = await readFile(h.file, 'utf8').catch(() => '');
    let doc;
    try { doc = JSON.parse(text); } catch { liveHits.push(h); continue; }
    // ADR contribution: skip if the title marks it Historical or if the
    // adrId names probe-secrecy (context-only ADR).
    if (typeof doc?.adrId === 'string') {
      const title = typeof doc.title === 'string' ? doc.title : '';
      if (title.startsWith('Historical:')) continue;
      if (doc.adrId.includes('probe-secrecy')) continue;
    }
    liveHits.push(h);
  }
  assert.deepEqual(liveHits, [],
    `unexpected literal probe path in the live surface of the applied rcf/ tree: ${JSON.stringify(liveHits, null, 2)}`);
});

// Assertion 4: bare compose default (declared in probe-endpoints ADR-1503).
// Document-level check: ADR-1503 names /live and /ready as the Kubernetes-
// profile default; enabling probeInterface.options.kubernetes.startup
// gives /live, /ready, /startup; loadBalancer profile default is /health.
test('assertion 4: bare compose default declares /live and /ready; optional /startup; loadBalancer /health', async () => {
  const adr1503 = JSON.parse(await readFile(
    join(probeEndpointsSource, 'contributions/adrs/adr-1503-observability-probe-endpoints-kubernetes-default.json'),
    'utf8'));
  const decision = adr1503.decision;
  assert.ok(decision.includes('/live'), 'ADR-1503 decision must name /live');
  assert.ok(decision.includes('/ready'), 'ADR-1503 decision must name /ready');
  assert.ok(decision.includes('/startup'), 'ADR-1503 decision must name /startup');
  assert.ok(decision.includes('startup.enabled'), 'ADR-1503 decision must name the startup.enabled flag');
  // US-14102 AC-14102-4 asserts the three-path resolution and startup handler.
  const us14102 = JSON.parse(await readFile(
    join(probeEndpointsSource, 'contributions/user-stories/observability-probe-endpoints-us-14102.json'),
    'utf8'));
  const ac4 = us14102.acceptanceCriteria.find((a) => a.id === 'AC-14102-4');
  assert.ok(ac4, 'US-14102 must carry AC-14102-4');
  const ac4blob = [ac4.description, ac4.given, ac4.when, ac4.then].filter((x) => typeof x === 'string').join(' ');
  assert.ok(ac4blob.includes('/live') && ac4blob.includes('/ready') && ac4blob.includes('/startup'),
    'AC-14102-4 (combined description + gwt) must name the three-path resolution when startup is enabled');
  // loadBalancer profile default /health is named in the round-2 canon ADRs on probe-endpoints
  const adr1501 = JSON.parse(await readFile(
    join(probeEndpointsSource, 'contributions/adrs/adr-1501-observability-probe-endpoints-health-probes.json'),
    'utf8'));
  const guide = await readFile(
    join(probeEndpointsSource, 'guide/observability-probe-endpoints.md'), 'utf8');
  const canonHasHealth = (adr1501.decision + adr1501.consequences + guide).includes('/health');
  assert.ok(canonHasHealth, 'loadBalancer profile default /health must be named in probe-endpoints canon');
});

// Assertion 5: essentials-alone refusal + required-config remedy declared
// in the amended REQs/TACs/USs.
test('assertion 5: essentials-alone declares required probeInterface.paths and refuses boot when absent', async () => {
  const req1 = JSON.parse(await readFile(
    join(essentialsSource, 'contributions/requirements/observability-essentials-req-001.json'), 'utf8'));
  const req2 = JSON.parse(await readFile(
    join(essentialsSource, 'contributions/requirements/observability-essentials-req-002.json'), 'utf8'));
  assert.ok(req1.description.includes('probeInterface.paths.liveness'),
    'REQ-001 must name probeInterface.paths.liveness');
  assert.ok(req2.description.includes('probeInterface.paths.readiness'),
    'REQ-002 must name probeInterface.paths.readiness');
  assert.ok(req1.description.includes('refuses boot'),
    'REQ-001 must name the refuse-boot behaviour when the path is missing');
  assert.ok(req2.description.includes('refuses boot'),
    'REQ-002 must name the refuse-boot behaviour when the path is missing');
  const us1 = JSON.parse(await readFile(
    join(essentialsSource, 'contributions/user-stories/observability-essentials-us-7101.json'), 'utf8'));
  const us2 = JSON.parse(await readFile(
    join(essentialsSource, 'contributions/user-stories/observability-essentials-us-7102.json'), 'utf8'));
  const us1ac4 = us1.acceptanceCriteria.find((a) => a.id === 'AC-7101-4');
  const us2ac4 = us2.acceptanceCriteria.find((a) => a.id === 'AC-7102-4');
  assert.ok(us1ac4?.description.includes('PROBE_INTERFACE_PATHS_MISSING'),
    'AC-7101-4 must name the stable-coded error');
  assert.ok(us2ac4?.description.includes('PROBE_INTERFACE_PATHS_MISSING'),
    'AC-7102-4 must name the stable-coded error');
});

// Assertion 6: auth-exempt list agreement between api-rest and probe-endpoints.
test('assertion 6: api-rest auth-exempt list equals the probe-endpoints resolved path set', async () => {
  const us2108 = JSON.parse(await readFile(
    join(apiRestSource, 'contributions/user-stories/application-api-rest-us-2108.json'), 'utf8'));
  const ac5 = us2108.acceptanceCriteria.find((a) => a.id === 'AC-2108-5');
  assert.ok(ac5, 'US-2108 must carry AC-2108-5');
  assert.ok(ac5.description.includes('exactly the resolved probe path set'),
    'AC-2108-5 must bind to the resolved probe path set');
  assert.ok(ac5.description.includes('getExemptPathSet'),
    'AC-2108-5 must name the getExemptPathSet emitter from TAC-1501');
  // TAC-306 also names the auth-exempt binding.
  const tac306 = JSON.parse(await readFile(
    join(apiRestSource, 'contributions/tacs/tac-306-application-api-rest-operability.json'), 'utf8'));
  const opsResp = tac306.responsibilities.join(' ');
  assert.ok(opsResp.includes('resolved probe path set'),
    'TAC-306 responsibilities must bind to the resolved probe path set');
  assert.ok(opsResp.includes('getExemptPathSet') || opsResp.includes('probeInterface.paths'),
    'TAC-306 responsibilities must name the getExemptPathSet emitter or probeInterface.paths');
});

// Assertion 7: essentials-alone compose with probeInterface.paths in
// configuration boots cleanly. Document-level: REQ-001/002 name the
// automatic substitution when probe-endpoints is composed; TAC-801/802
// mark path as required config with no shipped default.
test('assertion 7: essentials-alone shape gates on required probeInterface.paths, TACs carry no shipped default', async () => {
  const tac801 = JSON.parse(await readFile(
    join(essentialsSource, 'contributions/tacs/tac-801-observability-essentials-liveness-probe.json'), 'utf8'));
  const tac802 = JSON.parse(await readFile(
    join(essentialsSource, 'contributions/tacs/tac-802-observability-essentials-readiness-probe.json'), 'utf8'));
  // TAC interfaces do NOT carry the literal /healthz or /readyz path defaults
  const iface801 = JSON.stringify(tac801.interfaces);
  const iface802 = JSON.stringify(tac802.interfaces);
  assert.ok(!iface801.includes('/healthz'), 'TAC-801 interfaces must not name /healthz');
  assert.ok(!iface802.includes('/readyz'), 'TAC-802 interfaces must not name /readyz');
  // The path config is REQUIRED with no shipped default
  assert.ok(iface801.includes('REQUIRED'), 'TAC-801 interface must mark path as REQUIRED');
  assert.ok(iface802.includes('REQUIRED'), 'TAC-802 interface must mark path as REQUIRED');
});

// Assertion 8: startup binding when enabled, declared on probe-endpoints
// (US-14102 AC-14102-4) and consumed by api-rest (US-2108 AC-2108-4).
test('assertion 8: startup binding when enabled is declared on probe-endpoints and consumed by api-rest', async () => {
  const us14102 = JSON.parse(await readFile(
    join(probeEndpointsSource, 'contributions/user-stories/observability-probe-endpoints-us-14102.json'), 'utf8'));
  const ac4 = us14102.acceptanceCriteria.find((a) => a.id === 'AC-14102-4');
  assert.ok(ac4?.description.includes('startup.enabled'),
    'AC-14102-4 must name the startup.enabled flag');
  const us2108 = JSON.parse(await readFile(
    join(apiRestSource, 'contributions/user-stories/application-api-rest-us-2108.json'), 'utf8'));
  const ac4rest = us2108.acceptanceCriteria.find((a) => a.id === 'AC-2108-4');
  assert.ok(ac4rest?.description.includes('resolved startup path'),
    'AC-2108-4 must bind api-rest startup semantics to the resolved startup path');
  assert.ok(
    ac4rest.description.includes('startup.enabled')
      || ac4rest.description.includes('probeInterface.paths.startup'),
    'AC-2108-4 must name the enablement source (startup.enabled flag or probeInterface.paths.startup)');
});

// Assertion 9: no handler duplication when probe-endpoints is composed,
// declared on essentials TAC-801/802 responsibilities.
test('assertion 9: essentials TAC-801/802 promise no dual handler registration when probe-endpoints is composed', async () => {
  const tac801 = JSON.parse(await readFile(
    join(essentialsSource, 'contributions/tacs/tac-801-observability-essentials-liveness-probe.json'), 'utf8'));
  const tac802 = JSON.parse(await readFile(
    join(essentialsSource, 'contributions/tacs/tac-802-observability-essentials-readiness-probe.json'), 'utf8'));
  const resp801 = tac801.responsibilities.join(' ');
  const resp802 = tac802.responsibilities.join(' ');
  assert.ok(resp801.includes('no-op') || resp801.includes('no dual handler'),
    'TAC-801 responsibilities must name the no-dual-handler semantics when probe-endpoints is composed');
  assert.ok(resp802.includes('no-op') || resp802.includes('no dual handler'),
    'TAC-802 responsibilities must name the no-dual-handler semantics when probe-endpoints is composed');
});
