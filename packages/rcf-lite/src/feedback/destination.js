// Feedback destination resolver (TAC-4106-feedback-destination,
// ADR-4104-destination-on-library). Slice 3 (FBS-182): given a pending
// entry plus the project's manifest and library registry, work out
// which GitHub repo the finding should be filed against and whether it
// is public or private. The resolver is pure: no i/o, no network,
// nothing that would slow preview or submit down to disk speed.
//
// Resolution order (design section 3.3):
//   1. --kind core                        -> CORE_REPO (public)
//   2. --kind blueprint, no libraryPrefix -> CORE_REPO (shelf; public)
//   3. --kind blueprint, libraryPrefix    -> registry entry issuesRepo
//                                            (declared destination wins;
//                                            visibility from the entry)
//   4. registry entry with no issuesRepo  -> derive from sourceRef when
//                                            it parses as
//                                            git+https://github.com/OWNER/REPO(.git)#ref
//                                            (marked derived: true;
//                                            visibility defaults to
//                                            public unless the entry
//                                            already asserted private)
//   5. anything else                      -> unresolved (reason names
//                                            the why, publisherContact
//                                            carries the registry
//                                            contact when known)
//
// The CORE_REPO constant is derived from packages/rcf-lite/package.json
// bugs.url. Because a resolver call is on the hot path of preview and
// submit, and because reading package.json every call is wasteful and
// hard to test in isolation, the value is cached at module load time.
// A dedicated `resolveCoreRepo()` helper (also exported) does the
// parse; consumers with their own package.json can call it directly
// and the resolver's CORE_REPO getter reads through it.

import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// packages/rcf-lite/src/feedback -> packages/rcf-lite/package.json.
const PACKAGE_JSON_PATH = resolvePath(here, '..', '..', 'package.json');
const CORE_REPO_FALLBACK = 'Stravica/rcf-lite';

/**
 * The Stravica/rcf-lite constant that every core-kind entry and every
 * shelf-blueprint entry routes to. Sourced from
 * `packages/rcf-lite/package.json:bugs.url` at module load so a rename
 * only ripples through one file; a matching unit test pins the constant
 * to the package.json value at test time so a drift is caught in CI.
 *
 * @type {string}
 */
export let CORE_REPO = CORE_REPO_FALLBACK;

/** Guard against double-init during test loops. */
let coreRepoInitialised = false;

/**
 * Parse `bugs.url` from a package.json object and return `OWNER/REPO`.
 * Accepts the trailing `/issues`, an `.git` suffix and either the
 * string or the object shape npm allows on `bugs`.
 *
 * @param {object | undefined | null} pkg
 * @returns {string | null}
 */
