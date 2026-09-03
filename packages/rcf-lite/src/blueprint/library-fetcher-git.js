// Git fetcher for external blueprint libraries (Phase 2c, spec §6.2).
//
// Supports two pin forms: a 40-character commit sha, or an annotated
// tag. Lightweight tags, branch names, HEAD and `latest` are refused
// categorically at classification time (spec §6.1) - a floating ref is
// a supply-chain hazard the pinning discipline exists to catch.
//
// Transport: the ambient `git` command-line tool via `execFile`. No
// libgit2 dependency; per spec §6.2 auth surface is `none` in v1, so
// private-repo libraries must be mirrored to a local clone the
// operator has access to (spec §9.4 ratified: ambient git access is
// the model, full stop; no-access is definitive).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, rename, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rcfError } from '../core/errors/index.js';

const execFileAsync = promisify(execFile);

const SHA_FULL = /^[0-9a-f]{40}$/i;
// Tag shape: kebab or dotted, permissive because publishers pick their
// own tag conventions. We refuse `HEAD` / `latest` and known branch
// aliases explicitly; anything else is treated as a tag candidate and
// checked for annotation post-fetch.
const REFUSED_REFS = new Set(['HEAD', 'head', 'FETCH_HEAD', 'MERGE_HEAD', 'ORIG_HEAD', 'latest', 'main', 'master', 'trunk', 'develop']);

/**
 * Parse a `git+<url>#<ref>` or `<url>#<ref>` source ref into its
 * components. The `git+` scheme prefix is stripped for the underlying
 * `git` command (which does not understand it); the fragment `#<ref>`
 * becomes the pin. Refuses missing fragment (spec §6.1: pin discipline
 * is mandatory, floating refs are refused).
 *
 * @param {string} sourceRef
 * @returns {{ url: string, ref: string, refKind: 'sha' | 'tag' } | import('../core/errors/index.js').RcfError}
 */
export function parseGitRef(sourceRef) {
  if (typeof sourceRef !== 'string' || sourceRef.length === 0) {
    return rcfError({ kind: 'usage', message: 'git library ref: source is empty' });
  }
  const hashIdx = sourceRef.lastIndexOf('#');
  if (hashIdx < 0) {
    return rcfError({
      kind: 'usage',
      message: `git library ref '${sourceRef}': missing '#<ref>' pin. Every git library pins to a commit sha or an annotated tag (spec §6.1); floating branches are refused.`,
    });
  }
  const rawUrl = sourceRef.slice(0, hashIdx);
  const ref = sourceRef.slice(hashIdx + 1);
  if (ref.length === 0) {
    return rcfError({ kind: 'usage', message: `git library ref '${sourceRef}': empty ref after '#'.` });
  }
  const url = rawUrl.startsWith('git+') ? rawUrl.slice(4) : rawUrl;
  if (url.length === 0) {
    return rcfError({ kind: 'usage', message: `git library ref '${sourceRef}': empty URL before '#'.` });
  }
  if (REFUSED_REFS.has(ref)) {
    return rcfError({
      kind: 'usage',
      message: `git library ref '${sourceRef}': ref '${ref}' is a floating branch or alias; pin to an annotated tag or a commit sha.`,
    });
  }
  const refKind = SHA_FULL.test(ref) ? 'sha' : 'tag';
  return { url, ref, refKind };
}

/**
 * Fetch a git library at a pinned ref into a target directory. The
 * target must be empty (the caller uses `library-cache.ensureEmptyCache`
 * first). Returns the resolved commit sha and the library root, or an
 * RcfError. Rolls back a partial fetch on failure.
 *
 * @param {object} args
 * @param {string} args.url                  git URL (post `git+` strip)
 * @param {string} args.ref                  sha or tag
 * @param {'sha' | 'tag'} args.refKind
 * @param {string} args.targetDir            absolute path to place the checkout
 * @param {string} [args.git='git']          override for tests
 * @param {number} [args.timeoutMs=120000]   per-invocation timeout for git
 * @returns {Promise<{ resolvedSha: string, root: string } | import('../core/errors/index.js').RcfError>}
 */
