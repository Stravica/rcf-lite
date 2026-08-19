// Blueprint conflict detection at apply time.
//
// Phase 1 handles ONE conflict class in code: `scope: global` ADR
// contributions on the same topic across two applied blueprints. Every
// other class the design brief names (non-global TACs/ADRs/REQs/USs/FBSes,
// standards-value conflicts, manifest overlap) is either namespaced away
// or deferred to Phase 3 iteration per the design brief's
// prototype-unknown #1.
//
// Pure function. Reads the applied blueprints' contributions (as stored
// in `manifest.blueprints[]`) plus the incoming blueprint's contribution
// list, and returns zero-or-more Conflict records. No I/O.

/**
 * @typedef {object} Conflict
 * @property {'globalAdrTopic'} kind
 * @property {string} topic
 * @property {{ slug: string, id: string, path: string }} incoming
 * @property {{ slug: string, id: string, path: string }} existing
 */

/**
 * @param {Array<{
 *   slug: string,
 *   contributions?: Array<{ id: string, kind: string, path: string, scope?: string, topic?: string }>
 * }>} appliedBlueprints
 * @param {{
 *   slug: string,
 *   contributions?: Array<{ id: string, kind: string, path: string, scope?: string, topic?: string }>
 * }} incoming
 * @returns {Conflict[]}
 */
export function detectGlobalAdrConflicts(appliedBlueprints, incoming) {
  const conflicts = [];
  const incomingGlobals = (incoming.contributions ?? [])
    .filter((c) => c.kind === 'adr' && c.scope === 'global' && typeof c.topic === 'string');
  if (incomingGlobals.length === 0) return conflicts;

  for (const applied of appliedBlueprints ?? []) {
    if (applied.slug === incoming.slug) continue; // re-apply of the same blueprint is not a conflict
    for (const existing of applied.contributions ?? []) {
      if (existing.kind !== 'adr' || existing.scope !== 'global' || typeof existing.topic !== 'string') continue;
      for (const incomingAdr of incomingGlobals) {
        if (existing.topic === incomingAdr.topic) {
          conflicts.push({
            kind: 'globalAdrTopic',
            topic: existing.topic,
            incoming: { slug: incoming.slug, id: incomingAdr.id, path: incomingAdr.path },
            existing: { slug: applied.slug, id: existing.id, path: existing.path },
          });
        }
      }
    }
  }
  return conflicts;
}

/**
 * Render a conflict report for operator eyes. Names three resolution
 * paths per AC-1002-3.
 *
 * @param {Conflict[]} conflicts
 * @returns {string}
 */
export function renderConflictReport(conflicts) {
  if (conflicts.length === 0) return '';
  const lines = [];
  lines.push(`[rcf] blueprint add refused: ${conflicts.length} scope:global ADR conflict(s) detected.`);
  lines.push('');
  for (const c of conflicts) {
    lines.push(`conflict on topic "${c.topic}":`);
    lines.push(`  incoming: ADR ${c.incoming.id} (blueprint ${c.incoming.slug}) at ${c.incoming.path}`);
    lines.push(`  existing: ADR ${c.existing.id} (blueprint ${c.existing.slug}) at ${c.existing.path}`);
  }
  lines.push('');
  lines.push('resolutions (pick one):');
  lines.push('  1. Keep the currently applied blueprint. Run `rcf blueprint remove <slug>` on the incoming side\'s slug if it is already partially in-flight, then leave things as they are.');
  lines.push('  2. Adopt the incoming blueprint instead: `rcf blueprint remove <existing-slug>` first, then re-run `rcf blueprint add` for the incoming source.');
  lines.push('  3. Author a project-level ADR that supersedes both, then re-run `rcf blueprint add` on the incoming source.');
  return `${lines.join('\n')}\n`;
}
