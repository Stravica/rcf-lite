// Phase 2b: applyBlueprint with an external-library qualified reference.
// Covers effective-slug stamping (spec §5.3), applied-record slug/source
// fields, and the apply-time band gate (spec §8.3, question 9.9 ratified
// as "add both").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject, walkTree } from '#core/store';
import { applyBlueprint } from '../../src/blueprint/apply.js';

async function scaffoldProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-lib-apply-'));
  const init = await initProject({ projectRoot: root, projectName: 'LibraryApplyTest' });
  assert.equal(init.kind, undefined, `initProject failed: ${JSON.stringify(init)}`);
  return root;
}

async function writeBlueprint(root, { slug, version = '1.0.0', contributions }) {
  const dir = join(root, `blueprint-${slug}`);
  await mkdir(join(dir, 'contributions'), { recursive: true });
  await writeFile(join(dir, 'blueprint.json'), JSON.stringify({ slug, version, contributions }, null, 2), 'utf8');
  for (const c of contributions) {
    const abs = join(dir, 'contributions', c.path);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, JSON.stringify(c.body, null, 2), 'utf8');
  }
  return dir;
}

const now = new Date('2026-09-01T10:00:00Z');

const reqBody = (reqId) => ({
  reqId, prdId: 'PRD-001',
  title: 'External-library REQ',
  description: 'A REQ authored under a library.',
  category: 'functional', priority: 'must', domain: 'ui',
  version: '0.1.0', status: 'draft',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
});

test('effectiveSlug rewires manifest.slug and stamping namespace to <libraryPrefix>-<blueprintSlug>', async () => {
  const root = await scaffoldProject();
  const source = await writeBlueprint(root, {
    slug: 'auth-oauth2',
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json', body: reqBody('wsd-auth-oauth2-REQ-50101') }],
  });
  const { tree } = await walkTree({ projectRoot: root });
  const result = await applyBlueprint({
    projectRoot: root, tree, source, now,
    displaySource: 'wsd:auth-oauth2',
    effectiveSlug: 'wsd-auth-oauth2',
    libraryBands: { ac: { start: 50000, end: 59999 } },
  });
  assert.equal(result.applied, true, `unexpected: ${JSON.stringify(result)}`);
  // Manifest slug carries the effective library-qualified slug.
  assert.equal(result.slug, 'wsd-auth-oauth2');
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.blueprints.length, 1);
  assert.equal(manifest.blueprints[0].slug, 'wsd-auth-oauth2');
  // Source records the qualified typed ref (not the resolved cache path).
  assert.equal(manifest.blueprints[0].source, 'wsd:auth-oauth2');
  // Contribution stamped under the effective slug on disk.
  const written = JSON.parse(await readFile(join(root, 'rcf', 'requirements', 'wsd-auth-oauth2-req-50101.json'), 'utf8'));
  assert.equal(written.reqId, 'wsd-auth-oauth2-REQ-50101');
});

test('apply-time band gate refuses a REQ contribution outside the library AC band', async () => {
  const root = await scaffoldProject();
  const source = await writeBlueprint(root, {
    slug: 'auth-oauth2',
    contributions: [{ kind: 'req', id: 'REQ-99001', path: 'req.json', body: reqBody('wsd-auth-oauth2-REQ-99001') }],
  });
  const { tree } = await walkTree({ projectRoot: root });
  const result = await applyBlueprint({
    projectRoot: root, tree, source, now,
    displaySource: 'wsd:auth-oauth2',
    effectiveSlug: 'wsd-auth-oauth2',
    libraryBands: { ac: { start: 50000, end: 59999 } },
  });
  assert.equal(result.kind, 'usage');
  assert.match(result.message, /outside library AC band 50000-59999/);
  // Manifest untouched.
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.ok(!manifest.blueprints || manifest.blueprints.length === 0);
});

test('apply-time band gate refuses an ADR contribution outside a declared suffix block', async () => {
  const root = await scaffoldProject();
  const adrBody = {
    adrId: 'ADR-9999-wsd-auth-oauth2', title: 't', status: 'accepted',
    context: 'c', decision: 'd', consequences: 'q',
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  };
  const source = await writeBlueprint(root, {
    slug: 'auth-oauth2',
    contributions: [{ kind: 'adr', id: 'ADR-9999', path: 'adr.json', body: adrBody }],
  });
  const { tree } = await walkTree({ projectRoot: root });
  const result = await applyBlueprint({
    projectRoot: root, tree, source, now,
    effectiveSlug: 'wsd-auth-oauth2',
    displaySource: 'wsd:auth-oauth2',
    libraryBands: { ac: { start: 50000, end: 59999 }, suffixBlocks: [{ kind: 'adr', start: 5000, end: 5099 }] },
  });
  assert.equal(result.kind, 'usage');
  assert.match(result.message, /outside library adr suffix block/);
});
