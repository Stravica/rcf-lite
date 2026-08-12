// Shared standards ruleset tests (NV-BL-SR-01, NV-BL-SR-02, NV-BL-SR-03).
//
// The ruleset is a single machine-readable artefact bundled inside the
// rcf-lite umbrella package. These tests verify the ratified shape (SR-01),
// the umbrella-version stamping (SR-02), and the v1 content (SR-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectRulesetDrift,
  getRuleset,
  getUmbrellaVersion,
  resetRulesetCache,
} from '#ruleset';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', '..', 'package.json');

function isCamelCase(key) {
  // Allow $-prefixed metadata keys ($schemaComment) and single-word keys.
  if (key.startsWith('$')) return true;
  return /^[a-z][a-zA-Z0-9]*$/.test(key);
}

function walkKeys(obj, path = '$') {
  const failures = [];
  if (obj === null || typeof obj !== 'object') return failures;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => failures.push(...walkKeys(v, `${path}[${i}]`)));
    return failures;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (!isCamelCase(k)) failures.push(`${path}.${k}`);
    failures.push(...walkKeys(v, `${path}.${k}`));
  }
  return failures;
}

test('getRuleset returns the artefact with rulesetVersion stamped from the umbrella package.json (NV-BL-SR-02)', async () => {
  resetRulesetCache();
  const ruleset = await getRuleset({ fresh: true });
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  assert.equal(ruleset.rulesetVersion, pkg.version, 'rulesetVersion must equal the umbrella package version');
  assert.equal(ruleset.id, 'rcf-lite-ruleset');
});

test('getUmbrellaVersion returns the umbrella package.json version (NV-BL-SR-02)', async () => {
  resetRulesetCache();
  const version = await getUmbrellaVersion();
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  assert.equal(version, pkg.version);
});

