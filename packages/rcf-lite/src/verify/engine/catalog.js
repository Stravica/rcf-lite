// Runtime verify catalog (FBS-218, issue 349, TAC-4150). A project may
// declare per-AC probes out of the AC records, in
// `rcf/verify-catalog.json { catalogVersion: 1, probes: { <acId>: Probe } }`.
// Deterministic verify resolves the catalog entry for an AC that carries
// no probe of its own; an AC-level probe always wins.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isRcfError, rcfError } from '#core/errors';

/** Tree-relative path of the catalog file. */
export const VERIFY_CATALOG_PATH = join('rcf', 'verify-catalog.json');

/**
 * Read the verify catalog under a project root. A missing file is an
 * empty catalog; a malformed one is a validation error as data.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ catalogVersion: number|null, probes: Record<string, object> } | import('#core/errors').RcfError>}
 */
export async function readVerifyCatalog(projectRoot) {
  let raw;
  try {
    raw = await readFile(join(projectRoot, VERIFY_CATALOG_PATH), 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { catalogVersion: null, probes: {} };
    return rcfError({ kind: 'ioFailure', message: `could not read ${VERIFY_CATALOG_PATH}: ${err.message}` });
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return rcfError({ kind: 'validation', message: `${VERIFY_CATALOG_PATH} is not valid JSON: ${err.message}`, field: 'verifyCatalog' });
  }
  if (!doc || typeof doc !== 'object' || !doc.probes || typeof doc.probes !== 'object' || Array.isArray(doc.probes)) {
    return rcfError({ kind: 'validation', message: `${VERIFY_CATALOG_PATH} must be { catalogVersion: 1, probes: { <acId>: Probe } }`, field: 'verifyCatalog' });
  }
  return { catalogVersion: doc.catalogVersion ?? null, probes: doc.probes };
}

/**
 * Pick the probe for one AC: the AC-level probe wins over the catalog
 * entry. Returns null when neither exists (the AC stays critique-only).
 *
 * @param {{ acId: string, probe?: object }} ac
 * @param {{ probes: Record<string, object> }} catalog
 * @returns {{ probe: object, source: 'ac'|'catalog' } | null}
 */
export function selectProbe(ac, catalog) {
  if (ac?.probe && typeof ac.probe === 'object') return { probe: ac.probe, source: 'ac' };
  const entry = catalog?.probes?.[ac?.acId];
  if (entry && typeof entry === 'object') return { probe: entry, source: 'catalog' };
  return null;
}

/**
 * `rcf define validate` check: every catalog key must name an AC in the
 * tree. A malformed catalog surfaces as its read error. Absent file: none.
 *
 * @param {{ projectRoot: string, tree: { userStories?: Array<object> } }} args
 * @returns {Promise<Array<import('#core/errors').RcfError>>}
 */
export async function validateVerifyCatalogKeys({ projectRoot, tree }) {
  const catalog = await readVerifyCatalog(projectRoot);
  if (isRcfError(catalog)) return [catalog];
  const acIds = new Set();
  for (const us of tree.userStories ?? []) {
    for (const ac of us.acceptanceCriteria ?? []) acIds.add(ac.id);
  }
  return Object.keys(catalog.probes)
    .filter((acId) => !acIds.has(acId))
    .map((acId) => rcfError({
      kind: 'validation',
      message: `${VERIFY_CATALOG_PATH} carries a probe for '${acId}' but no acceptance criterion with that id exists in the tree.`,
      filePath: join(projectRoot, VERIFY_CATALOG_PATH),
      field: `probes.${acId}`,
    }));
}
