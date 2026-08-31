// Unit tests for the pure scope helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  contributionsForBlueprint,
  detectCustomisations,
  listAppliedSlugs,
  parseUrlScope,
  treeHasId,
} from '../../src/view/scope.js';

test('parseUrlScope reads blueprint and node from URLSearchParams', () => {
  const p = new URLSearchParams('blueprint=application-spa&node=REQ-001');
  assert.deepEqual(parseUrlScope(p), { blueprint: 'application-spa', node: 'REQ-001' });
});

test('parseUrlScope trims whitespace and drops empty values', () => {
  const p = new URLSearchParams('blueprint=%20%20&node=%20REQ-001%20');
  assert.deepEqual(parseUrlScope(p), { blueprint: null, node: 'REQ-001' });
});

test('parseUrlScope ignores unrelated keys and defaults to null / null', () => {
  const p = new URLSearchParams('other=foo');
  assert.deepEqual(parseUrlScope(p), { blueprint: null, node: null });
});

test('contributionsForBlueprint returns { found: false } for unknown slug', () => {
  const manifest = { blueprints: [{ slug: 'foo', contributions: [{ id: 'REQ-001' }] }] };
  const r = contributionsForBlueprint(manifest, 'bar');
  assert.deepEqual(r, { found: false });
});

test('contributionsForBlueprint returns ids array for known slug', () => {
  const manifest = {
    blueprints: [{
      slug: 'application-spa',
      version: '1.0.0',
      appliedAt: '2026-08-30T10:00:00Z',
      contributions: [
        { id: 'application-spa-REQ-001', kind: 'req', path: 'rcf/reqs/application-spa-req-001.json' },
        { id: 'ADR-201-application-spa', kind: 'adr', path: 'rcf/adrs/adr-201-application-spa.json' },
      ],
    }],
  };
  const r = contributionsForBlueprint(manifest, 'application-spa');
  assert.equal(r.found, true);
  assert.deepEqual(r.contributionIds, ['application-spa-REQ-001', 'ADR-201-application-spa']);
  assert.equal(r.record.version, '1.0.0');
});

test('contributionsForBlueprint tolerates a manifest with no blueprints[]', () => {
  assert.deepEqual(contributionsForBlueprint({}, 'foo'), { found: false });
  assert.deepEqual(contributionsForBlueprint(null, 'foo'), { found: false });
});

test('listAppliedSlugs returns slugs in manifest order', () => {
  const m = { blueprints: [{ slug: 'a' }, { slug: 'b' }, { notSlug: true }] };
  assert.deepEqual(listAppliedSlugs(m), ['a', 'b']);
});

test('treeHasId uses tree.byId to answer existence', () => {
  const byId = new Map([['REQ-001', {}], ['ADR-201-application-spa', {}]]);
  const tree = { byId };
  assert.equal(treeHasId(tree, 'REQ-001'), true);
  assert.equal(treeHasId(tree, 'ADR-201-application-spa'), true);
  assert.equal(treeHasId(tree, 'REQ-999'), false);
  assert.equal(treeHasId(tree, ''), false);
  assert.equal(treeHasId(null, 'REQ-001'), false);
});

test('detectCustomisations flags files whose bytes differ from the shipping source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-scope-'));
  const src = join(root, 'src-blueprint');
  const contribDir = join(src, 'contributions', 'reqs');
  await mkdir(contribDir, { recursive: true });
  await writeFile(
    join(src, 'blueprint.json'),
    JSON.stringify({
      slug: 'foo',
      version: '1.0.0',
      contributions: [
        { id: 'foo-REQ-001', kind: 'req', path: 'reqs/foo-req-001.json' },
        { id: 'foo-REQ-002', kind: 'req', path: 'reqs/foo-req-002.json' },
      ],
    }),
  );
  await writeFile(join(contribDir, 'foo-req-001.json'), '{"reqId":"foo-REQ-001","original":true}');
  await writeFile(join(contribDir, 'foo-req-002.json'), '{"reqId":"foo-REQ-002","original":true}');

  const projectRoot = join(root, 'project');
  const reqDir = join(projectRoot, 'rcf', 'reqs');
  await mkdir(reqDir, { recursive: true });
  // REQ-001 was customised; REQ-002 matches the source verbatim.
  await writeFile(join(reqDir, 'foo-req-001.json'), '{"reqId":"foo-REQ-001","original":true,"customised":true}');
  await writeFile(join(reqDir, 'foo-req-002.json'), '{"reqId":"foo-REQ-001","original":true}'.replace('foo-REQ-001', 'foo-REQ-002'));

  const record = {
    slug: 'foo',
    source: src,
    contributions: [
      { id: 'foo-REQ-001', kind: 'req', path: 'rcf/reqs/foo-req-001.json' },
      { id: 'foo-REQ-002', kind: 'req', path: 'rcf/reqs/foo-req-002.json' },
    ],
  };
  const { customisedIds, missingSourceIds } = await detectCustomisations({ projectRoot, record });
  assert.deepEqual(customisedIds, ['foo-REQ-001']);
  assert.deepEqual(missingSourceIds, []);
  await rm(root, { recursive: true, force: true });
});

