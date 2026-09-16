// FBS-182 slice 3 unit tests for src/feedback/destination.js.
//
// Binds AC-15801-2 (four-fixture resolver walk: shelf, library with
// explicit issues, library derived from git source, library
// unresolved), AC-15802-1 (shelf-blueprint entry routes to
// Stravica/rcf-lite; CORE_REPO pins to package.json:bugs.url), and
// AC-15802-2 (kind:core routes to CORE_REPO regardless of any
// library manifest content).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORE_REPO,
  initCoreRepo,
  listUnresolvedLibraries,
  parseBugsRepo,
  parseGithubSource,
  resolve,
} from '../../src/feedback/destination.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolvePath(here, '..', '..');

test('AC-15802-1: CORE_REPO is pinned to packages/rcf-lite/package.json:bugs.url', async () => {
  await initCoreRepo();
  const pkg = JSON.parse(await readFile(resolvePath(packageRoot, 'package.json'), 'utf8'));
  const fromPkg = parseBugsRepo(pkg);
  assert.equal(CORE_REPO, fromPkg, 'CORE_REPO must equal the parse of package.json:bugs.url');
  assert.equal(CORE_REPO, 'Stravica/rcf-lite', 'today the bugs.url points at Stravica/rcf-lite');
});

test('parseBugsRepo accepts the string form, the object form, and the /issues suffix', () => {
  assert.equal(parseBugsRepo({ bugs: 'https://github.com/Stravica/rcf-lite/issues' }), 'Stravica/rcf-lite');
  assert.equal(parseBugsRepo({ bugs: 'https://github.com/Stravica/rcf-lite' }), 'Stravica/rcf-lite');
  assert.equal(parseBugsRepo({ bugs: 'https://github.com/Stravica/rcf-lite.git' }), 'Stravica/rcf-lite');
  assert.equal(parseBugsRepo({ bugs: { url: 'https://github.com/Stravica/rcf-lite/issues' } }), 'Stravica/rcf-lite');
  assert.equal(parseBugsRepo({}), null, 'no bugs field returns null');
});

test('parseGithubSource picks up the git+https and git+ssh shapes only', () => {
  assert.equal(parseGithubSource('git+https://github.com/wsd-team-dev/rcf-lite-blueprints.git#v1'), 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(parseGithubSource('git+https://github.com/wsd-team-dev/rcf-lite-blueprints#main'), 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(parseGithubSource('git+ssh://git@github.com/wsd-team-dev/rcf-lite-blueprints.git#v1'), 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(parseGithubSource('https://gitlab.com/wsd/foo.git'), null, 'non-github hosts are not derivable');
  assert.equal(parseGithubSource('/some/local/path'), null);
});

test('AC-15801-2 shelf fixture: a blueprint with no libraryPrefix routes to CORE_REPO', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'security-auth-magic-link' } };
  const manifest = { blueprints: [{ slug: 'security-auth-magic-link' }] };
  const registry = { libraries: [] };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, CORE_REPO);
  assert.equal(dest.kind, 'shelf');
  assert.equal(dest.visibility, 'public');
  assert.equal(dest.derived, false);
});

test('AC-15801-2 explicit-issues fixture: a library with issues wins over derivation', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'wsd:std-error-envelope' } };
  const manifest = { blueprints: [{ slug: 'wsd-std-error-envelope', libraryPrefix: 'wsd' }] };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        // sourceRef IS a github URL so derivation could kick in;
        // the explicit issues field must win.
        sourceRef: 'git+https://github.com/wsd-team-dev/mirror-fork.git#v1',
        issuesRepo: 'wsd-team-dev/rcf-lite-blueprints',
        issuesVisibility: 'private',
        publisher: { id: 'wsd', displayName: 'WSD', contact: 'engineering@wsd.example' },
      },
    ],
  };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(dest.visibility, 'private');
  assert.equal(dest.kind, 'library');
  assert.equal(dest.derived, false);
  assert.equal(dest.source, 'library-manifest');
  assert.equal(dest.publisherContact, 'engineering@wsd.example');
});

