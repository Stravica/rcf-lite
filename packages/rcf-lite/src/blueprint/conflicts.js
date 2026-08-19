// Blueprint conflict detection at apply time.
//
// Two conflict classes:
//
//  - `globalAdrTopic`: two applied blueprints both contributing a
//    scope:global ADR on the same topic. The Phase 1 design brief
//    named this class explicitly. From 0.4.5 the detector consults
//    `manifest.resolutions[]` and skips a would-be conflict when a
//    resolution matches the topic + both {slug, adrId} pairs; the two
//    blueprint ADRs then co-reside on disk as superseded history
//    alongside the project-level ADR that supersedes them.
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

import { matchingResolution } from './resolutions.js';

/**
 * @typedef {(
 *   { kind: 'globalAdrTopic',
 *     topic: string,
 *     incoming: { slug: string, id: string, path: string, title?: string, decision?: string },
 *     existing: { slug: string, id: string, path: string, title?: string, decision?: string } }
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
 * Optional `manifest` argument: when supplied and the manifest carries a
 * matching entry in `manifest.resolutions[]`, the conflict is honoured
 * (dropped from the returned list). Callers that want the raw shape
 * (`rcf blueprint diff <topic>` needs to inspect both ADRs even when a
 * resolution exists) can pass `manifest: null` to bypass the honour step.
 *
 * @param {Array<{
 *   slug: string,
 *   contributions?: Array<{ id: string, kind: string, path: string, scope?: string, topic?: string }>
 * }>} appliedBlueprints
 * @param {{
 *   slug: string,
 *   contributions?: Array<{ id: string, kind: string, path: string, scope?: string, topic?: string }>
 * }} incoming
 * @param {object|null} [manifest] - optional manifest for resolutions[] lookup
 * @returns {Conflict[]}
 */