test('detectCustomisations re-resolves a bare shelf-slug source through the packaged shelf (F1)', async () => {
  // Regression for integration review d-2026-08-31-046 F1: a legacy or
  // sugar-carrying manifest whose `record.source` is a bare kebab slug
  // (`application-spa`) must re-resolve to the packaged shelf and light
  // up bytes-differ customisation detection. Pre-fix the resolver
  // fell through the `isAbsolute` guard and returned a relative token
  // the FS could not open, so every contribution rendered as
  // missingSource.
  const root = await mkdtemp(join(tmpdir(), 'rcf-scope-shelfslug-'));
  const src = join(root, 'src-blueprint');
  const contribDir = join(src, 'contributions', 'reqs');
  await mkdir(contribDir, { recursive: true });
  await writeFile(
    join(src, 'blueprint.json'),
    JSON.stringify({
      slug: 'faux-shelf', version: '1.0.0',
      contributions: [{ id: 'faux-shelf-REQ-001', kind: 'req', path: 'reqs/faux-req-001.json' }],
    }),
  );
  await writeFile(join(contribDir, 'faux-req-001.json'), '{"reqId":"faux-shelf-REQ-001","original":true}');
  const projectRoot = join(root, 'project');
  const reqDir = join(projectRoot, 'rcf', 'reqs');
  await mkdir(reqDir, { recursive: true });
  await writeFile(join(reqDir, 'faux-req-001.json'), '{"reqId":"faux-shelf-REQ-001","original":true,"customised":true}');

  // Fake resolver that mirrors the shelf-resolver's response shape for
  // a bare slug: returns the resolved abs path. This proves the wiring
  // routes non-abs-path sources through the resolver rather than
  // handing the raw slug to the loader.
  const _resolveSource = async (source, opts) => {
    assert.equal(opts.projectRoot, projectRoot);
    if (source === 'faux-shelf') return { kind: 'shelf', resolved: src, original: source, slug: source };
    return { kind: 'usage', message: 'not found' };
  };
  const record = {
    slug: 'faux-shelf',
    source: 'faux-shelf',
    contributions: [{ id: 'faux-shelf-REQ-001', kind: 'req', path: 'rcf/reqs/faux-req-001.json' }],
  };
  const { customisedIds, missingSourceIds } = await detectCustomisations({
    projectRoot, record, _resolveSource,
  });
  assert.deepEqual(customisedIds, ['faux-shelf-REQ-001']);
  assert.deepEqual(missingSourceIds, []);
  await rm(root, { recursive: true, force: true });
});

test('detectCustomisations re-resolves a colon-qualified library source through the registry (F1)', async () => {
  // Regression for integration review d-2026-08-31-046 F1: a library
  // apply records `source: "<prefix>:<slug>"` per spec §5.3. That token
  // is not a filesystem path; scope.js must re-resolve it through the
  // project registry (or an injected resolver seam) to reach the
  // library's cache directory. Without this the library-applied
  // customisation banner is silently broken.
  const root = await mkdtemp(join(tmpdir(), 'rcf-scope-libref-'));
  const src = join(root, 'lib-cache', 'blueprints', 'auth-oauth2');
  const contribDir = join(src, 'contributions');
  await mkdir(contribDir, { recursive: true });
  await writeFile(
    join(src, 'blueprint.json'),
    JSON.stringify({
      slug: 'auth-oauth2', version: '1.0.0',
      contributions: [{ id: 'wsd-auth-oauth2-REQ-50101', kind: 'req', path: 'req.json' }],
    }),
  );
  await writeFile(join(contribDir, 'req.json'), '{"reqId":"wsd-auth-oauth2-REQ-50101","original":true}');

  const projectRoot = join(root, 'project');
  const reqDir = join(projectRoot, 'rcf', 'requirements');
  await mkdir(reqDir, { recursive: true });
  await writeFile(join(reqDir, 'wsd-auth-oauth2-req-50101.json'), '{"reqId":"wsd-auth-oauth2-REQ-50101","original":true,"customised":true}');

  const _resolveSource = async (source, opts) => {
    assert.equal(opts.projectRoot, projectRoot);
    if (source === 'wsd:auth-oauth2') {
      return {
        kind: 'library', resolved: src, original: source,
        libraryPrefix: 'wsd', libraryBlueprintSlug: 'auth-oauth2',
        effectiveSlug: 'wsd-auth-oauth2',
      };
    }
    return { kind: 'usage', message: 'not found' };
  };
  const record = {
    slug: 'wsd-auth-oauth2',
    source: 'wsd:auth-oauth2',
    contributions: [{ id: 'wsd-auth-oauth2-REQ-50101', kind: 'req', path: 'rcf/requirements/wsd-auth-oauth2-req-50101.json' }],
  };
  const { customisedIds, missingSourceIds } = await detectCustomisations({
    projectRoot, record, _resolveSource,
  });
  assert.deepEqual(customisedIds, ['wsd-auth-oauth2-REQ-50101']);
  assert.deepEqual(missingSourceIds, []);
  await rm(root, { recursive: true, force: true });
});

test('detectCustomisations returns empty when the shipping source is unreadable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-scope-'));
  const record = {
    slug: 'foo',
    source: join(root, 'gone'),
    contributions: [{ id: 'foo-REQ-001', kind: 'req', path: 'rcf/reqs/foo-req-001.json' }],
  };
  const reqDir = join(root, 'rcf', 'reqs');
  await mkdir(reqDir, { recursive: true });
  await writeFile(join(reqDir, 'foo-req-001.json'), '{}');
  const { customisedIds, missingSourceIds } = await detectCustomisations({ projectRoot: root, record });
  assert.deepEqual(customisedIds, []);
  assert.deepEqual(missingSourceIds, ['foo-REQ-001']);
  await rm(root, { recursive: true, force: true });
});
