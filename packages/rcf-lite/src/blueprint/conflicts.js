// Blueprint conflict detection at apply time.
//
// Two conflict classes:
//
//  - `globalAdrTopic`: two applied blueprints both contributing a
//    scope:global ADR on the same topic. The Phase 1 design brief
//    named this class explicitly.
//
//  - `crossBlueprintOwnership`: an incoming contribution declares an
//    id that another currently-applied blueprint already owns in its
//    manifest record. The manifest's appliedBlueprintRecord.contributions[]
//    list is the authoritative ownership record; two blueprints cannot
//    both claim the same id. This is the ambiguity-class check that
//    used to live inside `isNamespacedFor` grammar (blueprint `spa`
//    silently claiming `ADR-005-spa-theme` because the string
//    startsWith `spa-`). Grammar is no longer a trust surface here --
//    the manifest is.
//
// Every other class the design brief names (non-global TACs/ADRs/REQs/USs
// /FBSes, standards-value conflicts, manifest overlap) is either
// namespaced away or deferred to Phase 3 iteration per the design
// brief's prototype-unknown #1.
//
// Pure functions. Read the applied blueprints' contributions (as stored
// in `manifest.blueprints[]`) plus the incoming blueprint's contribution
// list, and return zero-or-more Conflict records. No I/O.

/**
 * @typedef {(
 *   { kind: 'globalAdrTopic',
 *     topic: string,
 *     incoming: { slug: string, id: string, path: string },
 *     existing: { slug: string, id: string, path: string } }
 *   |
 *   { kind: 'crossBlueprintOwnership',
 *     id: string,
 *     incoming: { slug: string, path: string },
 *     existing: { slug: string, path: string } }
 * )} Conflict
 */

/**
 * scope:global ADR topic conflicts across two applied blueprints.
 *
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
 * Cross-blueprint ownership conflicts: an incoming contribution id is
 * already recorded as owned by a DIFFERENT applied blueprint. This
 * detector is what makes `spa` vs `spa-theme` cross-claim impossible
 * once one of the two has applied -- the second-mover's incoming id
 * hits the first-mover's manifest record and is refused, regardless
 * of how the id string parses.
 *
 * Re-apply of the same slug (`applied.slug === incoming.slug`) is
 * skipped: same blueprint owning its own ids across re-apply is the
 * intended idempotent case.
 *
 * @param {Array<{
 *   slug: string,
 *   contributions?: Array<{ id: string, kind: string, path: string }>
 * }>} appliedBlueprints
 * @param {{
 *   slug: string,
 *   contributions?: Array<{ id: string, kind: string, path: string }>
 * }} incoming
 * @returns {Conflict[]}
 */
export function detectCrossBlueprintClaims(appliedBlueprints, incoming) {
  const conflicts = [];
  const incomingList = incoming.contributions ?? [];
  if (incomingList.length === 0) return conflicts;

  // Index applied contributions by id -> { slug, path } for a single-
  // pass scan. Skip the incoming blueprint's own previously-recorded
  // entries (that is the re-apply path, not a claim).
  const owned = new Map(); // id -> { slug, path }
  for (const applied of appliedBlueprints ?? []) {
    if (applied.slug === incoming.slug) continue;
    for (const c of applied.contributions ?? []) {
      if (!owned.has(c.id)) owned.set(c.id, { slug: applied.slug, path: c.path });
    }
  }
  if (owned.size === 0) return conflicts;

  for (const incomingC of incomingList) {
    const priorOwner = owned.get(incomingC.id);
    if (!priorOwner) continue;
    conflicts.push({
      kind: 'crossBlueprintOwnership',
      id: incomingC.id,
      incoming: { slug: incoming.slug, path: incomingC.path },
      existing: { slug: priorOwner.slug, path: priorOwner.path },
    });
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
  lines.push(`[rcf] blueprint add refused: ${conflicts.length} conflict(s) detected.`);
  lines.push('');
  for (const c of conflicts) {
    if (c.kind === 'globalAdrTopic') {
      lines.push(`conflict on topic "${c.topic}":`);
      lines.push(`  incoming: ADR ${c.incoming.id} (blueprint ${c.incoming.slug}) at ${c.incoming.path}`);
      lines.push(`  existing: ADR ${c.existing.id} (blueprint ${c.existing.slug}) at ${c.existing.path}`);
    } else if (c.kind === 'crossBlueprintOwnership') {
      lines.push(`conflict on id "${c.id}":`);
      lines.push(`  incoming: blueprint ${c.incoming.slug} declares ${c.id} at ${c.incoming.path}`);
      lines.push(`  existing: blueprint ${c.existing.slug} already owns ${c.id} at ${c.existing.path}`);
    }
  }
  lines.push('');
  lines.push('resolutions (pick one):');
  lines.push('  1. Keep the currently applied blueprint. Run `rcf blueprint remove <slug>` on the incoming side\'s slug if it is already partially in-flight, then leave things as they are.');
  lines.push('  2. Adopt the incoming blueprint instead: `rcf blueprint remove <existing-slug>` first, then re-run `rcf blueprint add` for the incoming source.');
  lines.push('  3. Author a project-level ADR that supersedes both, then re-run `rcf blueprint add` on the incoming source.');
  return `${lines.join('\n')}\n`;
}
