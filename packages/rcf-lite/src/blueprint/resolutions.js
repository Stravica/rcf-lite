// Blueprint conflict-resolution helpers.
//
// A resolution record (schema $defs/blueprintConflictResolution, added
// in @stravica-ai/rcf-schemas 0.4.5) captures an operator ruling that
// resolves a globalAdrTopic conflict: two applied blueprints each
// contributing a scope:global ADR on the same topic, resolved by a
// project-level ADR that supersedes both.
//
// This module owns:
//   - `nextResolutionId(manifest, now)`: monotonic `res-YYYY-MM-DD-NNN`
//     id-mint, mirroring the pattern used for pfc / boo / ic / rc ids
//     elsewhere in the tree.
//   - `matchingResolution(manifest, { topic, incoming, existing })`: the
//     lookup the conflict detector calls to see whether a would-be
//     globalAdrTopic conflict has already been resolved. Match rule:
//     kind = globalAdrTopic, topic matches, AND supersedes[] lists both
//     the incoming and the existing { slug, adrId } pairs. Superset OK
//     (a resolution recorded for three blueprints on the same topic still
//     resolves the two-blueprint conflict in front of us); subset not (a
//     resolution that only lists one of the two would leave the other's
//     ADR unaccounted for).
//
// Pure functions. No I/O, no wall clock beyond the `now` a caller hands
// in.

/**
 * Compute the next resolution id for today: monotonic
 * `res-YYYY-MM-DD-NNN`. Reads `manifest.resolutions[]` for the highest
 * NNN under today's date prefix and returns that + 1, zero-padded.
 *
 * @param {object|null} manifest
 * @param {Date} now
 * @returns {string}
 */
export function nextResolutionId(manifest, now) {
  const y = now.getUTCFullYear().toString().padStart(4, '0');
  const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = now.getUTCDate().toString().padStart(2, '0');
  const prefix = `res-${y}-${m}-${d}-`;
  const existing = Array.isArray(manifest?.resolutions) ? manifest.resolutions : [];
  let maxN = 0;
  for (const rec of existing) {
    if (typeof rec?.id !== 'string' || !rec.id.startsWith(prefix)) continue;
    const n = Number.parseInt(rec.id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `${prefix}${(maxN + 1).toString().padStart(3, '0')}`;
}

/**
 * Find a resolution on the manifest that resolves a specific
 * globalAdrTopic conflict pair. Returns the resolution record if a
 * match exists, `null` otherwise.
 *
 * A match requires:
 *   - `kind === 'globalAdrTopic'` on the resolution
 *   - `topic` matches
 *   - `supersedes[]` contains an entry matching the incoming
 *     `{ slug, adrId }` AND an entry matching the existing
 *     `{ slug, adrId }`
 *
 * The `adrId` comparison is exact. The `slug` comparison is exact. A
 * resolution that lists a superset of blueprints on the same topic still
 * resolves the pair-conflict in front of us (blueprint 3 landing later
 * on the same topic just needs to be listed too, which is a fresh
 * resolution write, not a re-resolve).
 *
 * @param {object|null} manifest
 * @param {{ topic: string, incoming: { slug: string, adrId: string }, existing: { slug: string, adrId: string } }} conflict
 * @returns {object|null}
 */
export function matchingResolution(manifest, { topic, incoming, existing }) {
  const list = Array.isArray(manifest?.resolutions) ? manifest.resolutions : [];
  for (const rec of list) {
    if (rec?.kind !== 'globalAdrTopic') continue;
    if (rec.topic !== topic) continue;
    const supers = Array.isArray(rec.supersedes) ? rec.supersedes : [];
    const hasIncoming = supers.some((s) => s?.slug === incoming.slug && s?.adrId === incoming.adrId);
    const hasExisting = supers.some((s) => s?.slug === existing.slug && s?.adrId === existing.adrId);
    if (hasIncoming && hasExisting) return rec;
  }
  return null;
}