test('getRuleset ignores any rulesetVersion baked into the JSON artefact (NV-BL-SR-02 authoritative source)', async () => {
  resetRulesetCache();
  // The on-disk JSON must not carry a version field of its own. Assert by
  // reading it raw and confirming the loader has not silently absorbed a
  // baked-in rulesetVersion. NV-BL-SR-02 makes the umbrella version
  // authoritative; a divergence here would be a spec drift.
  const raw = await readFile(resolve(here, '..', '..', 'src', 'ruleset', 'ruleset.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.rulesetVersion, undefined, 'the artefact must not carry its own rulesetVersion field');
  const ruleset = await getRuleset({ fresh: true });
  assert.ok(ruleset.rulesetVersion, 'the loader must stamp rulesetVersion');
});

test('getRuleset artefact keys are camelCase per estate convention (NV-BL-SR-01)', async () => {
  resetRulesetCache();
  const ruleset = await getRuleset({ fresh: true });
  const bad = walkKeys(ruleset);
  assert.deepEqual(bad, [], `non-camelCase keys: ${bad.join(', ')}`);
});

test('ruleset v1 lists every NV-BL-ADM rule (NV-BL-SR-03)', async () => {
  const ruleset = await getRuleset({ fresh: true });
  const admIds = ruleset.admissibilityRules.map((r) => r.id);
  assert.deepEqual(
    admIds,
    ['NV-BL-ADM-01', 'NV-BL-ADM-02', 'NV-BL-ADM-03', 'NV-BL-ADM-04', 'NV-BL-ADM-05', 'NV-BL-ADM-06'],
  );
  // NV-BL-ADM-05's refuse-first, override-recorded posture is load-bearing
  // for the whole gate. Item 1 ratified REFUSE by default; assert it here
  // so a future edit that flips this to false trips the test.
  for (const rule of ruleset.admissibilityRules) {
    assert.equal(rule.refuseByDefault, true, `${rule.id} must refuse by default (ruling-sheet item 1)`);
  }
});

test('ruleset v1 lists every NV-BL-GATE rule (NV-BL-SR-03)', async () => {
  const ruleset = await getRuleset({ fresh: true });
  const gateIds = ruleset.gateRules.map((r) => r.id);
  assert.deepEqual(
    gateIds,
    ['NV-BL-GATE-01', 'NV-BL-GATE-02', 'NV-BL-GATE-03', 'NV-BL-GATE-04'],
  );
});

test('scope-tag vocabulary references rcf-schemas rather than owning the enum (NV-BL-ADM-02, ruling-sheet item 11)', async () => {
  const ruleset = await getRuleset({ fresh: true });
  assert.equal(ruleset.scopeTagVocabulary.sourcePackage, '@stravica-ai/rcf-schemas');
  assert.match(ruleset.scopeTagVocabulary.schemaRef, /common\.schema\.json#\/\$defs\/scopeTag$/);
  const values = ruleset.scopeTagVocabulary.values.map((v) => v.value);
  assert.deepEqual(values, ['library', 'runtime', 'deployed', 'unclassified']);
});

test('source-comment markers cover the ratified NV-BL-ADM-04 vocabulary case-insensitively', async () => {
  const ruleset = await getRuleset({ fresh: true });
  const markers = ruleset.sourceCommentMarkers.map((m) => m.marker);
  for (const required of ['TODO', 'FIXME', 'XXX', 'HACK', 'placeholder', 'v1 refinement', 'deferred', 'stub']) {
    assert.ok(markers.includes(required), `NV-BL-ADM-04 marker "${required}" missing from ruleset`);
  }
  for (const m of ruleset.sourceCommentMarkers) {
    assert.equal(m.caseInsensitive, true, `marker ${m.marker} must be case-insensitive per NV-BL-ADM-04`);
  }
});

test('TC template family lists the three ratified NV-BL-GATE-03 surfaces (server-boot, cli-invoke, container-run)', async () => {
  const ruleset = await getRuleset({ fresh: true });
  const templateIds = ruleset.tcTemplateFamily.map((t) => t.id);
  assert.deepEqual(templateIds, ['TCT-SERVER-BOOT', 'TCT-CLI-INVOKE', 'TCT-CONTAINER-RUN']);
});

test('ruling-consistency checks list the ratified NV-BL-GATE-04 light-mechanical family', async () => {
  const ruleset = await getRuleset({ fresh: true });
  for (const check of ruleset.rulingConsistencyChecks) {
    assert.equal(check.kind, 'lightMechanical', `${check.id} must be lightMechanical (ruling-sheet item 4)`);
  }
  const ids = ruleset.rulingConsistencyChecks.map((c) => c.id);
  assert.ok(ids.includes('RCC-EXTERNAL-RESOURCE-CONTRADICTION'));
  assert.ok(ids.includes('RCC-TIER-CAPABILITY-MISMATCH'));
});

test('toolScope covers chain admissibility AND traceability/query tools (NV-BL-SR-03, ruling-sheet item 1 addendum)', async () => {
  const ruleset = await getRuleset({ fresh: true });
  assert.equal(ruleset.toolScope.chainAdmissibility, true);
  assert.equal(ruleset.toolScope.traceabilityAndQueryTools, true);
});

test('detectRulesetDrift returns none on identical versions', async () => {
  resetRulesetCache();
  const shipping = await getRuleset({ fresh: true });
  const drift = await detectRulesetDrift({ chainRulesetVersion: shipping.rulesetVersion });
  assert.equal(drift.drift, 'none');
  assert.equal(drift.chainVersion, shipping.rulesetVersion);
});

test('detectRulesetDrift returns behavioural on a version mismatch (NV-BL-ADM-06 build-stage refusal)', async () => {
  const drift = await detectRulesetDrift({ chainRulesetVersion: '0.0.1-clearly-old' });
  assert.equal(drift.drift, 'behavioural');
  assert.equal(drift.chainVersion, '0.0.1-clearly-old');
});

test('detectRulesetDrift returns missing when the chain declared no ruleset version', async () => {
  const drift = await detectRulesetDrift({ chainRulesetVersion: null });
  assert.equal(drift.drift, 'missing');
  assert.equal(drift.chainVersion, null);
});

test('getRuleset is cached across calls (avoid re-reading the artefact per lint invocation)', async () => {
  resetRulesetCache();
  const a = await getRuleset();
  const b = await getRuleset();
  assert.strictEqual(a, b, 'getRuleset must return the same cached instance until resetRulesetCache is called');
});
