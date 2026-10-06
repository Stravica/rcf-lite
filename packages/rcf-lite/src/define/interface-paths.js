// Shared define-time helper: resolve the `path:` tokens an engineer
// named on TAC interfaces against the project root on disk. The pure
// D3 `shapes:pathsResolve` check reads the resulting set from the
// stage context; this is the one place I/O happens for the check.
//
// Lifted out of `src/cli/readiness.js` in issue 302 (2026-10-06) so
// the freeze CLI can pre-resolve the same tokens and D3 agrees with
// readiness instead of false-failing from an empty fallback set.
// ADR-4131 (0.30.0 PR 5) still names readiness as the origin.

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { extractInterfacePathTokens } from '../query/gates.js';

/**
 * Walk the tree's TAC interfaces, extract the `path:` tokens the
 * engineer named, resolve each one against `projectRoot` on disk, and
 * return the set of tokens that resolve.
 *
 * @param {string} projectRoot
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Promise<Set<string>>}
 */
export async function resolveInterfacePaths(projectRoot, tree) {
  const resolved = new Set();
  /** @type {Set<string>} */
  const candidates = new Set();
  for (const tac of tree.tacs ?? []) {
    for (const iface of tac.interfaces ?? []) {
      const desc = typeof iface?.description === 'string' ? iface.description : '';
      for (const token of extractInterfacePathTokens(desc)) {
        candidates.add(token);
      }
    }
  }
  await Promise.all([...candidates].map(async (token) => {
    try {
      await stat(join(projectRoot, token));
      resolved.add(token);
    } catch {
      // Missing path stays out of the set; the gate decides whether
      // `authoredAt: D3` lets it through.
    }
  }));
  return resolved;
}