export function detectGlobalAdrConflicts(appliedBlueprints, incoming, manifest = null) {
  const conflicts = [];
  const incomingGlobals = (incoming.contributions ?? [])
    .filter((c) => c.kind === 'adr' && c.scope === 'global' && typeof c.topic === 'string');
  if (incomingGlobals.length === 0) return conflicts;

  for (const applied of appliedBlueprints ?? []) {
    if (applied.slug === incoming.slug) continue; // re-apply of the same blueprint is not a conflict
    for (const existing of applied.contributions ?? []) {
      if (existing.kind !== 'adr' || existing.scope !== 'global' || typeof existing.topic !== 'string') continue;
      for (const incomingAdr of incomingGlobals) {
        if (existing.topic !== incomingAdr.topic) continue;
        // Honour a matching resolution if the caller passed a manifest.
        // The resolution list is small (one entry per resolved topic
        // per project) so the linear scan inside matchingResolution is
        // fine at this scale.
        if (manifest !== null) {
          const resolved = matchingResolution(manifest, {
            topic: existing.topic,
            incoming: { slug: incoming.slug, adrId: incomingAdr.id },
            existing: { slug: applied.slug, adrId: existing.id },
          });
          if (resolved) continue;
        }
        conflicts.push({
          kind: 'globalAdrTopic',
          topic: existing.topic,
          incoming: { slug: incoming.slug, id: incomingAdr.id, path: incomingAdr.path },
          existing: { slug: applied.slug, id: existing.id, path: existing.path },
        });
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
 * Render a conflict report for operator eyes. Reshaped in 0.4.5:
 *
 *   - Per-conflict block LEADS with the ADR titles and a one-sentence
 *     decision each (topic string in parens), ids and paths as a
 *     footer. If titles / decisions are not available (the detector
 *     was not given tree access), the block falls back to the id +
 *     path pair as the header.
 *   - Resolution list carries only implemented options with actual
 *     blueprint slugs filled in (no more placeholder `<slug>` prose).
 *     A follow-up superset-add reintroduces the conflict; the operator
 *     is not offered rename ceremonies for that.
 *
 * The old three-line resolutions blurb ("run `rcf blueprint remove
 * <slug>` on the incoming side's slug if it is already partially in-
 * flight, then leave things as they are") is gone -- neither `<slug>`
 * placeholder was actually implementable end-to-end, and the operator
 * has been reading past it since Phase 1.
 *
 * @param {Conflict[]} conflicts
 * @returns {string}
 */
export function renderConflictReport(conflicts) {
  if (conflicts.length === 0) return '';
  const lines = [];
  lines.push(`[rcf] blueprint add refused: ${conflicts.length} conflict(s) detected.`);
  lines.push('');
  for (let i = 0; i < conflicts.length; i += 1) {
    const c = conflicts[i];
    if (i > 0) lines.push('');
    if (c.kind === 'globalAdrTopic') {
      // Header: title + decision when available, id + path otherwise.
      const incomingHeader = renderAdrHeader(c.incoming);
      const existingHeader = renderAdrHeader(c.existing);
      lines.push(`conflict on topic (${c.topic}):`);
      lines.push(`  incoming  blueprint ${c.incoming.slug}: ${incomingHeader}`);
      lines.push(`  existing  blueprint ${c.existing.slug}: ${existingHeader}`);
      lines.push(`  refs:     ${c.incoming.id} at ${c.incoming.path}`);
      lines.push(`            ${c.existing.id} at ${c.existing.path}`);
      lines.push('');
      lines.push('  resolutions (pick one, honest options only):');
      lines.push(`    1. Adopt the incoming blueprint. Run:`);
      lines.push(`         rcf blueprint remove ${c.existing.slug}`);
      lines.push(`       then re-run the incoming add.`);
      lines.push(`    2. Keep the existing blueprint. Do not add ${c.incoming.slug} on this project.`);
      lines.push(`    3. Author a project-level ADR that supersedes both. Run:`);
      lines.push(`         rcf blueprint supersede ${c.topic}`);
      lines.push(`       which scaffolds the project ADR (both blueprint ADRs listed as superseded)`);
      lines.push(`       and registers the resolution in the manifest, then re-run the incoming add.`);
      lines.push(`    4. Declare the resolution on the add itself:`);
      lines.push(`         rcf blueprint add <source> --resolve ${c.topic}=project:<ADR-id>`);
      lines.push(`       which records the resolution and skips the remove/re-add ceremony.`);
    } else if (c.kind === 'crossBlueprintOwnership') {
      lines.push(`conflict on id ${c.id}:`);
      lines.push(`  incoming  blueprint ${c.incoming.slug} declares ${c.id} at ${c.incoming.path}`);
      lines.push(`  existing  blueprint ${c.existing.slug} already owns ${c.id} at ${c.existing.path}`);
      lines.push('');
      lines.push('  resolutions (pick one, honest options only):');
      lines.push(`    1. Adopt the incoming blueprint. Run:`);
      lines.push(`         rcf blueprint remove ${c.existing.slug}`);
      lines.push(`       then re-run the incoming add.`);
      lines.push(`    2. Keep the existing blueprint. Do not add ${c.incoming.slug} on this project.`);
      lines.push(`    3. Fix the incoming blueprint's contribution ids (author-side change);`);
      lines.push(`       cross-blueprint id claims cannot be resolved by a manifest ruling.`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

/**
 * Render a conflict report as a JSON object for agent-driven
 * composition. Shape:
 *
 * ```
 * {
 *   "refused": true,
 *   "conflictCount": N,
 *   "conflicts": [
 *     { kind: 'globalAdrTopic', topic, incoming: {slug,id,path,title?,decision?}, existing: {...}, resolutions: [...] },
 *     { kind: 'crossBlueprintOwnership', id, incoming, existing, resolutions: [...] }
 *   ]
 * }
 * ```
 *
 * The resolutions list on each conflict is the machine-readable
 * counterpart to the prose in renderConflictReport: `{ id, description,
 * commands }` triples, no placeholders.
 *
 * @param {Conflict[]} conflicts
 * @returns {object}
 */
export function conflictReportJson(conflicts) {
  return {
    refused: conflicts.length > 0,
    conflictCount: conflicts.length,
    conflicts: conflicts.map((c) => {
      if (c.kind === 'globalAdrTopic') {
        return {
          kind: c.kind,
          topic: c.topic,
          incoming: pruneAdrRef(c.incoming),
          existing: pruneAdrRef(c.existing),
          resolutions: [
            {
              id: 'adoptIncoming',
              description: `Adopt the incoming blueprint (${c.incoming.slug}); remove the existing (${c.existing.slug}).`,
              commands: [`rcf blueprint remove ${c.existing.slug}`],
            },
            {
              id: 'keepExisting',
              description: `Keep the existing blueprint (${c.existing.slug}); do not add ${c.incoming.slug}.`,
              commands: [],
            },
            {
              id: 'supersede',
              description: `Author a project-level ADR that supersedes both blueprint ADRs on topic '${c.topic}'.`,
              commands: [`rcf blueprint supersede ${c.topic}`],
            },
            {
              id: 'declareOnAdd',
              description: `Declare the resolution on the incoming add itself.`,
              commands: [`rcf blueprint add <source> --resolve ${c.topic}=project:<ADR-id>`],
            },
          ],
        };
      }
      // crossBlueprintOwnership
      return {
        kind: c.kind,
        id: c.id,
        incoming: c.incoming,
        existing: c.existing,
        resolutions: [
          {
            id: 'adoptIncoming',
            description: `Adopt the incoming blueprint (${c.incoming.slug}); remove the existing (${c.existing.slug}).`,
            commands: [`rcf blueprint remove ${c.existing.slug}`],
          },
          {
            id: 'keepExisting',
            description: `Keep the existing blueprint (${c.existing.slug}); do not add ${c.incoming.slug}.`,
            commands: [],
          },
          {
            id: 'fixIncomingIds',
            description: `Fix the incoming blueprint's contribution ids at authoring; cross-blueprint id claims cannot be resolved by a manifest ruling.`,
            commands: [],
          },
        ],
      };
    }),
  };
}

function renderAdrHeader(side) {
  if (typeof side.title === 'string' && side.title.length > 0) {
    if (typeof side.decision === 'string' && side.decision.length > 0) {
      return `${side.title} — ${side.decision}`;
    }
    return side.title;
  }
  return `${side.id} at ${side.path}`;
}

function pruneAdrRef(side) {
  const out = { slug: side.slug, id: side.id, path: side.path };
  if (typeof side.title === 'string' && side.title.length > 0) out.title = side.title;
  if (typeof side.decision === 'string' && side.decision.length > 0) out.decision = side.decision;
  return out;
}