export function parseBugsRepo(pkg) {
  if (pkg == null) return null;
  const bugs = typeof pkg.bugs === 'string' ? pkg.bugs : pkg?.bugs?.url;
  if (typeof bugs !== 'string' || bugs.length === 0) return null;
  const withIssues = bugs.match(/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/issues\/?(?:[/?#].*)?$/i);
  if (withIssues) return `${withIssues[1]}/${withIssues[2]}`;
  const bare = bugs.match(/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
  if (bare) return `${bare[1]}/${bare[2]}`;
  return null;
}

/**
 * Read `packages/rcf-lite/package.json` and populate `CORE_REPO`. Safe
 * to call more than once; a failed read leaves the fallback in place.
 * The resolver auto-inits on first `resolve()` call, so most callers
 * never touch this directly; tests call it to force a fresh read.
 *
 * @returns {Promise<string>}
 */
export async function initCoreRepo() {
  try {
    const text = await readFile(PACKAGE_JSON_PATH, 'utf8');
    const pkg = JSON.parse(text);
    const parsed = parseBugsRepo(pkg);
    if (parsed) CORE_REPO = parsed;
  } catch {
    // Missing or unreadable package.json leaves the fallback active.
    // A dedicated test pins the value in CI so this branch never ships.
  }
  coreRepoInitialised = true;
  return CORE_REPO;
}

/**
 * Parse a git sourceRef of the shape `git+https://github.com/OWNER/REPO(.git)#ref`
 * (or `git+ssh://git@github.com:OWNER/REPO.git#ref`, the two shapes
 * `library add` accepts) into `OWNER/REPO`. Anything else returns null;
 * the resolver treats that as "cannot derive", not as an error.
 *
 * @param {string} sourceRef
 * @returns {string | null}
 */
export function parseGithubSource(sourceRef) {
  if (typeof sourceRef !== 'string' || sourceRef.length === 0) return null;
  // git+https://github.com/OWNER/REPO(.git)(#ref)
  const https = sourceRef.match(/^git\+https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:#.*)?$/i);
  if (https) return `${https[1]}/${https[2]}`;
  // git+ssh://git@github.com:OWNER/REPO.git(#ref) or git+ssh://git@github.com/OWNER/REPO.git(#ref)
  const ssh = sourceRef.match(/^git\+ssh:\/\/git@github\.com[:\/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:#.*)?$/i);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  return null;
}

/**
 * Look up a blueprint record on `manifest.blueprints[]` by ref. Accepts
 * the shelf slug (`security-auth-magic-link`), the prefix:slug form
 * (`wsd:std-error-envelope`) and the effective slug already stamped
 * onto the record (`wsd-std-error-envelope`).
 *
 * F-slice-3-01: a QUALIFIED ref (`prefix:slug`) must resolve to a
 * record whose libraryPrefix matches the qualifier. Falling back to
 * an unqualified shelf record on slug collision would route a
 * private WSD finding to the public Stravica/rcf-lite repo. The
 * matcher therefore has two passes: first, any record whose stamped
 * effectiveSlug OR (slug + libraryPrefix) matches the qualifier
 * wins; only when the ref is unqualified do bare-slug matches apply.
 *
 * @param {object | null | undefined} manifest
 * @param {string} ref
 * @returns {object | null}
 */
export function findBlueprintRecord(manifest, ref) {
  const list = Array.isArray(manifest?.blueprints) ? manifest.blueprints : [];
  if (typeof ref !== 'string' || ref.length === 0) return null;

  // Qualified `prefix:slug` (and the equivalent `prefix-slug`
  // effective-slug shape) must NEVER match a shelf record whose
  // libraryPrefix does not equal the qualifier. F-slice-3-01: a
  // qualified WSD ref must not fall back to a public shelf record
  // on slug collision.
  if (ref.includes(':')) {
    const [pre, slug] = ref.split(':');
    if (pre && slug) {
      const effective = `${pre}-${slug}`;
      for (const r of list) {
        if (!r || typeof r !== 'object') continue;
        if (r.libraryPrefix !== pre) continue;
        const candidates = recordCandidates(r);
        if (candidates.includes(ref) || candidates.includes(effective) || candidates.includes(slug)) return r;
      }
      return null;
    }
  }

  // Unqualified ref: match by any candidate. A record with a
  // libraryPrefix still matches, but only through its stamped
  // canonical effective slug (`libraryPrefix-slug`) - never through
  // a bare, unqualified slug that could collide with a shelf record.
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const isQualifiedRecord = typeof r.libraryPrefix === 'string' && r.libraryPrefix.length > 0;
    if (isQualifiedRecord) {
      const canonical = recordEffectiveSlug(r);
      if (canonical && ref === canonical) return r;
      continue;
    }
    const candidates = recordCandidates(r);
    if (candidates.includes(ref)) return r;
  }
  return null;
}

/**
 * The candidate name set stamped on a manifest record: any of
 * effectiveSlug, slug, name that are non-empty strings.
 *
 * @param {object} record
 * @returns {string[]}
 */
function recordCandidates(record) {
  return [record.effectiveSlug, record.slug, record.name].filter(
    (s) => typeof s === 'string' && s.length > 0,
  );
}

/**
 * The canonical effective slug for a qualified manifest record. If
 * the record already carries `effectiveSlug`, that wins; otherwise
 * synthesise it from `libraryPrefix` + `slug` (either the slug is
 * already prefixed, or we prepend the prefix).
 *
 * @param {object} record
 * @returns {string | null}
 */
function recordEffectiveSlug(record) {
  if (typeof record.effectiveSlug === 'string' && record.effectiveSlug.length > 0) return record.effectiveSlug;
  const pre = typeof record.libraryPrefix === 'string' ? record.libraryPrefix : '';
  const slug = typeof record.slug === 'string' ? record.slug : '';
  if (!pre || !slug) return null;
  return slug.startsWith(`${pre}-`) ? slug : `${pre}-${slug}`;
}

/**
 * @typedef {object} Destination
 * @property {string | null} repo         OWNER/REPO or null when unresolved
 * @property {'public' | 'private' | 'unresolved'} visibility
 * @property {'core' | 'shelf' | 'library'} kind
 * @property {boolean} derived            true when repo came from sourceRef derivation
 * @property {string} [reason]            filled on unresolved: 'no-issues-field' | 'no-github-source' | 'no-libraryprefix-record' | 'unknown-target'
 * @property {string} [publisherContact]  registry entry's publisher.contact (bundle uses it)
 * @property {string} [source]            'library-manifest' | 'sourceRef-derivation' | 'package-bugs-url' | 'shelf-constant'
 */

/**
 * Resolve one entry to its destination shape. Pure over the inputs.
 *
 * @param {object} entry                 a feedback entry (design §4.1)
 * @param {object} [context]
 * @param {object} [context.manifest]    parsed rcf/manifest.json
 * @param {object} [context.registry]    parsed rcf/blueprint-libraries.json
 * @returns {Promise<Destination>}
 */
export async function resolve(entry, context = {}) {
  if (!coreRepoInitialised) await initCoreRepo();
  const manifest = context.manifest ?? null;
  const registry = context.registry ?? { libraries: [] };
  const kind = entry?.kind;

  if (kind === 'core') {
    return {
      repo: CORE_REPO,
      visibility: 'public',
      kind: 'core',
      derived: false,
      source: 'package-bugs-url',
    };
  }
  if (kind !== 'blueprint') {
    return {
      repo: null,
      visibility: 'unresolved',
      kind: 'library',
      derived: false,
      reason: 'unknown-target',
    };
  }

  const ref = entry?.target?.ref;
  const record = findBlueprintRecord(manifest, ref);
  if (!record) {
    return {
      repo: null,
      visibility: 'unresolved',
      kind: 'library',
      derived: false,
      reason: 'unknown-target',
    };
  }

  const libraryPrefix = record.libraryPrefix ?? entry?.target?.libraryPrefix ?? null;

  // Shelf blueprint (no libraryPrefix) -> Stravica/rcf-lite.
  if (!libraryPrefix) {
    return {
      repo: CORE_REPO,
      visibility: 'public',
      kind: 'shelf',
      derived: false,
      source: 'package-bugs-url',
    };
  }

  const libEntry = findLibraryEntry(registry, libraryPrefix);
  if (!libEntry) {
    return {
      repo: null,
      visibility: 'unresolved',
      kind: 'library',
      derived: false,
      reason: 'no-libraryprefix-record',
    };
  }

  const contact = typeof libEntry?.publisher?.contact === 'string'
    ? libEntry.publisher.contact
    : undefined;

  // Declared destination wins.
  if (typeof libEntry.issuesRepo === 'string' && libEntry.issuesRepo.length > 0) {
    const declaredVisibility = libEntry.issuesVisibility === 'private' ? 'private'
      : libEntry.issuesVisibility === 'public' ? 'public'
        : 'public';
    return {
      repo: libEntry.issuesRepo,
      visibility: declaredVisibility,
      kind: 'library',
      derived: false,
      source: 'library-manifest',
      ...(contact ? { publisherContact: contact } : {}),
    };
  }

  // Fallback: derive from sourceRef when it parses as a github URL.
  const derived = parseGithubSource(libEntry.sourceRef ?? '');
  if (derived) {
    return {
      repo: derived,
      visibility: 'public',
      kind: 'library',
      derived: true,
      source: 'sourceRef-derivation',
      ...(contact ? { publisherContact: contact } : {}),
    };
  }

  // Neither declared nor derivable: unresolved.
  return {
    repo: null,
    visibility: 'unresolved',
    kind: 'library',
    derived: false,
    reason: libEntry.sourceRef ? 'no-github-source' : 'no-issues-field',
    ...(contact ? { publisherContact: contact } : {}),
  };
}

/**
 * Enumerate every registered library and flag the ones the resolver
 * cannot produce a destination for (no issues field and no derivable
 * github source). Doctor's `feedback-destinations` check consumes this;
 * the shape is `{ libraryPrefix, reason, publisherContact? }`.
 *
 * @param {object} registry
 * @returns {Array<{ libraryPrefix: string, reason: 'no-issues-field' | 'no-github-source', publisherContact?: string }>}
 */
export function listUnresolvedLibraries(registry) {
  const out = [];
  const libs = Array.isArray(registry?.libraries) ? registry.libraries : [];
  for (const lib of libs) {
    if (typeof lib?.libraryPrefix !== 'string') continue;
    if (typeof lib.issuesRepo === 'string' && lib.issuesRepo.length > 0) continue;
    const derived = parseGithubSource(lib.sourceRef ?? '');
    if (derived) continue;
    const contact = typeof lib?.publisher?.contact === 'string' ? lib.publisher.contact : undefined;
    out.push({
      libraryPrefix: lib.libraryPrefix,
      reason: lib.sourceRef ? 'no-github-source' : 'no-issues-field',
      ...(contact ? { publisherContact: contact } : {}),
    });
  }
  return out;
}

function findLibraryEntry(registry, libraryPrefix) {
  const libs = Array.isArray(registry?.libraries) ? registry.libraries : [];
  return libs.find((l) => l?.libraryPrefix === libraryPrefix) ?? null;
}