test('AC-15801-2 derived fixture: no issues + github git source derives OWNER/REPO with derived:true', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'wsd:std-error-envelope' } };
  const manifest = { blueprints: [{ slug: 'wsd-std-error-envelope', libraryPrefix: 'wsd' }] };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        sourceRef: 'git+https://github.com/wsd-team-dev/rcf-lite-blueprints.git#v1.4.0',
        publisher: { id: 'wsd', displayName: 'WSD' },
      },
    ],
  };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(dest.derived, true);
  assert.equal(dest.kind, 'library');
  assert.equal(dest.source, 'sourceRef-derivation');
});

test('AC-15801-2 unresolved fixture: no issues + non-github source returns unresolved with a reason', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'acme:foo' } };
  const manifest = { blueprints: [{ slug: 'acme-foo', libraryPrefix: 'acme' }] };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'acme',
        sourceRef: 'git+https://gitlab.example.com/acme/blueprints.git#v1',
        publisher: { id: 'acme', displayName: 'ACME', contact: 'ops@acme.example' },
      },
    ],
  };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, null);
  assert.equal(dest.visibility, 'unresolved');
  assert.equal(dest.reason, 'no-github-source');
  assert.equal(dest.publisherContact, 'ops@acme.example');
});

test('AC-15802-2 kind:core routes to CORE_REPO regardless of library manifest content', async () => {
  const entry = { kind: 'core', target: { ref: 'define validate' } };
  // A library that (perversely) declares a core-verb-shaped target
  // and even an issuesRepo. The resolver must ignore it for core.
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        sourceRef: 'git+https://github.com/wsd-team-dev/rcf-lite-blueprints.git#v1',
        issuesRepo: 'wsd-team-dev/rcf-lite-blueprints',
        issuesVisibility: 'private',
      },
    ],
  };
  const dest = await resolve(entry, { manifest: { blueprints: [] }, registry });
  assert.equal(dest.repo, CORE_REPO);
  assert.equal(dest.kind, 'core');
  assert.equal(dest.visibility, 'public');
});

test('unknown-target: a blueprint entry whose target does not appear in the manifest is unresolved', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'nope' } };
  const dest = await resolve(entry, { manifest: { blueprints: [] }, registry: { libraries: [] } });
  assert.equal(dest.visibility, 'unresolved');
  assert.equal(dest.reason, 'unknown-target');
});

test('resolve accepts prefix:slug, effective slug, and bare slug references', async () => {
  const manifest = { blueprints: [{ slug: 'wsd-std-error-envelope', libraryPrefix: 'wsd' }] };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        sourceRef: 'local:./wsd-blueprints',
        issuesRepo: 'wsd-team-dev/rcf-lite-blueprints',
        issuesVisibility: 'private',
      },
    ],
  };
  for (const ref of ['wsd:std-error-envelope', 'wsd-std-error-envelope']) {
    const dest = await resolve({ kind: 'blueprint', target: { ref } }, { manifest, registry });
    assert.equal(dest.repo, 'wsd-team-dev/rcf-lite-blueprints', `ref '${ref}' resolves`);
  }
});

test('listUnresolvedLibraries names every registered library without a destination', () => {
  const registry = {
    libraries: [
      { libraryPrefix: 'wsd', issuesRepo: 'wsd/x' },
      { libraryPrefix: 'acme', sourceRef: 'git+https://gitlab.example/foo.git#v1', publisher: { contact: 'ops@acme.example' } },
      { libraryPrefix: 'derived', sourceRef: 'git+https://github.com/derived/foo.git#v1' },
      { libraryPrefix: 'empty' },
    ],
  };
  const rows = listUnresolvedLibraries(registry);
  const prefixes = rows.map((r) => r.libraryPrefix).sort();
  assert.deepEqual(prefixes, ['acme', 'empty']);
  const acme = rows.find((r) => r.libraryPrefix === 'acme');
  assert.equal(acme?.reason, 'no-github-source');
  assert.equal(acme?.publisherContact, 'ops@acme.example');
  const empty = rows.find((r) => r.libraryPrefix === 'empty');
  assert.equal(empty?.reason, 'no-issues-field');
});
