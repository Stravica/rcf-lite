// Resource layer tests (Phase 7 §D15 / D15-A): rcf://tree index shape,
// per-doc reads (standalone + inline), the four methodology docs from
// the guidance pack, list completeness vs the walker, unknown-URI
// error. In-process against a scaffolded temp project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';
import { walkTree } from '#core/store';
import { createResourceRegistry, GUIDANCE_DIR, readGuidanceManifest } from '../../src/mcp/resources.js';
import { RESOURCE_NOT_FOUND } from '#core/mcp-shell';

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-mcp-resources-'));
  await initProject({ projectRoot: tmp, projectName: 'McpResourcesTest' });
  return tmp;
}

test('rcf://tree: project name plus {id, kind, title, filePath} per document from a fresh walk', async () => {
  const tmp = await scaffold();
  const registry = createResourceRegistry({ projectRoot: tmp });
  const result = await registry.read('rcf://tree');
  assert.equal(result.contents.length, 1);
  assert.equal(result.contents[0].uri, 'rcf://tree');
  assert.equal(result.contents[0].mimeType, 'application/json');
  const index = JSON.parse(result.contents[0].text);
  assert.equal(index.project, 'McpResourcesTest');
  const req = index.documents.find((d) => d.id === 'REQ-001');
  assert.equal(req.kind, 'req');
  assert.equal(req.filePath, 'rcf/requirements/req-001.json');
  assert.equal(typeof req.title, 'string');
  const inlineAc = index.documents.find((d) => d.id === 'AC-101-1');
  assert.equal(inlineAc.kind, 'ac');
  assert.equal(inlineAc.filePath, 'rcf/user-stories/us-101.json', 'inline docs point at the parent file');
});

test('rcf://doc/<id>: standalone doc body served as JSON', async () => {
  const tmp = await scaffold();
  const registry = createResourceRegistry({ projectRoot: tmp });
  const result = await registry.read('rcf://doc/US-101');
  const doc = JSON.parse(result.contents[0].text);
  assert.equal(doc.usId, 'US-101');
  assert.equal(result.contents[0].mimeType, 'application/json');
});

test('rcf://doc/<id>: inline AC resolves to the addressed inline entry', async () => {
  const tmp = await scaffold();
  const registry = createResourceRegistry({ projectRoot: tmp });
  const result = await registry.read('rcf://doc/AC-101-1');
  const doc = JSON.parse(result.contents[0].text);
  assert.equal(doc.id, 'AC-101-1');
  assert.equal(typeof doc.description, 'string');
});

test('resources/list: complete vs the walker - every standalone and inline id, plus tree and the four docs slugs', async () => {
  const tmp = await scaffold();
  const registry = createResourceRegistry({ projectRoot: tmp });
  const { resources } = await registry.list();
  const uris = new Set(resources.map((r) => r.uri));
  assert.ok(uris.has('rcf://tree'));
  const { tree } = await walkTree({ projectRoot: tmp });
  for (const id of tree.byId.keys()) {
    assert.ok(uris.has(`rcf://doc/${id}`), `missing rcf://doc/${id}`);
  }
  for (const id of tree.parentByChild.keys()) {
    assert.ok(uris.has(`rcf://doc/${id}`), `missing inline rcf://doc/${id}`);
  }
  for (const slug of ['overview', 'document-model', 'build-cycle', 'harness-template']) {
    assert.ok(uris.has(`rcf://docs/${slug}`), `missing rcf://docs/${slug}`);
  }
  // Track C+D §13.3 AC: the platform-invariants guidance resource is a
  // first-class URI, distinct from `rcf://docs/*` because it does not
  // serve a markdown file.
  assert.ok(uris.has('rcf://guidance/platform-invariants'), 'missing rcf://guidance/platform-invariants');
  for (const r of resources) {
    assert.equal(typeof r.name, 'string');
    assert.equal(typeof r.mimeType, 'string');
  }
});

