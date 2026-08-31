// Phase 2b CLI end-to-end: `rcf define blueprint library <verb>` +
// `rcf define blueprint add wsd:<slug>` on a project with a registered
// library.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
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

// Interactive variant: pipes `input` to the child's stdin so the
// review-on-add prompt can be answered. Returns the same shape as
// runBin (code / stdout / stderr) once the child exits.
function runBinInteractive(cwd, args, input) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd, env: { ...process.env, CI: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolvePromise({ code: code ?? 0, stdout, stderr }));
    child.stdin.write(input);
    child.stdin.end();
  });
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

// Ownership-check preference: libraryPrefix on the record wins over
// string-matching `source`. The edge: an operator re-registers a library
// under a different prefix; string-matching `source: 'wsd:...'` against
// the new prefix would orphan the record and let the library be removed
// with applied blueprints still on-tree. The record's libraryPrefix is
// the ownership fact.
test('library remove refuses via libraryPrefix on the record even when source does not match the registered prefix', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  // Hand-write a manifest record whose source does NOT start with 'wsd:'
  // (as if it was applied under a previously-registered prefix that has
  // since been renamed) but whose libraryPrefix declares the ownership.
  const manifestPath = join(project, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints = [{
    slug: 'wsd-auth-oauth2',
    version: '1.0.0',
    appliedAt: '2026-09-01T10:00:00Z',
    source: 'legacy-prefix:auth-oauth2',
    libraryPrefix: 'wsd',
  }];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  const remove = await runBin(project, ['define', 'blueprint', 'library', 'remove', 'wsd']);
  assert.notEqual(remove.code, 0, `expected refusal; stdout=${remove.stdout} stderr=${remove.stderr}`);
  assert.match(remove.stderr, /applied blueprint\(s\) came through 'wsd'/);
});

// Back-compat: pre-0.5.1 records carry no libraryPrefix. The remove
// ownership check must still refuse via the `source` prefix fallback so
// projects on old records are not silently orphaned.
test('library remove refuses via source-prefix fallback on a pre-field record (no libraryPrefix stamped)', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  const manifestPath = join(project, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints = [{
    slug: 'wsd-auth-oauth2',
    version: '1.0.0',
    appliedAt: '2026-09-01T10:00:00Z',
    source: 'wsd:auth-oauth2',
  }];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  const remove = await runBin(project, ['define', 'blueprint', 'library', 'remove', 'wsd']);
  assert.notEqual(remove.code, 0, `expected refusal; stdout=${remove.stdout} stderr=${remove.stderr}`);
  assert.match(remove.stderr, /applied blueprint\(s\) came through 'wsd'/);
});

