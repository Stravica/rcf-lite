// Shared test helper for FBS-223 (separation wiring): commits carrying
// several trailers, a read-back of the trailer keys the wiring reads, and
// a shallow clone of a fixture. Builds on test/_helpers/git-history.js
// (same world, same isolated git env) and leaves its exports as they are.
//
// `commitTrailers` writes the message itself (`git commit -F` with
// `--cleanup=verbatim`), so the trailer block is exactly as typed: an
// empty `Separation-Reason:` or one holding only spaces stays in the
// message. `readTrailers` reads each commit back through the trailers
// format key for Hand, Separation-Reason and Hand-Id, the raw last
// paragraph and `--name-only`. `shallowClone` clones the world's local
// bare origin through its file:// URL (git ignores a depth on a plain
// local path) into the world's own scratch dir.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { git } from './git-history.js';

export const TRAILER_KEYS = ['Hand', 'Separation-Reason', 'Hand-Id'];

// One commit touching `paths` (content unique to the commit unless
// `files` gives it) whose message is `subject`, a blank line, then one
// `Key: value` line per trailer pair (`Key:` alone for an empty value).
export function commitTrailers(world, subject, paths, trailers, { files = {} } = {}) {
  for (const p of paths) {
    mkdirSync(dirname(join(world.repo, p)), { recursive: true });
    writeFileSync(join(world.repo, p), files[p] ?? `${subject}: ${p}\n`);
  }
  git(world, world.repo, ['add', '--', ...paths]);
  const block = trailers.map(([k, v]) => (v === '' ? `${k}:` : `${k}: ${v}`)).join('\n');
  world.tick += 1;
  const msg = join(world.root, `msg-${world.tick}.txt`);
  writeFileSync(msg, block ? `${subject}\n\n${block}\n` : `${subject}\n`);
  const when = `2026-10-19T00:${String(world.tick).padStart(2, '0')}:00Z`;
  git(world, world.repo, ['commit', '-q', '--cleanup=verbatim', '-F', msg],
    { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  return git(world, world.repo, ['rev-parse', 'HEAD']);
}

// The non-merge and merge commits in `range` (from `cwd`), oldest first:
// parents, the parsed Hand / Separation-Reason / Hand-Id trailers as git
// reads them (`Key: value`, trailing space trimmed), the raw last
// paragraph of the message and the paths the commit names.
export function readTrailers(world, { cwd = world.repo, range = 'origin/main..HEAD' } = {}) {
  const shas = git(world, cwd, ['rev-list', '--reverse', range]).split('\n').filter(Boolean);
  const keys = TRAILER_KEYS.map((k) => `key=${k}`).join(',');
  return shas.map((sha) => {
    const out = git(world, cwd, ['log', '-1', '--name-only',
      `--format=%P%x1f%(trailers:${keys},separator=%x1e)%x1f%B%x1f`, sha]);
    const [parents, trailers, body, rest] = out.split('\x1f');
    const paragraphs = body.split(/\n\n+/).filter((p) => p.trim() !== '');
    return {
      sha,
      parents: parents.split(' ').filter(Boolean),
      trailers: trailers ? trailers.split('\x1e').map((s) => s.trimEnd()) : [],
      lastParagraph: paragraphs.length > 1 ? paragraphs[paragraphs.length - 1].replace(/\n$/, '') : '',
      paths: rest.split('\n').filter(Boolean).sort(),
    };
  });
}

// Clone the world's origin at `depth` into <root>/<name>, every branch
// fetched (`--no-single-branch`) so origin/main resolves, `branch`
// checked out. Returns the clone's path.
export function shallowClone(world, { depth = 1, branch = 'feature', name = 'shallow' } = {}) {
  const dest = join(world.root, name);
  git(world, world.root, ['clone', '-q', `--depth=${depth}`, '--no-single-branch', '--branch', branch,
    `file://${world.origin}`, dest]);
  return dest;
}
