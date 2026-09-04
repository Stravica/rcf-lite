// Companion-suggestion mechanism (core-companions spec 2026-09-04
// sections 2 and 4). Additive on top of the loader, apply, CLI and
// validate surfaces. Two data shapes it owns end to end:
//
//   1. Resolution: given a service blueprint's `suggestedCompanions[]`,
//      walk the deterministic tier ladder (applied provider >
//      registered library > core shelf, with rcf/companions.json
//      pin overriding the last two) and return an ordered result per
//      role.
//
//   2. Pin file: rcf/companions.json with { schemaVersion: 1, roles:
//      { <role>: { provider, pinnedAt } } }. Written and read only
//      through this module; validate consults it via `resolvePin`.
//
// The mechanism is suggestion, never compulsion (spec 2.6): no code
// path here calls applyBlueprint. Reads only, plus the pin file write
// path invoked from the CLI verb and from the apply --companion flag.

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '../core/errors/index.js';
import { loadBlueprint } from './loader.js';
import { readLibraryRegistry } from './library-registry.js';
import { packagedShelfPath } from './shelf-resolver.js';

export const COMPANIONS_PATH = 'rcf/companions.json';
export const COMPANIONS_SCHEMA_VERSION = 1;

/**
 * @typedef {object} CompanionsPinFile
 * @property {number} schemaVersion
 * @property {Object<string, { provider: string, pinnedAt: string }>} roles
 */

/**
 * @typedef {object} ResolvedCompanion
 * @property {string} role           lower camelCase role name
 * @property {string} reason         verbatim from the service blueprint's suggestedCompanions[]
 * @property {string|null} provider  library-qualified slug ("wsd:logging"),
 *                                   bare shelf slug ("observability-logging"),
 *                                   applied slug, or null when unresolved
 * @property {'appliedProvider'|'pinnedLibrary'|'pinnedShelf'|'registeredLibrary'|'shelfFallback'|'ambiguousLibraries'|'unresolved'} origin
 * @property {string} [notes]        human-readable annotation for the render
 * @property {string[]} [ambiguousProviders] present only when origin='ambiguousLibraries'
 */

/**
 * Read the pin file if present. Absent file returns null (no pin
 * state exists yet). Malformed file returns an rcfError.
 *
 * @param {string} projectRoot
 * @returns {Promise<CompanionsPinFile|null|import('../core/errors/index.js').RcfError>}
 */
export async function readCompanionsFile(projectRoot) {
  const path = join(projectRoot, COMPANIONS_PATH);
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `companions.json: read failed: ${err.message}`, filePath: path });
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return rcfError({ kind: 'parseFailure', message: `companions.json: JSON parse failed: ${err.message}`, filePath: path });
  }
  const err = validateCompanionsFile(doc, path);
  if (err) return err;
  return doc;
}

/**
 * Validate the pin file shape. Returns null clean or an rcfError.
 */
export function validateCompanionsFile(doc, filePath) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return rcfError({ kind: 'validation', message: 'companions.json must be a JSON object', filePath });
  }
  if (doc.schemaVersion !== COMPANIONS_SCHEMA_VERSION) {
    return rcfError({
      kind: 'validation',
      message: `companions.json: schemaVersion must be ${COMPANIONS_SCHEMA_VERSION} (got ${JSON.stringify(doc.schemaVersion)})`,
      filePath,
    });
  }
  if (typeof doc.roles !== 'object' || doc.roles === null || Array.isArray(doc.roles)) {
    return rcfError({ kind: 'validation', message: 'companions.json: roles must be an object', filePath });
  }
  for (const [role, entry] of Object.entries(doc.roles)) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(role)) {
      return rcfError({
        kind: 'validation',
        message: `companions.json: role name '${role}' is not lower camelCase (^[a-z][a-zA-Z0-9]*$).`,
        filePath,
      });
    }
    if (typeof entry !== 'object' || entry === null) {
      return rcfError({ kind: 'validation', message: `companions.json: roles.${role} must be an object with provider and pinnedAt`, filePath });
    }
    if (typeof entry.provider !== 'string' || entry.provider.length === 0) {
      return rcfError({ kind: 'validation', message: `companions.json: roles.${role}.provider must be a non-empty string`, filePath });
    }
    if (typeof entry.pinnedAt !== 'string' || entry.pinnedAt.length === 0) {
      return rcfError({ kind: 'validation', message: `companions.json: roles.${role}.pinnedAt must be a non-empty ISO-8601 string`, filePath });
    }
  }
  return null;
}