// libraryPrefix wins the other way too: a record stamped 'wsd' is NOT
// removable by a `library remove otherprefix` even if source happens to
// start with 'otherprefix:'. Guards against a stale source string
// masquerading as ownership.
test('library remove does not refuse for a record whose libraryPrefix names a different library', async () => {
  const project = await scaffoldProject();
  const otherLib = await scaffoldLibrary({
    prefix: 'other',
    blueprintSlug: 'auth-oauth2',
    bands: { ac: { start: 60000, end: 69999 } },
    contributions: [{ kind: 'req', id: 'REQ-60101', path: 'req.json' }],
  });
  const addOther = await runBin(project, ['define', 'blueprint', 'library', 'add', otherLib, '--no-review', '--i-have-reviewed']);
  assert.equal(addOther.code, 0, `addOther stderr: ${addOther.stderr}`);
  const manifestPath = join(project, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints = [{
    slug: 'wsd-auth-oauth2',
    version: '1.0.0',
    appliedAt: '2026-09-01T10:00:00Z',
    source: 'other:auth-oauth2',
    libraryPrefix: 'wsd',
  }];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  const remove = await runBin(project, ['define', 'blueprint', 'library', 'remove', 'other']);
  assert.equal(remove.code, 0, `expected clean remove; stdout=${remove.stdout} stderr=${remove.stderr}`);
  assert.match(remove.stdout, /removed 'other'/);
});

// Multi-blueprint library scaffolder for the review-on-add render tests.
// Each blueprint in `blueprints[]` is written with its own metadata and
// contribution bodies so scope:global ADR topics reach the loader
// (and, from there, the review-card renderer via
// `library.blueprints[].globalTopics`).
async function scaffoldLibraryMulti({ prefix, bands, blueprints, publisherContact, libraryDisplayName }) {
  const root = await mkdtemp(join(tmpdir(), `rcf-lib-multi-${prefix}-`));
  for (const bp of blueprints) {
    const bpDir = join(root, 'blueprints', bp.slug);
    await mkdir(join(bpDir, 'contributions'), { recursive: true });
    await writeFile(
      join(bpDir, 'blueprint.json'),
      JSON.stringify({ slug: bp.slug, version: '1.0.0', contributions: bp.contributions }, null, 2),
      'utf8',
    );
    for (const c of bp.contributions) {
      const body = c.kind === 'req'
        ? reqBody(c.id)
        : { adrId: c.id, title: 't', status: 'accepted', context: 'c', decision: 'd', consequences: 'q', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' };
      await writeFile(join(bpDir, 'contributions', c.path), JSON.stringify(body, null, 2), 'utf8');
    }
  }
  const publisher = { id: prefix, displayName: `${prefix} publisher` };
  if (publisherContact) publisher.contact = publisherContact;
  await writeFile(join(root, 'library.json'), JSON.stringify({
    libraryVersion: 1,
    libraryPrefix: prefix,
    displayName: libraryDisplayName ?? `${prefix.toUpperCase()} library`,
    publisher,
    libraryRef: '1.0.0',
    bands,
    blueprints: blueprints.map((bp) => ({ slug: bp.slug, path: `blueprints/${bp.slug}` })),
  }, null, 2), 'utf8');
  return root;
}

// Spec §8.1: review-on-add prints a "Global topics these blueprints
// claim (may conflict with core or with other libraries)" section
// listing every qualified-slug -> topic mapping the library carries.
test('review-on-add renders the section 8.1 "Global topics these blueprints claim" line for every blueprint that ships a scope:global ADR', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibraryMulti({
    prefix: 'wsd',
    bands: { ac: { start: 50000, end: 59999 }, suffixBlocks: [{ kind: 'adr', start: 5000, end: 5099 }] },
    publisherContact: 'engineering@wsd.example',
    libraryDisplayName: 'WSD organisational blueprint library',
    blueprints: [
      {
        slug: 'auth-oauth2',
        contributions: [
          { kind: 'adr', id: 'ADR-5001', path: 'auth-model.json', scope: 'global', topic: 'authModel' },
        ],
      },
      {
        slug: 'std-error-envelope',
        contributions: [
          { kind: 'adr', id: 'ADR-5002', path: 'error-envelope.json', scope: 'global', topic: 'errorEnvelope' },
        ],
      },
    ],
  });

  // Interactive add: pipe 'y' so the printer runs but no registry write
  // is asserted here; the assertion is on the render.
  const add = await runBinInteractive(project, ['define', 'blueprint', 'library', 'add', lib], 'y\n');
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  assert.match(add.stdout, /Global topics these blueprints claim \(may conflict with core or with other libraries\):/);
  assert.match(add.stdout, /wsd:auth-oauth2\s+-> authModel/);
  assert.match(add.stdout, /wsd:std-error-envelope\s+-> errorEnvelope/);
});

// Spec §8.1: review-on-add prints an explicit "Prefix check" line
// reporting the collision-gate outcome alongside the band check.
test('review-on-add renders the section 8.1 "Prefix check" line naming the library prefix', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibraryMulti({
    prefix: 'wsd',
    bands: { ac: { start: 50000, end: 59999 } },
    blueprints: [{
      slug: 'auth-oauth2',
      contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
    }],
  });
  const add = await runBinInteractive(project, ['define', 'blueprint', 'library', 'add', lib], 'y\n');
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  assert.match(add.stdout, /Prefix check\s*:\s*'wsd' does not collide with any core slug\./);
});

// Suppress-the-header case: a library whose blueprints carry no
// scope:global ADRs renders no "Global topics" section (the header
// would otherwise be a lonely empty label). The "Prefix check" line
// still renders, since prefix gating is unconditional.
test('review-on-add suppresses the "Global topics" section when no blueprint claims one, and still prints "Prefix check"', async () => {
  const project = await scaffoldProject();
  const lib = await scaffoldLibraryMulti({
    prefix: 'wsd',
    bands: { ac: { start: 50000, end: 59999 } },
    blueprints: [{
      slug: 'auth-oauth2',
      contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
    }],
  });
  const add = await runBinInteractive(project, ['define', 'blueprint', 'library', 'add', lib], 'y\n');
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  assert.doesNotMatch(add.stdout, /Global topics these blueprints claim/);
  assert.match(add.stdout, /Prefix check\s*:\s*'wsd' does not collide with any core slug\./);
});
