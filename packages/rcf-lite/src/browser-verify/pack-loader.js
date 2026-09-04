// Pack loader for blueprint-shipped probe packs
// (visual round T-0, US-1701 AC-1701-1 / 2 / 3). CN-107.
//
// Given a list of applied blueprints, discovers each blueprint's
// probe packs under `<blueprintAbsPath>/probe-packs/*.pack.{js,mjs}`,
// imports each module dynamically, validates against the pack schema
// (`pack-schema.js`), and cross-checks every check id against the AC
// ids the blueprint contributes via `blueprint.json:contributions[]`.
//
// The loader is pure with respect to the filesystem it reads: no
// writes, no side effects on the imported modules. It returns an
// aggregate result (`packs`, `warnings`, `errors`) so the CLI can
// emit one refusal diagnostic per fault rather than stop at the first.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validatePackModule } from './pack-schema.js';

const PACK_FILENAME_RE = /\.pack\.(?:js|mjs)$/;

/**
 * Load and validate probe packs under a set of applied blueprints.
 *
 * @param {object} args
 * @param {Array<{ slug: string, absPath: string }>} args.appliedBlueprints
 *   List of blueprints on the applied shelf. `absPath` is the
 *   directory containing the blueprint's `blueprint.json`.
 * @param {string} [args.projectRoot]  reserved; unused today.
 * @returns {Promise<{ packs: Array<LoadedPack>, warnings: Array<{ packAbsPath: string, message: string }>, errors: Array<{ packAbsPath: string, message: string }> }>}
 */
export async function loadProbePacks({ appliedBlueprints, projectRoot: _projectRoot }) {
  const packs = [];
  const warnings = [];
  const errors = [];

  for (const bp of Array.isArray(appliedBlueprints) ? appliedBlueprints : []) {
    if (!bp || typeof bp.slug !== 'string' || typeof bp.absPath !== 'string' || !isAbsolute(bp.absPath)) {
      errors.push({
        packAbsPath: '(no path)',
        message: `pack-loader: blueprint entry must carry { slug: string, absPath: absolute path } (got ${JSON.stringify(bp)})`,
      });
      continue;
    }
    const packsDir = join(bp.absPath, 'probe-packs');
    if (!existsSync(packsDir)) continue;

    let contributedAcIds;
    try {
      contributedAcIds = await readContributedAcIds({ blueprintAbsPath: bp.absPath });
    } catch (err) {
      errors.push({ packAbsPath: bp.absPath, message: `pack-loader: cannot read blueprint contributions for '${bp.slug}': ${err.message}` });
      continue;
    }

    let entries;
    try {
      entries = await readdir(packsDir, { withFileTypes: true });
    } catch (err) {
      errors.push({ packAbsPath: packsDir, message: `pack-loader: cannot list probe-packs dir for '${bp.slug}': ${err.message}` });
      continue;
    }

    const packFiles = entries
      .filter((e) => e.isFile() && PACK_FILENAME_RE.test(e.name))
      .map((e) => join(packsDir, e.name))
      .sort();

    for (const packAbsPath of packFiles) {
      let mod;
      try {
        mod = await import(pathToFileURL(packAbsPath).href);
      } catch (err) {
        errors.push({ packAbsPath, message: `pack-loader: import failed for ${packAbsPath}: ${err.message}` });
        continue;
      }
      const validation = validatePackModule({ mod, blueprintSlug: bp.slug, packAbsPath });
      if (!validation.ok) {
        for (const e of validation.errors) errors.push({ packAbsPath, message: e.message });
        continue;
      }
      const pack = validation.pack;

      const badCheckIds = pack.checks
        .map((c) => c.id)
        .filter((id) => !contributedAcIds.has(id));
      if (badCheckIds.length > 0) {
        errors.push({
          packAbsPath,
          message: `pack-loader: pack '${pack.packName}' names checks [${badCheckIds.join(', ')}] that the blueprint '${bp.slug}' does not contribute; contributed AC ids on this blueprint: ${contributedAcIds.size === 0 ? '(none)' : [...contributedAcIds].sort().join(', ')}`,
        });
        continue;
      }

      packs.push({
        packName: pack.packName,
        version: pack.version,
        blueprintSlug: bp.slug,
        packAbsPath,
        appliesTo: pack.appliesTo,
        boot: pack.boot ?? null,
        checks: pack.checks,
        preChecks: Array.isArray(pack.preChecks) ? pack.preChecks : [],
      });
    }
  }

  return { packs, warnings, errors };
}

/**
 * Read every AC id contributed by a blueprint. A blueprint contributes ACs
 * inside its US contribution files (`contributions[].kind === 'us'`).
 *
 * @param {object} args
 * @param {string} args.blueprintAbsPath
 * @returns {Promise<Set<string>>}
 */
export async function readContributedAcIds({ blueprintAbsPath }) {
  const bpJsonPath = join(blueprintAbsPath, 'blueprint.json');
  const bpRaw = await readFile(bpJsonPath, 'utf8');
  let bpJson;
  try { bpJson = JSON.parse(bpRaw); } catch (err) {
    throw new Error(`invalid JSON in ${bpJsonPath}: ${err.message}`);
  }
  const contributions = Array.isArray(bpJson?.contributions) ? bpJson.contributions : [];
  const acIds = new Set();
  for (const c of contributions) {
    if (c?.kind !== 'us' || typeof c.path !== 'string') continue;
    const usAbs = resolve(blueprintAbsPath, c.path);
    let usJson;
    try {
      usJson = JSON.parse(await readFile(usAbs, 'utf8'));
    } catch (err) {
      throw new Error(`cannot read US contribution ${c.path}: ${err.message}`);
    }
    const inlineAcs = Array.isArray(usJson?.acceptanceCriteria) ? usJson.acceptanceCriteria : [];
    for (const ac of inlineAcs) {
      if (typeof ac?.id === 'string') acIds.add(ac.id);
    }
  }
  return acIds;
}

/**
 * @typedef {object} LoadedPack
 * @property {string} packName
 * @property {string} version
 * @property {string} blueprintSlug
 * @property {string} packAbsPath
 * @property {(ctx: { fbs: object, uiBaseline: object|null, manifest: object|null }) => boolean} appliesTo
 * @property {object|null} boot
 * @property {Array<{ id: string, severity: 'block'|'warn'|'advisory', description: string, run: (ctx: object) => Promise<{ verdict: 'pass'|'warn'|'fail'|'skipped', detail?: string }>, dependsOn?: string|string[] }>} checks
 * @property {Array<{ id: string, severity: 'block'|'warn'|'advisory', description: string, run: () => Promise<{ verdict: 'pass'|'warn'|'fail', detail?: string }> }>} preChecks
 */
