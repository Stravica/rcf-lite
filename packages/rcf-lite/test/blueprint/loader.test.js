// Unit tests for src/blueprint/loader.js.
//
// Covers two pre-registry safety guards added in w-2026-08-19-004:
//
//  - Contributable-kind gate. Blueprints compose downward from project
//    singletons; the loader refuses PRD / TAD / BS (each a project
//    singleton) and FBS (excluded by ratified principle -- composition
//    sits at the requirements layer, not the build layer).
//  - Contribution-path guard. Contribution paths are always relative
//    to the blueprint's contributions/ dir; absolute paths and `..`
//    traversal are refused before Phase 2 fronts this loader with a
//    registry that could otherwise ship escape paths on a blueprint's
//    behalf.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadBlueprint } from '../../src/blueprint/loader.js';

async function writeBlueprintMeta(meta, extras = []) {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-blueprint-loader-'));
  await mkdir(join(dir, 'contributions'), { recursive: true });
  await writeFile(join(dir, 'blueprint.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  for (const [rel, body] of extras) {
    const abs = join(dir, 'contributions', rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body, 'utf8');
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Item 4: contributable-kind gate.
// ---------------------------------------------------------------------------

for (const kind of ['prd', 'tad', 'bs']) {
  test(`loadBlueprint refuses '${kind}' contributions (project singleton, not blueprint-owned)`, async () => {
    const dir = await writeBlueprintMeta({
      slug: 'demo', version: '1.0.0',
      contributions: [{ kind, id: `${kind.toUpperCase()}-001`, path: `${kind}.json` }],
    });
    const result = await loadBlueprint(dir);
    assert.equal(result.kind, 'validation', `expected validation error, got ${JSON.stringify(result)}`);
    assert.match(result.message, new RegExp(`kind '${kind}' is a project singleton`));
  });
}

test("loadBlueprint refuses 'fbs' contributions (excluded by ratified principle)", async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0',
    contributions: [{ kind: 'fbs', id: 'FBS-001', path: 'fbs-001.json' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, 'validation');
  assert.match(result.message, /kind 'fbs' is excluded from blueprint composition/);
});

test('loadBlueprint refuses an unknown kind with a structured error', async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0',
    contributions: [{ kind: 'not-a-kind', id: 'REQ-001', path: 'x.json' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, 'validation');
  assert.match(result.message, /kind 'not-a-kind' is not a recognised contributable kind/);
});

test('loadBlueprint accepts REQ / US / TAC / ADR / TS / CN kinds', async () => {
  // The full contributable set. Just a shape check -- the loader only
  // validates metadata; it does not read the contribution files. Path
  // strings are valid relative paths (`x.json`).
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0',
    contributions: [
      { kind: 'req', id: 'demo-REQ-001', path: 'demo-req-001.json' },
      { kind: 'us', id: 'demo-US-001', path: 'demo-us-001.json' },
      { kind: 'tac', id: 'TAC-001-demo', path: 'tac-001-demo.json' },
      { kind: 'adr', id: 'ADR-001-demo', path: 'adr-001-demo.json' },
      { kind: 'ts', id: 'demo-TS-001', path: 'demo-ts-001.json' },
      { kind: 'cn', id: 'CN-001-demo', path: 'cn-001-demo.json' },
    ],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, undefined, `unexpected error: ${JSON.stringify(result)}`);
  assert.equal(result.contributions.length, 6);
});

// ---------------------------------------------------------------------------
// Item 7: contribution-path guard (relative only; no absolute paths, no
// parent-directory traversal).
// ---------------------------------------------------------------------------

test('loadBlueprint refuses a contribution with an absolute POSIX path', async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'demo-REQ-001', path: '/etc/passwd' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, 'validation');
  assert.match(result.message, /must be relative/);
});

test('loadBlueprint refuses a contribution with a Windows-drive absolute path', async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'demo-REQ-001', path: 'C:\\Windows\\evil.json' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, 'validation');
  assert.match(result.message, /must be relative/);
});

test('loadBlueprint refuses a contribution path with a `..` segment (parent-directory traversal)', async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'demo-REQ-001', path: '../escape.json' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, 'validation');
  assert.match(result.message, /contains a '\.\.' segment/);
});

test('loadBlueprint refuses a contribution path with a `..` segment mid-path', async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'demo-REQ-001', path: 'sub/../../escape.json' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, 'validation');
  assert.match(result.message, /contains a '\.\.' segment/);
});

test('loadBlueprint accepts nested-relative contribution paths (no traversal)', async () => {
  // A blueprint may organise contributions into subdirectories under
  // contributions/; the path guard is not a flat-layout mandate.
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0',
    contributions: [
      { kind: 'req', id: 'demo-REQ-001', path: 'reqs/demo-req-001.json' },
    ],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, undefined, `unexpected error: ${JSON.stringify(result)}`);
});

// ---------------------------------------------------------------------------
// Category field. Optional lower-kebab tag that groups the shelf on
// `rcf define blueprint list` and on the docs blueprint shelf. Shape
// only; vocabulary lives in the authoring standard.
// ---------------------------------------------------------------------------

test('loadBlueprint returns category when the metadata declares it', async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0', category: 'security',
    contributions: [{ kind: 'req', id: 'demo-REQ-001', path: 'demo-req-001.json' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, undefined, `unexpected error: ${JSON.stringify(result)}`);
  assert.equal(result.category, 'security');
});

test('loadBlueprint omits category when the metadata does not declare it', async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'demo-REQ-001', path: 'demo-req-001.json' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, undefined, `unexpected error: ${JSON.stringify(result)}`);
  assert.equal(result.category, undefined);
});

test('loadBlueprint accepts multi-segment kebab categories', async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0', category: 'developer-experience',
    contributions: [{ kind: 'req', id: 'demo-REQ-001', path: 'demo-req-001.json' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, undefined);
  assert.equal(result.category, 'developer-experience');
});

for (const bad of ['Security', 'security!', '1security', 'security_group', '', ' ']) {
  test(`loadBlueprint refuses category '${bad}' (not a kebab slug)`, async () => {
    const dir = await writeBlueprintMeta({
      slug: 'demo', version: '1.0.0', category: bad,
      contributions: [{ kind: 'req', id: 'demo-REQ-001', path: 'demo-req-001.json' }],
    });
    const result = await loadBlueprint(dir);
    assert.equal(result.kind, 'validation', `expected validation error, got ${JSON.stringify(result)}`);
    assert.match(result.message, /is not a valid kebab slug/);
  });
}

test('loadBlueprint refuses category typed as non-string', async () => {
  const dir = await writeBlueprintMeta({
    slug: 'demo', version: '1.0.0', category: 42,
    contributions: [{ kind: 'req', id: 'demo-REQ-001', path: 'demo-req-001.json' }],
  });
  const result = await loadBlueprint(dir);
  assert.equal(result.kind, 'validation');
  assert.match(result.message, /is not a valid kebab slug/);
});
