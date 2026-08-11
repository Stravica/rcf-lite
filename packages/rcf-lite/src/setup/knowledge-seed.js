// Strand 2: seed writer for `rcf/knowledge/` (0.6.0 spec §3). Init
// writes four files unconditionally on a fresh scaffold; on a re-run,
// any managed file that already exists is left byte-identical. The
// seed is convention-only in v1 (no CLI verb, no retrieval machinery);
// what ships is the README that teaches the convention and a stub
// INDEX.md for human bullets.
//
// Idempotency contract (§3.3): the four files above are the ones that
// count as "managed by init". Any file the operator drops under
// `rcf/knowledge/` stays as-is. If the whole tree is missing on a
// re-run, init re-seeds it (a repo that pre-dates 0.6.0 gets the
// convention retroactively without needing a hand-edit).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Canonical README (spec §3.4). Verbatim. */
export const KNOWLEDGE_README = `# Knowledge

This directory is the project's memory. Everything an agent working on
this repo should not have to relearn from scratch belongs here.

## The convention

- **\`notes/\`**: internal facts. Decisions, gotchas, runtime facts,
  the small things that always cost time to rediscover ("the CI matrix
  uses Node 22 not 24", "the pnpm store path on this machine is
  non-default", "the local Postgres is on port 5433 not 5432"). Written
  for future agents and future you, not for public readers.
- **\`docs/\`**: user-facing prose the project might surface elsewhere.
  Design notes the operator wants tidy, sections that might land in a
  README or a spec, prose intended for a wider audience.

## The rules

1. **One topic per file.** The filename is the topic
   (\`notes/ci-node-version.md\`, not \`notes/general.md\`). One paragraph
   is enough. An empty file that only carries a pointer to somewhere
   else is fine. A file called \`misc.md\` or \`general.md\` is not.
2. **Write on learn.** If this session established a fact the next
   session should not have to rediscover, write it here before the
   session ends.
3. **Grep before asking.** Before asking the stakeholder a question,
   \`rg -n '<topic>' rcf/knowledge/\` to see whether the answer is
   already here.

## \`INDEX.md\`

\`INDEX.md\` is a human table of contents. Add a bullet when you add a
file. Keep it grouped by area if it grows. Nobody scans it
programmatically in v1; it is for the person landing on the repo cold.

## What this is not

This is not a knowledge graph. There is no CLI verb, no indexer, no
vector search. If a project needs one, that is a v2 decision, not a v1
default. The convention above is deliberately cheap. The value is in
the discipline of using it.
`;

/** Canonical INDEX.md stub (spec §3.4). Verbatim. */
export const KNOWLEDGE_INDEX = `# Knowledge index

The human table of contents for \`rcf/knowledge/\`. Add a bullet when you
add a file. Keep it grouped by area if it grows.

## Notes

_(none yet)_

## Docs

_(none yet)_
`;

/**
 * Absolute path helpers for the seed files.
 *
 * @param {string} projectRoot
 * @returns {{ dir: string, readme: string, index: string, notesKeep: string, docsKeep: string }}
 */
export function knowledgePaths(projectRoot) {
  const dir = join(projectRoot, 'rcf', 'knowledge');
  return {
    dir,
    readme: join(dir, 'README.md'),
    index: join(dir, 'INDEX.md'),
    notesKeep: join(dir, 'notes', '.gitkeep'),
    docsKeep: join(dir, 'docs', '.gitkeep'),
  };
}

async function writeIfMissing(path, contents) {
  try {
    await readFile(path, 'utf8');
    return { path, action: /** @type {'kept'} */ ('kept') };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
  return { path, action: /** @type {'created'} */ ('created') };
}

/**
 * Seed the four managed files under `rcf/knowledge/`. Any file already
 * present is left byte-identical (AC-2.2). If the whole tree is missing
 * on a re-run, all four are recreated (AC-2.3).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<{ writes: Array<{ file: string, action: 'created' | 'kept' }> }>}
 */
export async function writeKnowledgeSeed({ projectRoot }) {
  const paths = knowledgePaths(projectRoot);
  const results = [
    { file: 'rcf/knowledge/README.md', ...(await writeIfMissing(paths.readme, KNOWLEDGE_README)) },
    { file: 'rcf/knowledge/INDEX.md', ...(await writeIfMissing(paths.index, KNOWLEDGE_INDEX)) },
    { file: 'rcf/knowledge/notes/.gitkeep', ...(await writeIfMissing(paths.notesKeep, '')) },
    { file: 'rcf/knowledge/docs/.gitkeep', ...(await writeIfMissing(paths.docsKeep, '')) },
  ];
  return { writes: results.map((r) => ({ file: r.file, action: r.action })) };
}
