// Chain reader (spec §1, §5.2). Verify's ONLY structural input is the RCF
// chain — the acceptance contract. It reads the acceptance criteria off the
// chain through the SAME store code build-lite uses (core's walkTree), never
// the source tree, the test suite, or the builder's self-report (§9
// independence guarantee 2). It imports core's READ path only — never
// writer.js / init.js (§7.2 boundary).

import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';
import { walkTree } from '@stravica-ai/rcf-lite-core/store';

/**
 * Resolve a --repo path-or-ref to the project root that holds rcf/manifest.json.
 * v1 treats --repo as a filesystem path (path refs to remote sources are
 * deferred). Walks the given path and its ancestors, like build's finder.
 *
 * @param {string} startPath
 * @returns {Promise<string | null>}
 */
export async function findProjectRoot(startPath) {
  let dir = resolve(startPath);
  // Walk up until we find rcf/manifest.json or hit the filesystem root.
  // Bounded loop guard: dirname stabilises at the root.
  for (let i = 0; i < 64; i += 1) {
    try {
      await access(join(dir, 'rcf', 'manifest.json'));
      return dir;
    } catch {
      // not here — climb
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Read the acceptance contract from the chain. Returns the flattened list of
 * acceptance criteria (each mapped back to its user story + requirement — the
 * chain-node addressing the report carries), plus the resolved chainRef.
 *
 * @param {object} opts
 * @param {string} opts.repo - path-or-ref to the RCF chain source
 * @param {string} [opts.chainRef] - which PRD/chain; default = the repo's PRD
 * @returns {Promise<{ acs: Array<object>, chainRef: string, projectRoot: string } | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function readChain({ repo, chainRef } = {}) {
  if (typeof repo !== 'string' || repo.length === 0) {
    return rcfError({ kind: 'usage', message: '--repo (the RCF chain source) is required', field: 'repo' });
  }
  const projectRoot = await findProjectRoot(repo);
  if (!projectRoot) {
    return rcfError({
      kind: 'missingFile',
      message: `no RCF chain found at or above "${repo}" (no rcf/manifest.json). Verify needs an existing RCF chain as its acceptance contract.`,
      filePath: repo,
    });
  }

  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    // A chain that does not load is not verifiable — surface the first
    // structural error (errors-as-data; the CLI maps to a chain-load exit).
    return rcfError({
      kind: 'parseFailure',
      message: `RCF chain failed to load: ${errors[0].message}`,
      filePath: errors[0].filePath,
      documentId: errors[0].documentId,
    });
  }

  const resolvedRef = chainRef ?? tree.prd?.prdId ?? 'PRD-UNKNOWN';
  const acs = [];
  for (const us of tree.userStories ?? []) {
    for (const ac of us.acceptanceCriteria ?? []) {
      acs.push({
        acId: ac.id,
        usId: us.usId,
        reqId: us.reqId ?? null,
        title: us.title ?? null,
        description: ac.description ?? '',
        given: ac.given ?? '',
        when: ac.when ?? '',
        then: ac.then ?? '',
        testable: ac.testable !== false,
      });
    }
  }

  return { acs, chainRef: resolvedRef, projectRoot };
}
