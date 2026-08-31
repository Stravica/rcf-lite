// CLI tests for `rcf audit view open` (w-2026-08-30-dave-020).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';
import {
  composeScopeUrl,
  parseOpenArgs,
  resolveBaseUrl,
} from '../../src/cli/view.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args = [], env = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, 'audit', 'view', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function makeProjectWithBlueprint() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-view-open-'));
  await initProject({ projectRoot: root, projectName: 'scope test' });
  // Seed manifest.blueprints[] with an applied record.
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const raw = await (await import('node:fs/promises')).readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  manifest.blueprints = [{
    slug: 'application-spa',
    version: '1.3.1',
    appliedAt: '2026-08-30T10:00:00Z',
    source: 'blueprints/application-spa',
    contributions: [
      { id: 'application-spa-REQ-001', kind: 'req', path: 'rcf/requirements/application-spa-req-001.json' },
      { id: 'ADR-201-application-spa', kind: 'adr', path: 'rcf/adrs/adr-201-application-spa.json' },
    ],
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

test('parseOpenArgs recognises --blueprint, --node, --no-open, --json, --port', () => {
  const r = parseOpenArgs(['--blueprint', 'x', '--node', 'REQ-001', '--no-open', '--json', '--port', '4444']);
  assert.deepEqual(r.opts, {
    blueprint: 'x', node: 'REQ-001', noOpen: true, json: true, port: 4444, help: false,
  });
  assert.deepEqual(r.errors, []);
});

test('parseOpenArgs collects usage errors for missing / bad arguments', () => {
  const r = parseOpenArgs(['--blueprint', '--node']);
  assert.ok(r.errors.length >= 1);
});

test('composeScopeUrl composes query params and node hash', () => {
  const url = composeScopeUrl({
    baseUrl: 'http://127.0.0.1:4373/',
    blueprint: 'application-spa',
    node: 'application-spa-REQ-001',
  });
  assert.equal(
    url,
    'http://127.0.0.1:4373/?blueprint=application-spa&node=application-spa-REQ-001#application-spa-REQ-001',
  );
});

test('composeScopeUrl handles bare base url without params', () => {
  const url = composeScopeUrl({ baseUrl: 'http://127.0.0.1:4373/', blueprint: null, node: null });
  assert.equal(url, 'http://127.0.0.1:4373/');
});

test('resolveBaseUrl falls back to default port when nothing is running or flagged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-resolve-'));
  await initProject({ projectRoot: root, projectName: 'resolve test' });
  const r = await resolveBaseUrl({ projectRoot: root, port: null, env: {} });
  assert.equal(r.source, 'default');
  assert.equal(r.baseUrl, 'http://127.0.0.1:4373/');
});

test('resolveBaseUrl honours --port when passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-resolve-'));
  await initProject({ projectRoot: root, projectName: 'resolve test' });
  const r = await resolveBaseUrl({ projectRoot: root, port: 5555, env: {} });
  assert.equal(r.source, 'flag');
  assert.equal(r.baseUrl, 'http://127.0.0.1:5555/');
});

test('view open prints the scoped URL for an applied blueprint', async () => {
  const root = await makeProjectWithBlueprint();
  const r = await runBin(root, ['open', '--blueprint', 'application-spa', '--no-open']);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /http:\/\/127\.0\.0\.1:4373\/\?blueprint=application-spa\b/);
  assert.match(r.stdout, /blueprint: application-spa \(2 contributions\)/);
});

test('view open composes blueprint + node into one URL (uses REQ-001 from the initProject seed)', async () => {
  // `initProject` seeds a valid REQ-001 which the walker registers in
  // tree.byId; using it here means we can prove --node validation
  // without seeding a schema-perfect req from scratch.
  const root = await makeProjectWithBlueprint();
  const r = await runBin(root, [
    'open', '--blueprint', 'application-spa', '--node', 'REQ-001', '--no-open',
  ]);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /\?blueprint=application-spa&node=REQ-001#REQ-001/);
});

test('view open refuses an unknown blueprint slug (exit 2, hint at applied set)', async () => {
  const root = await makeProjectWithBlueprint();
  const r = await runBin(root, ['open', '--blueprint', 'not-a-blueprint', '--no-open']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not applied to this project/);
  assert.match(r.stderr, /Applied: application-spa/);
});

test('view open refuses an unknown node id (exit 2)', async () => {
  const root = await makeProjectWithBlueprint();
  const r = await runBin(root, ['open', '--node', 'NO-SUCH-ID-999', '--no-open']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /is not present on the tree/);
});

test('view open --json emits a machine-readable resolution', async () => {
  const root = await makeProjectWithBlueprint();
  const r = await runBin(root, ['open', '--blueprint', 'application-spa', '--json', '--no-open']);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const body = JSON.parse(r.stdout);
  assert.equal(body.blueprint, 'application-spa');
  assert.equal(body.contributionCount, 2);
  assert.equal(body.serverRunning, false);
  assert.match(body.url, /\?blueprint=application-spa/);
});

test('view open refuses when neither --blueprint nor --node is passed (exit 2)', async () => {
  const root = await makeProjectWithBlueprint();
  const r = await runBin(root, ['open', '--no-open']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /pass --blueprint <slug> and\/or --node <id>/);
});