/**
 * Write a pin to the file, creating it lazily. Overwrites an existing
 * pin for the same role. Returns { written, previousProvider, path }.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.role
 * @param {string} args.provider
 * @param {Date} [args.now]
 * @param {boolean} [args.dryRun]
 * @returns {Promise<{ written: boolean, previousProvider: string|null, path: string } | import('../core/errors/index.js').RcfError>}
 */
export async function setCompanionPin({ projectRoot, role, provider, now = new Date(), dryRun = false }) {
  if (typeof role !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(role)) {
    return rcfError({ kind: 'usage', message: `companions set: role '${role}' is not lower camelCase (^[a-z][a-zA-Z0-9]*$).` });
  }
  if (typeof provider !== 'string' || provider.length === 0) {
    return rcfError({ kind: 'usage', message: `companions set: provider slug must be a non-empty string.` });
  }
  const existing = await readCompanionsFile(projectRoot);
  if (existing && existing.kind) return existing;
  const doc = existing ?? { schemaVersion: COMPANIONS_SCHEMA_VERSION, roles: {} };
  const previousProvider = doc.roles?.[role]?.provider ?? null;
  doc.roles[role] = { provider, pinnedAt: now.toISOString() };
  const path = join(projectRoot, COMPANIONS_PATH);
  if (dryRun) return { written: false, previousProvider, path };
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `companions.json: write failed: ${err.message}`, filePath: path });
  }
  return { written: true, previousProvider, path };
}

/**
 * Remove a pin. Returns { removed, path }. Refuses when no pin exists
 * for the role (usage error, exit 2). Leaves the rest of the file
 * intact; removes the file when the last pin is gone.
 */
export async function unsetCompanionPin({ projectRoot, role, dryRun = false }) {
  if (typeof role !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(role)) {
    return rcfError({ kind: 'usage', message: `companions unset: role '${role}' is not lower camelCase (^[a-z][a-zA-Z0-9]*$).` });
  }
  const existing = await readCompanionsFile(projectRoot);
  if (existing && existing.kind) return existing;
  if (!existing || !Object.prototype.hasOwnProperty.call(existing.roles ?? {}, role)) {
    return rcfError({ kind: 'usage', message: `companions unset: no pin for role '${role}' on this project.` });
  }
  const path = join(projectRoot, COMPANIONS_PATH);
  delete existing.roles[role];
  if (dryRun) return { removed: true, path };
  try {
    if (Object.keys(existing.roles).length === 0) {
      await unlink(path).catch(() => {});
    } else {
      await writeFile(path, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
    }
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `companions.json: write failed: ${err.message}`, filePath: path });
  }
  return { removed: true, path };
}

/**
 * Enumerate the packaged shelf providers for a role. Reads every
 * blueprint.json under the shelf and returns the slugs whose
 * providesRoles[] contains the role.
 *
 * @param {string} role
 * @param {string} [shelfDir]
 * @returns {Promise<string[]>}
 */
export async function enumerateShelfProviders(role, shelfDir = packagedShelfPath()) {
  const providers = [];
  let entries;
  try {
    entries = await readdir(shelfDir, { withFileTypes: true });
  } catch {
    return providers;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const bp = await loadBlueprint(join(shelfDir, e.name));
    if (bp.kind) continue;
    if (Array.isArray(bp.providesRoles) && bp.providesRoles.includes(role)) {
      providers.push(bp.slug);
    }
  }
  return providers.sort();
}

/**
 * Enumerate the registered libraries' providers for a role. Reads the
 * project's registry, then each library's blueprints[] entries, and
 * returns entries { libraryPrefix, slug } where the referenced
 * blueprint declares providesRoles[] containing the role.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<Array<{libraryPrefix: string, slug: string, source: string}>>}
 */
export async function enumerateLibraryProviders({ projectRoot, role }) {
  const registry = await readLibraryRegistry(projectRoot);
  if (registry.kind) return [];
  const out = [];
  for (const lib of registry.libraries ?? []) {
    for (const entry of lib.blueprints ?? []) {
      const bpPath = join(lib.cachePath, entry.path);
      const bp = await loadBlueprint(bpPath);
      if (bp.kind) continue;
      if (Array.isArray(bp.providesRoles) && bp.providesRoles.includes(role)) {
        out.push({ libraryPrefix: lib.libraryPrefix, slug: entry.slug, source: bpPath });
      }
    }
  }
  return out;
}

/**
 * Enumerate applied providers for a role from the walker tree. Reads
 * each applied blueprint's SOURCE blueprint.json to consult its
 * providesRoles[] (the applied manifest record does not carry it, per
 * spec section 2 "not on the applied record"). A source that no longer
 * resolves is skipped silently; the resolver falls through to the
 * library / shelf tiers.
 */
