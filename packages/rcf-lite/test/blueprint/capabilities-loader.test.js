// Loader shape tests for the capability-declaration mechanism
// (visual round T-5 spec section 5.5.2). Covers TS-051 test cases
// TC-051-loader-capabilities-shape, TC-051-loader-elicits-shape and
// TC-051-loader-requires-shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadBlueprint } from '../../src/blueprint/loader.js';

async function scratchBlueprint(overrides) {
  const dir = await mkdtemp(join(tmpdir(), 'cap-loader-'));
  await mkdir(join(dir, 'contributions'), { recursive: true });
  const doc = {
    slug: 'test-bp',
    version: '1.0.0',
    category: 'application',
    contributions: [],
    ...overrides,
  };
  await writeFile(join(dir, 'blueprint.json'), JSON.stringify(doc, null, 2));
  return dir;
}

test('loader accepts capabilities[] shape and refuses malformed variants (TC-051-loader-capabilities-shape)', async () => {
  const ok = await scratchBlueprint({ capabilities: ['principalDirectory', 'roleModel'] });
  const okLoaded = await loadBlueprint(ok);
  assert.equal(okLoaded.kind, undefined, JSON.stringify(okLoaded));
  assert.deepEqual(okLoaded.capabilities, ['principalDirectory', 'roleModel']);

  const emptyDir = await scratchBlueprint({ capabilities: [] });
  const empty = await loadBlueprint(emptyDir);
  assert.equal(empty.kind, 'validation');
  assert.match(empty.message, /capabilities must be a non-empty array/);

  const nonStringDir = await scratchBlueprint({ capabilities: [1] });
  const nonString = await loadBlueprint(nonStringDir);
  assert.equal(nonString.kind, 'validation');
  assert.match(nonString.message, /not lower camelCase/);

  const nonCamelDir = await scratchBlueprint({ capabilities: ['bad-slug'] });
  const nonCamel = await loadBlueprint(nonCamelDir);
  assert.equal(nonCamel.kind, 'validation');
  assert.match(nonCamel.message, /not lower camelCase/);
});

test('loader accepts elicits[] shape and refuses malformed variants (TC-051-loader-elicits-shape)', async () => {
  const ok = await scratchBlueprint({
    elicits: [
      { id: 'baseline-roles', prompt: 'Baseline roles for the matrix.', kind: 'string', default: 'Owner, Admin' },
      { id: 'tenancy-shape', prompt: 'Tenancy shape.', kind: 'enum', options: ['per-user', 'per-org'], default: 'per-user', when: { requiresCapability: ['tenancy'] } },
      { id: 'audit-write', prompt: 'Should audit write?', kind: 'boolean', default: true },
    ],
  });
  const okLoaded = await loadBlueprint(ok);
  assert.equal(okLoaded.kind, undefined, JSON.stringify(okLoaded));
  assert.equal(okLoaded.elicits.length, 3);
  assert.equal(okLoaded.elicits[1].kind, 'enum');
  assert.deepEqual(okLoaded.elicits[1].options, ['per-user', 'per-org']);
  assert.deepEqual(okLoaded.elicits[1].when.requiresCapability, ['tenancy']);

  const emptyDir = await scratchBlueprint({ elicits: [] });
  const empty = await loadBlueprint(emptyDir);
  assert.equal(empty.kind, 'validation');
  assert.match(empty.message, /elicits must be a non-empty array/);

  const badKindDir = await scratchBlueprint({ elicits: [{ id: 'x', prompt: 'p', kind: 'number' }] });
  const badKind = await loadBlueprint(badKindDir);
  assert.equal(badKind.kind, 'validation');
  assert.match(badKind.message, /kind 'number' must be one of/);

  const emDashDir = await scratchBlueprint({ elicits: [{ id: 'x', prompt: 'p — y', kind: 'string' }] });
  const emDash = await loadBlueprint(emDashDir);
  assert.equal(emDash.kind, 'validation');
  assert.match(emDash.message, /contains an em-dash/);

  const enumMissingOpts = await scratchBlueprint({ elicits: [{ id: 'x', prompt: 'p', kind: 'enum' }] });
  const enumMissing = await loadBlueprint(enumMissingOpts);
  assert.equal(enumMissing.kind, 'validation');
  assert.match(enumMissing.message, /kind=enum requires a non-empty options/);
});

test('loader accepts requiresAppliedCapabilities shape and refuses malformed variants (TC-051-loader-requires-shape)', async () => {
  const ok = await scratchBlueprint({
    requiresAppliedCapabilities: { capabilities: ['principalDirectory'], allowSkipFlag: 'allow-no-auth-yet', refusalMessageId: 'test-refusal' },
  });
  const okLoaded = await loadBlueprint(ok);
  assert.equal(okLoaded.kind, undefined, JSON.stringify(okLoaded));
  assert.deepEqual(okLoaded.requiresAppliedCapabilities.capabilities, ['principalDirectory']);
  assert.equal(okLoaded.requiresAppliedCapabilities.allowSkipFlag, 'allow-no-auth-yet');

  const emptyCaps = await scratchBlueprint({
    requiresAppliedCapabilities: { capabilities: [], allowSkipFlag: 'skip-me', refusalMessageId: 'x' },
  });
  const emptyLoaded = await loadBlueprint(emptyCaps);
  assert.equal(emptyLoaded.kind, 'validation');
  assert.match(emptyLoaded.message, /capabilities must be a non-empty array/);

  const badFlag = await scratchBlueprint({
    requiresAppliedCapabilities: { capabilities: ['principalDirectory'], allowSkipFlag: 'BadFlag', refusalMessageId: 'x' },
  });
  const badFlagLoaded = await loadBlueprint(badFlag);
  assert.equal(badFlagLoaded.kind, 'validation');
  assert.match(badFlagLoaded.message, /allowSkipFlag 'BadFlag' is not a kebab slug/);
});
