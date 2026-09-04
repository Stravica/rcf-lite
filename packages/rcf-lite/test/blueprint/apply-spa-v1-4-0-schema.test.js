// Spec 2026-09-03, AC-1102-5: applying application-spa v1.4.0 must produce a
// manifest that still validates against rcf-schemas 0.5.1. The applied
// blueprint record carries no new field (browserSurface lives on the source
// blueprint.json only, read back at need by doctor and the delivery-ci-
// workflows materialiser); the additive .browserSurface top-level on the
// source blueprint.json passes the loader's shape validation because
// blueprint.json accepts optional additive top-level fields.
//
// This test binds the current shipped blueprint content against the shipped
// schema package: if either drifts in a way that would fail the manifest
// validator, the suite trips before we ship.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';
import { loadBlueprint } from '../../src/blueprint/loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = pathResolve(here, '..', '..', '..', '..');
const spaSource = join(repoRoot, 'blueprints', 'application-spa');

test('AC-1102-5: apply application-spa v1.4.0 -> manifest still validates + no browserSurface on the applied record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-spa-14-'));
  await initProject({ projectRoot: root, projectName: 'SpaV14Fixture' });

  // Precondition: the shipped SPA blueprint is at 1.4.0 and declares
  // browserSurface on its blueprint.json (the two facts spec section 9
  // asserts on the source).
  const bp = await loadBlueprint(spaSource);
  assert.equal(bp.version, '1.5.0');
  const meta = JSON.parse(await readFile(join(spaSource, 'blueprint.json'), 'utf8'));
  assert.equal(meta.browserSurface?.declared, true);

  // Apply the blueprint. The tree walk that follows revalidates the
  // manifest against rcf-schemas via core/store/validator.
  const { tree } = await walkTree({ projectRoot: root });
  const applyResult = await applyBlueprint({ projectRoot: root, tree, source: spaSource });
  assert.ok(!applyResult.kind, `apply failed: ${JSON.stringify(applyResult)}`);
  assert.equal(applyResult.applied, true, 'blueprint applied cleanly');

  // Re-walk to force manifest revalidation via loadRootDocument/walker
  // (which runs validateDocument on manifest.json).
  const { errors } = await walkTree({ projectRoot: root });
  const validationErrors = (errors ?? []).filter(
    (e) => e.filePath === 'rcf/manifest.json',
  );
  assert.deepEqual(validationErrors, [],
    `manifest validation errors after apply: ${JSON.stringify(validationErrors)}`);

  // Applied record carries source but NO browserSurface field of its own
  // (the schema is additionalProperties:false on appliedBlueprintRecord).
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  const record = manifest.blueprints.find((b) => b.slug === 'application-spa');
  assert.ok(record, 'applied blueprint record present');
  assert.equal(record.version, '1.5.0');
  assert.ok(typeof record.source === 'string' && record.source.length > 0);
  assert.equal(record.browserSurface, undefined,
    'browserSurface must NOT land on the applied record (spec CONCERNS: rcf-schemas 0.5.1 forbids it via additionalProperties:false; doctor reads it off the source manifest)');
});