export async function enumerateAppliedProviders({ tree, role }) {
  const applied = tree?.manifest?.blueprints ?? [];
  const out = [];
  for (const bp of applied) {
    if (typeof bp.source !== 'string' || bp.source.length === 0) continue;
    // Library-qualified sources (wsd:auth-oauth2) resolve through the
    // library cache; skipping them here is fine because the library
    // enumeration also covers them (a library-applied provider is
    // catchable in the applied tier only when a manual reader passes
    // an absolute path). The safest fallback: try to loadBlueprint at
    // the source as an absolute path.
    if (bp.source.includes(':') && !bp.source.startsWith('/')) continue;
    const src = bp.source;
    // eslint-disable-next-line no-await-in-loop
    const b = await loadBlueprint(src);
    if (b.kind) continue;
    if (Array.isArray(b.providesRoles) && b.providesRoles.includes(role)) {
      out.push({ slug: bp.slug, source: src });
    }
  }
  return out;
}

/**
 * Resolve one role through the deterministic tier ladder (spec 2.3).
 * Returns a ResolvedCompanion.
 *
 * The pin (rcf/companions.json) overrides steps 2 and 3 (registered
 * library over shelf); it does NOT override step 1 (an applied
 * provider is already the operator's realised choice, and pinning to
 * something else would be a silent contradiction).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.tree                walker TreeModel
 * @param {{role: string, reason: string}} args.suggestion
 * @param {CompanionsPinFile|null} [args.pins]
 * @returns {Promise<ResolvedCompanion>}
 */
export async function resolveCompanionRole({ projectRoot, tree, suggestion, pins }) {
  const role = suggestion.role;
  const reason = suggestion.reason;
  // Tier 1: applied providers.
  const applied = await enumerateAppliedProviders({ tree, role });
  if (applied.length > 0) {
    const primary = applied[0];
    return {
      role,
      reason,
      provider: primary.slug,
      origin: 'appliedProvider',
      notes: `already applied on this project (${primary.slug})`,
    };
  }
  // Pin tier (spec 2.4): overrides library / shelf when present.
  const pin = pins?.roles?.[role];
  if (pin) {
    return {
      role,
      reason,
      provider: pin.provider,
      origin: pin.provider.includes(':') ? 'pinnedLibrary' : 'pinnedShelf',
      notes: `pinned via rcf/companions.json to ${pin.provider}`,
    };
  }
  // Tier 2: registered libraries.
  const libraries = await enumerateLibraryProviders({ projectRoot, role });
  if (libraries.length === 1) {
    const [lib] = libraries;
    const providerLabel = `${lib.libraryPrefix}:${lib.slug}`;
    // Also enumerate the shelf so the notes can name the overridden shelf provider.
    const shelfProviders = await enumerateShelfProviders(role);
    const shelfNote = shelfProviders.length === 1 ? ` (overrides shelf provider ${shelfProviders[0]})` : '';
    return {
      role,
      reason,
      provider: providerLabel,
      origin: 'registeredLibrary',
      notes: `registered library '${lib.libraryPrefix}'${shelfNote}`,
    };
  }
  if (libraries.length > 1) {
    return {
      role,
      reason,
      provider: null,
      origin: 'ambiguousLibraries',
      ambiguousProviders: libraries.map((l) => `${l.libraryPrefix}:${l.slug}`).sort(),
      notes: `two or more registered libraries provide role '${role}'; explicit selection required`,
    };
  }
  // Tier 3: core shelf.
  const shelfProviders = await enumerateShelfProviders(role);
  if (shelfProviders.length === 1) {
    return {
      role,
      reason,
      provider: shelfProviders[0],
      origin: 'shelfFallback',
      notes: `shelf fallback (no registered library provides this role)`,
    };
  }
  if (shelfProviders.length > 1) {
    // Not currently expected on the core shelf (one provider per
    // role) but shape the resolver to disambiguate the same way.
    return {
      role,
      reason,
      provider: null,
      origin: 'ambiguousLibraries',
      ambiguousProviders: shelfProviders,
      notes: `two or more shelf blueprints provide role '${role}'; explicit selection required`,
    };
  }
  return {
    role,
    reason,
    provider: null,
    origin: 'unresolved',
    notes: `no provider found for role '${role}' (no applied blueprint, no registered library, no shelf blueprint declares providesRoles containing '${role}').`,
  };
}

/**
 * Resolve every role in a service blueprint's suggestedCompanions[].
 * Preserves the order of the suggestedCompanions[] array (spec 2.6).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.tree
 * @param {Array<{role: string, reason: string}>} args.suggestedCompanions
 * @param {CompanionsPinFile|null} [args.pins]
 * @returns {Promise<ResolvedCompanion[]>}
 */
