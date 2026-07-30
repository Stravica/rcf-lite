// Strand 3: seed writer for `rcf/.identity/profile.md` and the entry
// constant the managed-gitignore aggregator consumes to keep the
// directory ignored by default (0.6.0 spec §5, §4.1).
//
// Two exports:
// - `identityEntry`: the aggregator's registered entry; imported by
//   managed-gitignore.js and inserted into `managedGitignoreEntries()`.
// - `writeIdentityTemplate`: init calls this after the tree scaffold.
//   Idempotent: an existing profile.md is left byte-identical (§5.4).
//
// The template is a one-shot seed; doctor does not maintain its content
// (§5.5 — the profile is entirely operator-owned once written). Doctor
// cares only about presence and effective-ignore, both warn-only.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Entry constant consumed by `managed-gitignore.js`'s aggregator. Adding
 * this to `managedGitignoreEntries()` keeps `rcf/.identity/` out of the
 * shared repo by default (§4.1, §4.3, §5.1). The 0.7.0 credentials
 * side-file will follow the same pattern: import an entry constant from
 * its owning module, insert into the array, done.
 */
export const identityEntry = Object.freeze({
  path: 'rcf/.identity/',
  owner: 'rcf init: per-clone operator profile',
  since: '0.6.0',
});

/**
 * Canonical template written verbatim on fresh init (spec §5.4). British
 * English, no em-dashes, banned-tells baseline honoured; the same lint
 * fires against this constant per AC-4.7.
 */
export const IDENTITY_TEMPLATE = `# Operator profile

This file describes you (the operator) to any agent working on this
repo. It lives in \`rcf/.identity/\` and is gitignored by default, so
it is per-clone: another developer's clone of the same repo has their
own profile, not yours.

Fill in what is useful. Leave the rest. Freeform prose is fine; a
bulleted list is fine. Nothing here is enforced by tooling.

## Name

_(who you are; how you want the agent to address you)_

## Role

_(what you do; what perspective you bring to this project)_

## Working preferences

_(how you like to work: casual or formal register, verbose or terse
responses, willingness to be pushed back on, anything the agent should
know before choosing its default posture)_

## Project-scoped notes

_(anything specific to this project that would be useful for the agent
to know but does not belong in the shared requirements tree: a local
dev workflow quirk, an in-flight side-experiment, a "do not touch this
directory yet" flag)_

---

If you want to share your profile with the team, remove the
\`rcf/.identity/\` line from the managed block in \`.gitignore\` (or \`git
add -f rcf/.identity/profile.md\` for one-off sharing). The default is
per-clone. Sharing is deliberate.
`;

/**
 * Absolute path of the profile file for a given project root.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function identityProfilePath(projectRoot) {
  return join(projectRoot, 'rcf', '.identity', 'profile.md');
}

/**
 * Seed the identity template if not already present. Idempotent - an
 * existing file (any content) is left byte-identical, per AC-4.2.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<{ file: string, action: 'created' | 'kept' }>}
 */
export async function writeIdentityTemplate({ projectRoot }) {
  const path = identityProfilePath(projectRoot);
  try {
    await readFile(path, 'utf8');
    return { file: 'rcf/.identity/profile.md', action: 'kept' };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, IDENTITY_TEMPLATE, 'utf8');
  return { file: 'rcf/.identity/profile.md', action: 'created' };
}
