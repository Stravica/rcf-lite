// Project-config external-library registry, at
// `rcf/blueprint-libraries.json`. Written and read only by the
// `rcf define blueprint library` verb family; the manifest walker does
// not touch it (per spec 4.1 rationale: adding a required cross-cutting
// section into `manifest.json` ripples through every downstream
// validator, so the registry sits as a discrete file next to the
// manifest, exactly like `rcf/.identity/` sits next to it).
//
// Phase 2b (this file) covers registry CRUD + band-overlap gates.
// Phase 2c layers the network fetchers on top and populates the
// `resolvedSha` / `tarballSha256` provenance fields; a `local` source
// bypasses both and carries a `local` provenance tag.
//
// Spec: external-blueprint-libraries-spec-2026-08-31.md sections 4, 7, 8.3.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rcfError } from '../core/errors/index.js';

export const REGISTRY_VERSION = 1;
export const REGISTRY_PATH = 'rcf/blueprint-libraries.json';

const here = dirname(fileURLToPath(import.meta.url));
// packages/rcf-lite/src/blueprint -> packages/rcf-lite -> data/
const CORE_BAND_RESERVATIONS_PATH = join(here, '..', '..', 'data', 'core-band-reservations.json');

/**
 * @typedef {object} RegistryEntry
 * @property {string} libraryPrefix
 * @property {'local' | 'git' | 'tarball'} sourceKind
 * @property {string} sourceRef
 * @property {string} [resolvedSha]
 * @property {string} displayName
 * @property {{ id: string, displayName: string, contact?: string }} publisher
 * @property {string} libraryRef
 * @property {{ ac: { start: number, end: number }, suffixBlocks?: Array<{ kind: string, start: number, end: number }> }} bands
 * @property {Array<{ slug: string, path: string }>} [blueprints]
 *   Snapshot of the library's `blueprints[]` at add-time. The resolver
 *   consults this to locate a blueprint by slug without re-reading
 *   `library.json` on every `blueprint add`. Absent snapshot falls back
 *   to the conventional `blueprints/<slug>/` layout (see shelf-resolver
 *   findBlueprintEntry).
 * @property {string} addedAt              RFC 3339
 * @property {'operator'} reviewedBy
 * @property {{ tier: 'local' | 'git' | 'tarball', shaVerifiedAt?: string, tarballSha256?: string }} provenance
 * @property {string} cachePath
 */

/**
 * @typedef {object} LibraryRegistry
 * @property {number} registryVersion
 * @property {RegistryEntry[]} libraries
 */

/**
 * Read the registry from a project. Absent file is not an error: a
 * project that has never added a library returns an empty registry.
 *
 * @param {string} projectRoot - absolute path
 * @returns {Promise<LibraryRegistry | import('../core/errors/index.js').RcfError>}
 */
export async function readLibraryRegistry(projectRoot) {
  const path = join(projectRoot, REGISTRY_PATH);
  if (!existsSync(path)) {
    return { registryVersion: REGISTRY_VERSION, libraries: [] };
  }
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `library registry: read failed: ${err.message}`, filePath: path });
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return rcfError({ kind: 'parseFailure', message: `library registry: JSON parse failed: ${err.message}`, filePath: path });
  }
  const err = validateRegistryShape(doc, path);
  if (err) return err;
  return doc;
}

/**
 * Persist a registry to disk. Overwrites the whole file (registry
 * writes are always full-file for legibility; the file is small).
 *
 * @param {string} projectRoot
 * @param {LibraryRegistry} registry
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ written: boolean, path: string } | import('../core/errors/index.js').RcfError>}
 */
export async function writeLibraryRegistry(projectRoot, registry, opts = {}) {
  const path = join(projectRoot, REGISTRY_PATH);
  const err = validateRegistryShape(registry, path);
  if (err) return err;
  if (opts.dryRun === true) return { written: false, path };
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  } catch (writeErr) {
    return rcfError({ kind: 'ioFailure', message: `library registry: write failed: ${writeErr.message}`, filePath: path });
  }
  return { written: true, path };
}

/**
 * @param {LibraryRegistry} registry
 * @param {string} libraryPrefix
 * @returns {RegistryEntry | undefined}
 */
export function findLibrary(registry, libraryPrefix) {
  if (!registry || !Array.isArray(registry.libraries)) return undefined;
  return registry.libraries.find((l) => l.libraryPrefix === libraryPrefix);
}

/**
 * Load the core-shelf band reservations shipped alongside rcf-lite.
 * Read-through with cache would be fine, but the file is tiny so we
 * re-read on demand; keeps tests hermetic against a stale singleton.
 *
 * @param {string} [dataFilePath] - override for tests
 * @returns {Promise<{ ac: Array<{ blueprint: string, start: number, end: number }>, suffixBlocks: Array<{ blueprint: string, kind: string, start: number, end: number }> }>}
 */
