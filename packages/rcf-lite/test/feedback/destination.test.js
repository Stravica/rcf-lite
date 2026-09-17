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

test('F-slice-3-01: qualified prefix:slug never falls back to a shelf record on slug collision (private WSD stays off Stravica/rcf-lite)', async () => {
  const manifest = {
    blueprints: [
      // The shelf record is listed FIRST so a first-match-wins
      // scanner would return it. The qualified WSD record must
      // still win when the ref is `wsd:security-auth-magic-link`.
      { slug: 'security-auth-magic-link' },
      { slug: 'wsd-security-auth-magic-link', libraryPrefix: 'wsd' },
    ],
  };
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
  const dest = await resolve(
    { kind: 'blueprint', target: { ref: 'wsd:security-auth-magic-link' } },
    { manifest, registry },
  );
  assert.equal(dest.repo, 'wsd-team-dev/rcf-lite-blueprints', 'AC-15801-2 qualified ref must match the WSD library');
  assert.equal(dest.visibility, 'private');
  assert.equal(dest.kind, 'library');
});

test('F-slice-3-01: bare slug against a qualified record does not match (routes to shelf CORE_REPO on slug collision)', async () => {
  const manifest = {
    blueprints: [
      // Only a qualified WSD record on the manifest; a bare
      // `security-auth-magic-link` reference is a shelf reference
      // by intent and must not be diverted to the WSD destination.
      { slug: 'wsd-security-auth-magic-link', libraryPrefix: 'wsd' },
    ],
  };
  const registry = {
    libraries: [
      { libraryPrefix: 'wsd', issuesRepo: 'wsd-team-dev/rcf-lite-blueprints', issuesVisibility: 'private' },
    ],
  };
  const dest = await resolve(
    { kind: 'blueprint', target: { ref: 'security-auth-magic-link' } },
    { manifest, registry },
  );
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

test('AC-15801-4 library-slug-inference: bare-slug apply routes to the single library owning the slug when it declares issuesRepo', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'application-spa' } };
  // Bare-slug manifest record: no libraryPrefix stamped. This is what a
  // `rcf define blueprint add application-spa` produces when the shelf
  // and a registered library both own the slug (design amendment R5a).
  const manifest = { blueprints: [{ slug: 'application-spa' }] };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        issuesRepo: 'wsd-team-dev/rcf-lite-blueprints',
        issuesVisibility: 'private',
        publisher: { id: 'wsd', displayName: 'WSD', contact: 'ops@wsd.example' },
        blueprints: [{ slug: 'application-spa', path: 'blueprints/application-spa' }],
      },
    ],
  };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(dest.kind, 'library');
  assert.equal(dest.visibility, 'private');
  assert.equal(dest.derived, false);
  assert.equal(dest.source, 'library-slug-inference');
  assert.equal(dest.publisherContact, 'ops@wsd.example');
});

test('AC-15801-4 library-slug-inference: derives from sourceRef when the single library owner has no issuesRepo but has a github source', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'application-spa' } };
  const manifest = { blueprints: [{ slug: 'application-spa' }] };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        sourceRef: 'git+https://github.com/wsd-team-dev/rcf-lite-blueprints.git#v1.0.0',
        blueprints: [{ slug: 'application-spa' }],
      },
    ],
  };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(dest.derived, true);
  assert.equal(dest.source, 'library-slug-inference');
});

test('AC-15801-4 library-slug-inference: two libraries owning the same slug return unresolved with reason ambiguous-library-slug', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'application-spa' } };
  const manifest = { blueprints: [{ slug: 'application-spa' }] };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        issuesRepo: 'wsd-team-dev/rcf-lite-blueprints',
        blueprints: [{ slug: 'application-spa' }],
      },
      {
        libraryPrefix: 'ally',
        issuesRepo: 'ally-team/blueprints',
        blueprints: [{ slug: 'application-spa' }],
      },
    ],
  };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, null);
  assert.equal(dest.visibility, 'unresolved');
  assert.equal(dest.kind, 'library');
  assert.equal(dest.reason, 'ambiguous-library-slug');
  assert.deepEqual(dest.candidates, ['ally', 'wsd']);
});

test('AC-15801-4 library-slug-inference: no library owns the slug -> shelf constant fall-through', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'security-auth-magic-link' } };
  const manifest = { blueprints: [{ slug: 'security-auth-magic-link' }] };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        issuesRepo: 'wsd-team-dev/rcf-lite-blueprints',
        blueprints: [{ slug: 'wsd-payments' }, { slug: 'wsd-invoicing' }],
      },
    ],
  };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, CORE_REPO);
  assert.equal(dest.kind, 'shelf');
  assert.equal(dest.source, 'package-bugs-url');
});

test('AC-15801-4 library-slug-inference: an owning library that resolves to nothing (no issues, no github source) does not count and shelf still fires', async () => {
  const entry = { kind: 'blueprint', target: { ref: 'application-spa' } };
  const manifest = { blueprints: [{ slug: 'application-spa' }] };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        // No issuesRepo, no github sourceRef -> library does not resolve.
        sourceRef: 'local:./wsd-blueprints',
        blueprints: [{ slug: 'application-spa' }],
      },
    ],
  };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, CORE_REPO);
  assert.equal(dest.kind, 'shelf');
});

test('AC-15801-4 library-slug-inference: never overrides an existing libraryPrefix resolution', async () => {
  // A qualified apply produces a manifest record with libraryPrefix
  // and the effectiveSlug already stamped. That path must go straight
  // to the registry's issuesRepo (AC-15801-2), NOT through the R5a
  // slug-inference branch.
  const entry = { kind: 'blueprint', target: { ref: 'wsd:application-spa' } };
  const manifest = {
    blueprints: [{
      slug: 'wsd-application-spa',
      effectiveSlug: 'wsd-application-spa',
      libraryPrefix: 'wsd',
    }],
  };
  const registry = {
    libraries: [
      {
        libraryPrefix: 'wsd',
        issuesRepo: 'wsd-team-dev/rcf-lite-blueprints',
        issuesVisibility: 'private',
        blueprints: [{ slug: 'application-spa' }],
      },
    ],
  };
  const dest = await resolve(entry, { manifest, registry });
  assert.equal(dest.repo, 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(dest.source, 'library-manifest', 'must come from AC-15801-2 path, not R5a');
});