export async function resolveCompanions({ projectRoot, tree, suggestedCompanions, pins }) {
  const out = [];
  for (const suggestion of suggestedCompanions ?? []) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await resolveCompanionRole({ projectRoot, tree, suggestion, pins }));
  }
  return out;
}

/**
 * Render a resolved-companion list to a text block (spec 2.5 / 2.6
 * output shape). Fixed 16-column role column for legibility.
 *
 * @param {ResolvedCompanion[]} resolved
 * @returns {string}
 */
export function renderCompanionLines(resolved) {
  const lines = [];
  for (const r of resolved) {
    const rolePad = r.role.padEnd(16, ' ');
    if (r.origin === 'ambiguousLibraries') {
      lines.push(`  ${rolePad} -> (ambiguous) ${r.notes}`);
    } else if (r.origin === 'unresolved') {
      lines.push(`  ${rolePad} -> (unresolved) ${r.notes}`);
    } else {
      lines.push(`  ${rolePad} -> ${r.provider} (${r.notes})`);
    }
  }
  return lines.join('\n');
}

/**
 * Two-libraries-refusal message shape (spec 2.4). Called by the CLI
 * on ambiguousLibraries origin. Returns the multi-line text.
 *
 * @param {object} args
 * @param {string} args.role
 * @param {string[]} args.providers   library-qualified slugs, e.g. ["wsd:logging","acme:log-emit"]
 * @param {string} [args.serviceSlug] service blueprint being applied; used in the resolution paths
 * @returns {string}
 */
export function renderAmbiguousLibraryRefusal({ role, providers, serviceSlug }) {
  const numbered = providers.map((p, i) => `  ${i + 1}. ${p} (in registered library '${p.split(':')[0]}')`).join('\n');
  const applyLine = serviceSlug
    ? `       rcf define blueprint add ${serviceSlug} --companion ${role}=${providers[0]}`
    : `       rcf define blueprint add <service-slug> --companion ${role}=${providers[0]}`;
  return [
    `Two or more registered libraries provide role '${role}':`,
    numbered,
    '',
    'Resolve one of these ways:',
    '',
    '  1. Adopt one explicitly at apply:',
    applyLine,
    '  2. Pin one for every future apply on this project:',
    `       rcf define blueprint companions set ${role} ${providers[0]}`,
    '     (writes rcf/companions.json; the file is a project record and rides git)',
    '  3. Remove one of the libraries if the project does not need both:',
    '       rcf define blueprint library remove <prefix>',
    '',
  ].join('\n');
}

/**
 * Validate rcf/companions.json against the resolvable-providers gate
 * (spec 5): a pin that names no known provider (no applied, no
 * registered library, no shelf) refuses with a validation error.
 * Called from `rcf define validate`; the walker has already run and
 * has the tree. Returns null clean or an array of rcfError entries.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.tree
 * @returns {Promise<import('../core/errors/index.js').RcfError[]>}
 */
export async function validateCompanionPinsResolvable({ projectRoot, tree }) {
  const file = await readCompanionsFile(projectRoot);
  if (file === null) return [];
  if (file.kind) return [file];
  const errors = [];
  for (const [role, entry] of Object.entries(file.roles ?? {})) {
    const provider = entry.provider;
    // Applied?
    const applied = (tree?.manifest?.blueprints ?? []).find((bp) => bp.slug === provider);
    if (applied) continue;
    // Library-qualified?
    if (provider.includes(':')) {
      const [prefix, slug] = provider.split(':');
      const registry = await readLibraryRegistry(projectRoot);
      if (!registry.kind) {
        const lib = (registry.libraries ?? []).find((l) => l.libraryPrefix === prefix);
        if (lib && (lib.blueprints ?? []).some((b) => b.slug === slug)) continue;
      }
      errors.push(rcfError({
        kind: 'validation',
        message: `rcf/companions.json pins role '${role}' to '${provider}' but no such provider is applied, registered or on the shelf.`,
        filePath: join(projectRoot, COMPANIONS_PATH),
      }));
      continue;
    }
    // Shelf slug?
    const shelfProviders = await enumerateShelfProviders(role);
    if (shelfProviders.includes(provider)) continue;
    errors.push(rcfError({
      kind: 'validation',
      message: `rcf/companions.json pins role '${role}' to '${provider}' but no such provider is applied, registered or on the shelf.`,
      filePath: join(projectRoot, COMPANIONS_PATH),
    }));
  }
  return errors;
}