export async function fetchGitLibrary({ url, ref, refKind, targetDir, git = 'git', timeoutMs = 120000 }) {
  // Fetch into a sibling temp dir first, then rename onto targetDir on
  // success. This keeps `targetDir` empty until the fetch is verified,
  // and gives a clean rollback path on any git error.
  let scratch;
  try {
    scratch = await mkdtemp(join(tmpdir(), 'rcf-lib-git-'));
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `git fetch: scratch dir: ${err.message}`, stack: err.stack });
  }
  try {
    const runGit = (args) => execFileAsync(git, args, { cwd: process.cwd(), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });

    if (refKind === 'tag') {
      // Shallow clone at the tag. `--no-tags` prevents pulling every
      // tag object; the target tag object still arrives because
      // `--branch <tag>` fetches it explicitly.
      try {
        await runGit(['clone', '--depth', '1', '--branch', ref, '--no-tags', url, scratch]);
      } catch (err) {
        return rcfError({
          kind: 'usage',
          message: `git fetch: clone --branch ${ref} from ${url} failed: ${cleanGitStderr(err)}`,
        });
      }
      // Verify annotation. Annotated tags produce a tag OBJECT
      // (`cat-file -t refs/tags/<t>` returns 'tag'); lightweight tags
      // point straight at a commit and return 'commit'. The spec pin
      // discipline (§6.1) requires annotation.
      const objType = await runGitLine(runGit, ['cat-file', '-t', `refs/tags/${ref}`]);
      if (typeof objType !== 'string') return objType;
      if (objType.trim() !== 'tag') {
        return rcfError({
          kind: 'usage',
          message: `git fetch: ref '${ref}' at ${url} is a lightweight tag (or a branch alias). Publishers must ship annotated tags so the pin has a tamper-evident object; re-tag upstream, or pin to a sha.`,
        });
      }
      const sha = await runGitLine(runGit, ['rev-parse', `${ref}^{commit}`]);
      if (typeof sha !== 'string') return sha;
      const resolvedSha = sha.trim();
      if (!SHA_FULL.test(resolvedSha)) {
        return rcfError({ kind: 'usage', message: `git fetch: rev-parse produced non-sha output '${resolvedSha}'` });
      }
      const settled = await settleCache(scratch, targetDir);
      if (settled) return settled;
      return { resolvedSha, root: targetDir };
    }

    // sha ref: full history (a shallow clone cannot land on an arbitrary
    // sha unless the server advertises it via `uploadpack.allowReachableSHA1InWant`;
    // full clone is the portable option). We disable checkout so the
    // sha resolve and the switch happen after the fetch settled.
    try {
      await runGit(['clone', '--no-checkout', '--no-tags', url, scratch]);
    } catch (err) {
      return rcfError({
        kind: 'usage',
        message: `git fetch: clone from ${url} failed: ${cleanGitStderr(err)}`,
      });
    }
    // Verify the sha exists AND names a commit (not a tree, blob or
    // annotated-tag object). `cat-file -e` fails on unknown objects.
    try {
      await execFileAsync(git, ['cat-file', '-e', ref], { cwd: scratch, encoding: 'utf8', timeout: timeoutMs });
    } catch {
      return rcfError({
        kind: 'usage',
        message: `git fetch: commit sha '${ref}' is not reachable in ${url}. Check the sha, or ask the publisher to keep the ref in their history.`,
      });
    }
    const commitType = await runGitLine((args) => execFileAsync(git, args, { cwd: scratch, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }), ['cat-file', '-t', ref]);
    if (typeof commitType !== 'string') return commitType;
    if (commitType.trim() !== 'commit') {
      return rcfError({
        kind: 'usage',
        message: `git fetch: ref '${ref}' names a git object of type '${commitType.trim()}', not a commit.`,
      });
    }
    try {
      await execFileAsync(git, ['-c', 'advice.detachedHead=false', 'checkout', ref], { cwd: scratch, encoding: 'utf8', timeout: timeoutMs });
    } catch (err) {
      return rcfError({ kind: 'usage', message: `git fetch: checkout ${ref} failed: ${cleanGitStderr(err)}` });
    }
    const settled = await settleCache(scratch, targetDir);
    if (settled) return settled;
    return { resolvedSha: ref.toLowerCase(), root: targetDir };
  } catch (err) {
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
    return rcfError({ kind: 'ioFailure', message: `git fetch: ${err.message}`, stack: err.stack });
  }
}

/**
 * Re-resolve the current commit sha of a tag at a remote without
 * cloning. Used by `library refresh` on git sources to detect an
 * annotated-tag move (spec §6.4 / §9.12: refuse on drift, never rewrite
 * the pin).
 *
 * @param {object} args
 * @param {string} args.url
 * @param {string} args.ref
 * @param {'sha' | 'tag'} args.refKind
 * @param {string} [args.git='git']
 * @param {number} [args.timeoutMs=60000]
 * @returns {Promise<{ resolvedSha: string } | import('../core/errors/index.js').RcfError>}
 */