test('rcf://guidance/platform-invariants: serves the manifest.platformInvariants[] array as JSON, byte-verbatim', async () => {
  const tmp = await scaffold();
  const registry = createResourceRegistry({ projectRoot: tmp });
  const { resources } = await registry.list();
  const entry = resources.find((r) => r.uri === 'rcf://guidance/platform-invariants');
  assert.ok(entry, 'expected rcf://guidance/platform-invariants in resources/list');
  assert.equal(entry.mimeType, 'application/json');
  assert.equal(entry.name, 'platform-invariants');
  assert.equal(typeof entry.title, 'string');
  const result = await registry.read('rcf://guidance/platform-invariants');
  assert.equal(result.contents.length, 1);
  assert.equal(result.contents[0].uri, 'rcf://guidance/platform-invariants');
  assert.equal(result.contents[0].mimeType, 'application/json');
  const invariants = JSON.parse(result.contents[0].text);
  assert.ok(Array.isArray(invariants), 'served content must be a JSON array');
  assert.ok(invariants.length >= 1, 'expected at least one platform invariant');
  const neverSkip = invariants.find((i) => i.id === 'never-skip-rcf');
  assert.ok(neverSkip, 'expected the never-skip-rcf invariant on the wire');
  const manifest = await readGuidanceManifest(GUIDANCE_DIR);
  assert.deepEqual(
    invariants,
    manifest.platformInvariants,
    'served invariants must equal manifest.platformInvariants byte-for-byte (the resource serves the manifest, it does not paraphrase it).',
  );
});

test('rcf://guidance/<unknown-slug>: is the -32002 resource error, not a passthrough', async () => {
  const tmp = await scaffold();
  const registry = createResourceRegistry({ projectRoot: tmp });
  await assert.rejects(
    () => registry.read('rcf://guidance/no-such-block'),
    (err) => err.code === RESOURCE_NOT_FOUND,
    'expected -32002 for an unknown guidance slug',
  );
});

test('rcf://docs/<slug>: every methodology doc in the pack manifest serves byte-faithful markdown', async () => {
  const tmp = await scaffold();
  const registry = createResourceRegistry({ projectRoot: tmp });
  const manifest = await readGuidanceManifest(GUIDANCE_DIR);
  // Locked inventory (§D3, extended in 0.6.0 spec D-6 with the
  // managed/ sub-slug for the canonical CLAUDE.md/AGENTS.md block).
  assert.deepEqual(manifest.docs.map((d) => d.slug), [
    'overview',
    'document-model',
    'build-cycle',
    'harness-template',
    'managed/agent-instructions-block',
    // Track C+D §10 shipped the persona-programme guidance file.
    'persona-programme',
  ]);
  for (const doc of manifest.docs) {
    const result = await registry.read(`rcf://docs/${doc.slug}`);
    assert.equal(result.contents[0].mimeType, 'text/markdown');
    const expected = await readFile(join(GUIDANCE_DIR, doc.file), 'utf8');
    assert.equal(result.contents[0].text, expected, `${doc.slug} must serve the pack bytes verbatim`);
  }
});

test('guidance README.md and manifest.json are deliberately NOT served (pack D2)', async () => {
  const tmp = await scaffold();
  const registry = createResourceRegistry({ projectRoot: tmp });
  const { resources } = await registry.list();
  assert.equal(resources.some((r) => r.uri.includes('README')), false);
  assert.equal(resources.some((r) => r.uri.includes('manifest')), false);
  await assert.rejects(() => registry.read('rcf://docs/README'), (err) => err.code === RESOURCE_NOT_FOUND);
});

test('unknown URIs are the -32002 resource error', async () => {
  const tmp = await scaffold();
  const registry = createResourceRegistry({ projectRoot: tmp });
  for (const uri of ['rcf://doc/REQ-404', 'rcf://docs/no-such-slug', 'file:///etc/passwd', '']) {
    await assert.rejects(
      () => registry.read(uri),
      (err) => err.code === RESOURCE_NOT_FOUND,
      `expected -32002 for ${uri || '(empty)'}`,
    );
  }
});
