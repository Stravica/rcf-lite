// Phase 2b CLI end-to-end: `rcf define blueprint library <verb>` +
// `rcf define blueprint add wsd:<slug>` on a project with a registered
// library.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffoldProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-bp-lib-cli-'));
  const init = await initProject({ projectRoot: root, projectName: 'CliLibBP' });
  assert.equal(init.kind, undefined);
  return root;
}

const reqBody = (id) => ({
  reqId: id, prdId: 'PRD-001', title: 'x', description: 'y',
  category: 'functional', priority: 'must', domain: 'ui',
  version: '0.1.0', status: 'draft',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
});

async function scaffoldLibrary({ prefix, blueprintSlug, bands, contributions }) {
  const root = await mkdtemp(join(tmpdir(), `rcf-lib-${prefix}-`));
  const bpDir = join(root, 'blueprints', blueprintSlug);
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(
    join(bpDir, 'blueprint.json'),
    JSON.stringify({ slug: blueprintSlug, version: '1.0.0', contributions }, null, 2),
    'utf8',
  );
  for (const c of contributions) {
    await writeFile(join(bpDir, 'contributions', c.path), JSON.stringify(reqBody(c.id), null, 2), 'utf8');
  }
  await writeFile(join(root, 'library.json'), JSON.stringify({
    libraryVersion: 1,
    libraryPrefix: prefix,
    displayName: `${prefix.toUpperCase()} library`,
    publisher: { id: prefix, displayName: `${prefix} publisher` },
    libraryRef: '1.0.0',
    bands,
    blueprints: [{ slug: blueprintSlug, path: `blueprints/${blueprintSlug}` }],
  }, null, 2), 'utf8');
  return root;
}

test('library add (local, --no-review --i-have-reviewed) writes the registry entry, then list surfaces it', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
  });

  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  assert.match(add.stdout, /added 'wsd'/);

  const registryPath = join(project, 'rcf', 'blueprint-libraries.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  assert.equal(registry.registryVersion, 1);
  assert.equal(registry.libraries.length, 1);
  assert.equal(registry.libraries[0].libraryPrefix, 'wsd');
  assert.equal(registry.libraries[0].sourceKind, 'local');
  assert.equal(registry.libraries[0].provenance.tier, 'local');

  const list = await runBin(project, ['define', 'blueprint', 'library', 'list']);
  assert.equal(list.code, 0);
  assert.match(list.stdout, /wsd\tlocal/);
});

test('library add refuses --no-review without --i-have-reviewed', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
  });
  const res = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review']);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /--no-review requires --i-have-reviewed/);
});

test('library add refuses AC-band overlap with the core shelf', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 1500, end: 2000 } }, // collides with application-spa 1101-1899
    contributions: [{ kind: 'req', id: 'REQ-1501', path: 'req.json' }],
  });
  const res = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /overlaps core-shelf blueprint 'application-spa'/);
});

test('library add refuses a prefix that collides with a core slug', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'application-spa',
    blueprintSlug: 'nested',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
  });
  const res = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /collides with core-shelf blueprint slug 'application-spa'/);
});

test('blueprint add wsd:auth-oauth2 through registered library stamps effective slug and qualified source', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'wsd-auth-oauth2-REQ-50101', path: 'req.json' }],
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  const apply = await runBin(project, ['define', 'blueprint', 'add', 'wsd:auth-oauth2']);
  assert.equal(apply.code, 0, `apply stderr: ${apply.stderr}`);
  assert.match(apply.stdout, /applied 'wsd-auth-oauth2'/);
  const manifest = JSON.parse(await readFile(join(project, 'rcf', 'manifest.json'), 'utf8'));
  const entry = manifest.blueprints.find((b) => b.slug === 'wsd-auth-oauth2');
  assert.ok(entry, `wsd-auth-oauth2 entry present: ${JSON.stringify(manifest.blueprints)}`);
  assert.equal(entry.source, 'wsd:auth-oauth2');
});

test('library remove refuses when an applied blueprint came through the library', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'wsd-auth-oauth2-REQ-50101', path: 'req.json' }],
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  const apply = await runBin(project, ['define', 'blueprint', 'add', 'wsd:auth-oauth2']);
  assert.equal(apply.code, 0, `apply stderr: ${apply.stderr}`);
  const remove = await runBin(project, ['define', 'blueprint', 'library', 'remove', 'wsd']);
  assert.notEqual(remove.code, 0);
  assert.match(remove.stderr, /applied blueprint\(s\) came through 'wsd'/);
});

test('library refresh on a clean local library reports no drift', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0);
  const refresh = await runBin(project, ['define', 'blueprint', 'library', 'refresh', 'wsd']);
  assert.equal(refresh.code, 0, `refresh stderr: ${refresh.stderr}`);
  assert.match(refresh.stdout, /refresh clean/);
});

test('library refresh detects drift when the on-disk libraryRef changes', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0);
  // Bump the library's on-disk ref (simulating an update the operator has not yet re-added).
  const libManifest = JSON.parse(await readFile(join(lib, 'library.json'), 'utf8'));
  libManifest.libraryRef = '1.1.0';
  await writeFile(join(lib, 'library.json'), JSON.stringify(libManifest, null, 2), 'utf8');
  const refresh = await runBin(project, ['define', 'blueprint', 'library', 'refresh', 'wsd']);
  assert.equal(refresh.code, 3);
  assert.match(refresh.stderr, /has drifted/);
  assert.match(refresh.stderr, /libraryRef '1\.0\.0' -> '1\.1\.0'/);
});

test('library add refuses a non-local ref in Phase 2b', async () => {
  const project = await scaffoldProject();
  const res = await runBin(project, ['define', 'blueprint', 'library', 'add', 'git+https://example.com/repo.git#v1.0.0', '--no-review', '--i-have-reviewed']);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /Phase 2c/);
});

test('rcf define blueprint --help advertises the library sub-verb', async () => {
  const project = await scaffoldProject();
  const res = await runBin(project, ['help', 'define', 'blueprint']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /library <verb>/);
});

test('rcf define blueprint library --help prints the library HELP block', async () => {
  const project = await scaffoldProject();
  const res = await runBin(project, ['define', 'blueprint', 'library', '--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /Usage: rcf define blueprint library/);
  assert.match(res.stdout, /--i-have-reviewed/);
});