export async function resolveRemoteSha({ url, ref, refKind, git = 'git', timeoutMs = 60000 }) {
  if (refKind === 'sha') {
    // Pinned to a commit sha; the sha is its own identity, nothing to
    // re-resolve upstream. Refresh callers already have this value in
    // the registry.
    return { resolvedSha: ref.toLowerCase() };
  }
  try {
    // `ls-remote` prints one line per matching ref: `<sha>\t<name>`.
    // For an ANNOTATED tag the output has two rows:
    //   <tag-object-sha> refs/tags/<t>
    //   <peeled-commit-sha> refs/tags/<t>^{}
    // We take the peeled row (the commit the tag points at); if no
    // peeled row appears the tag is lightweight and we refuse for the
    // same reason as the fetch path (spec §6.1).
    const { stdout } = await execFileAsync(git, ['ls-remote', '--tags', url, ref], {
      encoding: 'utf8', timeout: timeoutMs,
    });
    const lines = stdout.split('\n').filter((l) => l.length > 0);
    const peeled = lines.find((l) => l.endsWith('^{}'));
    if (peeled) {
      const sha = peeled.split(/\s+/)[0];
      if (!SHA_FULL.test(sha)) {
        return rcfError({ kind: 'usage', message: `git resolve: ls-remote returned non-sha '${sha}'` });
      }
      return { resolvedSha: sha.toLowerCase() };
    }
    const plain = lines.find((l) => l.endsWith(`refs/tags/${ref}`));
    if (plain) {
      return rcfError({
        kind: 'usage',
        message: `git resolve: tag '${ref}' at ${url} is lightweight (no peeled row); pin discipline requires an annotated tag or a sha.`,
      });
    }
    return rcfError({
      kind: 'usage',
      message: `git resolve: no tag '${ref}' found at ${url}. The publisher may have removed it.`,
    });
  } catch (err) {
    return rcfError({ kind: 'usage', message: `git resolve: ls-remote ${url} ${ref} failed: ${cleanGitStderr(err)}` });
  }
}

async function runGitLine(runner, args) {
  try {
    const { stdout } = await runner(args);
    return stdout;
  } catch (err) {
    return rcfError({ kind: 'usage', message: `git ${args.join(' ')}: ${cleanGitStderr(err)}` });
  }
}

async function settleCache(scratch, targetDir) {
  // The library root is `scratch`; we rename it INTO the targetDir. On
  // POSIX rename is atomic when both paths sit on the same filesystem;
  // when they do not, fall back to a directory-tree copy. `ensureEmptyCache`
  // in the caller has already created targetDir; we replace its dir
  // entry with the scratch tree by renaming scratch onto it after a
  // preparatory removal.
  try {
    await rm(targetDir, { recursive: true, force: true });
    await rename(scratch, targetDir);
    return null;
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Cross-device rename; copy tree and clean up scratch.
      try {
        const { cp } = await import('node:fs/promises');
        await cp(scratch, targetDir, { recursive: true });
        await rm(scratch, { recursive: true, force: true }).catch(() => {});
        return null;
      } catch (copyErr) {
        return rcfError({ kind: 'ioFailure', message: `git fetch: cross-device settle failed: ${copyErr.message}`, stack: copyErr.stack });
      }
    }
    return rcfError({ kind: 'ioFailure', message: `git fetch: settle failed: ${err.message}`, stack: err.stack });
  }
}

/**
 * Trim the noisy `Command failed:` header and any newline flotsam off a
 * child-process error so the diagnostic reads clean at the CLI edge.
 *
 * @param {any} err
 * @returns {string}
 */
function cleanGitStderr(err) {
  const parts = [];
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  if (stderr.length > 0) parts.push(stderr);
  else if (typeof err?.message === 'string') parts.push(err.message.replace(/^Command failed:.*$/m, '').trim());
  const cleaned = parts.filter(Boolean).join('; ');
  return cleaned.length > 0 ? cleaned : 'git exited with a non-zero status';
}

/** Read-only. Test-visible so unit tests can assert. */
export function isFullSha(s) {
  return typeof s === 'string' && SHA_FULL.test(s);
}

/** Refused branch/alias names, test-visible. */
export function refusedRefs() {
  return new Set(REFUSED_REFS);
}

// Utility read of the on-disk cache contents; useful for callers that
// want to enumerate the extracted tree without importing node:fs.
export async function listCacheEntries(dir) {
  return readdir(dir);
}