export async function loadCoreBandReservations(dataFilePath = CORE_BAND_RESERVATIONS_PATH) {
  try {
    const raw = await readFile(dataFilePath, 'utf8');
    const doc = JSON.parse(raw);
    return {
      ac: Array.isArray(doc.ac) ? doc.ac : [],
      suffixBlocks: Array.isArray(doc.suffixBlocks) ? doc.suffixBlocks : [],
    };
  } catch {
    return { ac: [], suffixBlocks: [] };
  }
}

/**
 * Add-time band-overlap gate. Refuses when the candidate library's
 * declared bands (`ac`, `suffixBlocks[]`) overlap either an
 * already-registered library or a core-shelf reservation.
 *
 * @param {object} args
 * @param {{ libraryPrefix: string, bands: { ac: { start: number, end: number }, suffixBlocks?: Array<{ kind: string, start: number, end: number }> } }} args.candidate
 * @param {LibraryRegistry} args.registry
 * @param {{ ac: Array<{ blueprint: string, start: number, end: number }>, suffixBlocks: Array<{ blueprint: string, kind: string, start: number, end: number }> }} args.coreReservations
 * @returns {null | import('../core/errors/index.js').RcfError}
 */
export function detectBandOverlap({ candidate, registry, coreReservations }) {
  // AC band: check against every registered library and every core row.
  const cand = candidate.bands.ac;
  for (const reg of registry.libraries) {
    if (reg.libraryPrefix === candidate.libraryPrefix) continue;
    if (rangesOverlap(cand, reg.bands.ac)) {
      return rcfError({
        kind: 'usage',
        message: `AC band ${cand.start}-${cand.end} overlaps registered library '${reg.libraryPrefix}' (${reg.bands.ac.start}-${reg.bands.ac.end}).`,
      });
    }
  }
  for (const core of coreReservations.ac) {
    if (rangesOverlap(cand, core)) {
      return rcfError({
        kind: 'usage',
        message: `AC band ${cand.start}-${cand.end} overlaps core-shelf blueprint '${core.blueprint}' (${core.start}-${core.end}).`,
      });
    }
  }
  // Suffix blocks: per-kind overlap.
  const suffixBlocks = candidate.bands.suffixBlocks ?? [];
  for (const block of suffixBlocks) {
    for (const reg of registry.libraries) {
      if (reg.libraryPrefix === candidate.libraryPrefix) continue;
      for (const other of reg.bands.suffixBlocks ?? []) {
        if (other.kind === block.kind && rangesOverlap(block, other)) {
          return rcfError({
            kind: 'usage',
            message: `suffix block ${block.kind} ${block.start}-${block.end} overlaps registered library '${reg.libraryPrefix}' (${other.start}-${other.end}).`,
          });
        }
      }
    }
    for (const core of coreReservations.suffixBlocks) {
      if (core.kind === block.kind && rangesOverlap(block, core)) {
        return rcfError({
          kind: 'usage',
          message: `suffix block ${block.kind} ${block.start}-${block.end} overlaps core-shelf blueprint '${core.blueprint}' (${core.start}-${core.end}).`,
        });
      }
    }
  }
  return null;
}

/**
 * Apply-time band gate (spec section 8.3 + open question 9.9 ratified
 * as "add both"). Every contribution id whose numeric portion falls
 * outside the library's declared band is refused, so a library that
 * grew a blueprint outside its declared band (that its own CI should
 * have caught but did not) refuses at the consuming project's `blueprint
 * add`.
 *
 * @param {Array<{ id: string, kind: string }>} stampedContributions
 * @param {{ ac: { start: number, end: number }, suffixBlocks?: Array<{ kind: string, start: number, end: number }> }} bands
 * @returns {null | import('../core/errors/index.js').RcfError}
 */
export function detectContributionsOutOfBand(stampedContributions, bands) {
  for (const c of stampedContributions) {
    const parts = extractNumericPart(c.id);
    if (!parts) continue;
    if (c.kind === 'req' || c.kind === 'us' || c.kind === 'ts') {
      if (!inRange(parts.number, bands.ac)) {
        return rcfError({
          kind: 'usage',
          message: `contribution ${c.id} (${c.kind}) numeric ${parts.number} falls outside library AC band ${bands.ac.start}-${bands.ac.end}.`,
        });
      }
    } else if (c.kind === 'adr' || c.kind === 'tac') {
      const blocks = (bands.suffixBlocks ?? []).filter((b) => b.kind === c.kind);
      if (blocks.length === 0) continue; // no block declared for this kind
      const hit = blocks.some((b) => inRange(parts.number, b));
      if (!hit) {
        const desc = blocks.map((b) => `${b.start}-${b.end}`).join(', ');
        return rcfError({
          kind: 'usage',
          message: `contribution ${c.id} (${c.kind}) numeric ${parts.number} falls outside library ${c.kind} suffix block(s) ${desc}.`,
        }); // library-facing prefix is added by the CLI edge
      }
    }
  }
  return null;
}

