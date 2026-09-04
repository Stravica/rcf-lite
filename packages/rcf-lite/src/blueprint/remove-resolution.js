// `rcf define blueprint remove-resolution <adr-id>` implementation.
//
// Removes a single entry from `manifest.resolutions[]` (and NOTHING
// else). The `<adr-id>` argument is matched against the entry's
// `resolvedByAdrId` field, which is how the doctor's probe-path-owner
// check (spec section 9) and the four-path resolution card (spec
// section 4) name the resolution to the operator.
//
// Behaviours (spec amendment A2, ratified 2026-09-04):
//   - Removes the resolutions[] entry whose `resolvedByAdrId` equals
//     the argument; leaves every other manifest section untouched. The
//     project-level ADR file at `rcf/adrs/<adr-id>.json` is NOT
//     deleted: an operator who wants to keep the ruling ADR as
//     historical context after the redundant resolution goes away has
//     that path open; an operator who wants the ADR gone can rm it
//     themselves.
//   - Refuses exit 2 when the argument is not a resolution entry on
//     this manifest. Two flavours count as "not a resolution entry":
//     the id is malformed (fails the ADR-\d{3,}(-<kebab-tail>)? grammar),
//     or the id is well-formed but names no ADR anywhere on the
//     tree AND is not present under any resolutions[] entry.
//   - Idempotent on a second run: when the id is a well-formed ADR
//     id that names an ADR present on the tree (the ruling ADR that
//     the resolution had pointed at) but is not (any longer) present
//     under any resolutions[] entry, the module returns
//     `{ removed: false, alreadyAbsent: true }` and the CLI edge
//     prints "nothing to remove" and exits 0. The distinction is:
//     the ruling ADR still exists on disk, so the operator is running
//     the SAME operation a second time, not typing a bogus id.
//
// The verb never touches project ADR files, blueprint records, or any
// other manifest section. That keeps the scope narrow enough that the
// operator can reason about the write without reading the module.

import { isRcfError, rcfError } from '../core/errors/index.js';
import { updateManifest } from './manifest-writer.js';

const ADR_ID_PATTERN = /^ADR-\d{3,}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

/**
 * @typedef {object} RemoveResolutionResult
 * @property {boolean} removed
 * @property {boolean} [alreadyAbsent]
 * @property {string}  resolvedByAdrId
 * @property {string}  [resolutionId]
 * @property {string}  [topic]
 */

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.resolvedByAdrId
 * @param {boolean} [args.dryRun]
 * @returns {Promise<RemoveResolutionResult | import('../core/errors/index.js').RcfError>}
 */
export async function removeResolution({ projectRoot, tree, resolvedByAdrId, dryRun = false }) {
  if (typeof resolvedByAdrId !== 'string' || resolvedByAdrId.trim().length === 0) {
    return rcfError({ kind: 'usage', message: `<adr-id> is required (e.g. rcf define blueprint remove-resolution ADR-011-health-probes).` });
  }
  if (!ADR_ID_PATTERN.test(resolvedByAdrId)) {
    return rcfError({ kind: 'usage', message: `'${resolvedByAdrId}' is not a well-formed ADR id (grammar: ADR-\\d{3,}(-<kebab-tail>)?).` });
  }
  const manifest = tree.manifest ?? {};
  const resolutions = Array.isArray(manifest.resolutions) ? manifest.resolutions : [];
  const index = resolutions.findIndex((r) => r?.resolvedByAdrId === resolvedByAdrId);
  if (index === -1) {
    // Not on resolutions[]. Two branches:
    //   - the ruling ADR file exists on the tree: idempotent no-op
    //     (this is a re-run of the same operation).
    //   - no ADR by that id anywhere: refuse. The operator has typed
    //     an id that this project has no record of, either as a
    //     resolution entry or as a project ADR.
    const adrPresent = tree.byId instanceof Map && tree.byId.has(resolvedByAdrId);
    if (adrPresent) {
      return { removed: false, alreadyAbsent: true, resolvedByAdrId };
    }
    return rcfError({
      kind: 'usage',
      message: `'${resolvedByAdrId}' is not a resolution entry on this manifest (no resolutions[] record names it as resolvedByAdrId, and no ADR by that id exists on the project tree).`,
    });
  }
  const target = resolutions[index];
  const result = await updateManifest({
    projectRoot,
    manifest,
    mutate: (next) => {
      const list = Array.isArray(next.resolutions) ? next.resolutions : [];
      list.splice(index, 1);
      // Drop the field entirely when empty so the manifest shape stays
      // as compact as it was before any resolution was ever recorded.
      if (list.length === 0) delete next.resolutions;
      else next.resolutions = list;
    },
    dryRun,
  });
  if (isRcfError(result)) return result;
  return {
    removed: true,
    resolvedByAdrId,
    resolutionId: typeof target?.id === 'string' ? target.id : undefined,
    topic: typeof target?.topic === 'string' ? target.topic : undefined,
  };
}