/**
 * Prefix-collision gate for `library add` (spec section 5.1). Refuses
 * when the candidate `libraryPrefix` collides with a core-shelf
 * blueprint slug or with any already-registered library's prefix.
 *
 * @param {object} args
 * @param {string} args.libraryPrefix
 * @param {LibraryRegistry} args.registry
 * @param {string[]} args.coreSlugs
 * @returns {null | import('../core/errors/index.js').RcfError}
 */
export function detectPrefixCollision({ libraryPrefix, registry, coreSlugs }) {
  if (libraryPrefix.includes(':') || libraryPrefix.includes('/')) {
    return rcfError({ kind: 'usage', message: `library add: libraryPrefix '${libraryPrefix}' must not contain ':' or '/'.` });
  }
  for (const slug of coreSlugs) {
    if (slug === libraryPrefix) {
      return rcfError({ kind: 'usage', message: `library add: libraryPrefix '${libraryPrefix}' collides with core-shelf blueprint slug '${slug}'.` });
    }
    if (slug.startsWith(`${libraryPrefix}-`)) {
      return rcfError({
        kind: 'usage',
        message: `libraryPrefix '${libraryPrefix}' is a boundary-swallowing substring prefix of core-shelf blueprint slug '${slug}'; choose a prefix that does not read as the leading segment of an existing slug.`,
      });
    }
  }
  for (const reg of registry.libraries) {
    if (reg.libraryPrefix === libraryPrefix) {
      return rcfError({ kind: 'usage', message: `library add: libraryPrefix '${libraryPrefix}' is already registered.` });
    }
  }
  return null;
}

/**
 * Extract the leading numeric block from an id like `wsd-auth-oauth2-REQ-1101`
 * or `ADR-1300-deploy-cloudflare-workers`. Returns `{ number }` or null.
 * We do NOT reimplement the id grammar here; the numeric portion of
 * either family shape is unambiguous: the run of digits between two
 * hyphens or between a hyphen and the string end.
 */
function extractNumericPart(id) {
  const m = /-(\d+)(?:-|$)/.exec(id);
  if (!m) return null;
  return { number: Number(m[1]) };
}

function inRange(n, range) {
  return n >= range.start && n <= range.end;
}

function rangesOverlap(a, b) {
  return !(a.end < b.start || b.end < a.start);
}

function validateRegistryShape(doc, path) {
  if (typeof doc !== 'object' || doc === null) {
    return rcfError({ kind: 'validation', message: 'library registry: must be a JSON object', filePath: path });
  }
  if (!Number.isInteger(doc.registryVersion) || doc.registryVersion < 1) {
    return rcfError({ kind: 'validation', message: `library registry: registryVersion must be a positive integer, got ${JSON.stringify(doc.registryVersion)}`, filePath: path });
  }
  if (doc.registryVersion > REGISTRY_VERSION) {
    return rcfError({ kind: 'validation', message: `library registry: registryVersion ${doc.registryVersion} is newer than this CLI understands (max ${REGISTRY_VERSION}); upgrade rcf-lite.`, filePath: path });
  }
  if (!Array.isArray(doc.libraries)) {
    return rcfError({ kind: 'validation', message: 'library registry: libraries[] is required (may be empty)', filePath: path });
  }
  const seen = new Set();
  for (const [i, entry] of doc.libraries.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}] must be an object`, filePath: path });
    }
    if (typeof entry.libraryPrefix !== 'string') {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}].libraryPrefix is required`, filePath: path });
    }
    if (seen.has(entry.libraryPrefix)) {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}].libraryPrefix '${entry.libraryPrefix}' is declared more than once`, filePath: path });
    }
    seen.add(entry.libraryPrefix);
    if (!['local', 'git', 'tarball'].includes(entry.sourceKind)) {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}].sourceKind '${entry.sourceKind}' must be one of local|git|tarball`, filePath: path });
    }
    if (typeof entry.sourceRef !== 'string' || entry.sourceRef.length === 0) {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}].sourceRef is required`, filePath: path });
    }
    if (typeof entry.cachePath !== 'string' || entry.cachePath.length === 0) {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}].cachePath is required`, filePath: path });
    }
    if (typeof entry.bands !== 'object' || entry.bands === null || typeof entry.bands.ac !== 'object' || entry.bands.ac === null) {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}].bands.ac is required`, filePath: path });
    }
    if (typeof entry.provenance !== 'object' || entry.provenance === null || !['local', 'git', 'tarball'].includes(entry.provenance.tier)) {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}].provenance.tier is required (local|git|tarball)`, filePath: path });
    }
    if (entry.provenance.tier !== 'local' && !entry.provenance.shaVerifiedAt) {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}].provenance.shaVerifiedAt is required when tier is '${entry.provenance.tier}'`, filePath: path });
    }
    if (entry.sourceKind === 'local' && entry.resolvedSha !== undefined) {
      return rcfError({ kind: 'validation', message: `library registry: libraries[${i}] sourceKind=local must not carry a resolvedSha`, filePath: path });
    }
  }
  return null;
}
