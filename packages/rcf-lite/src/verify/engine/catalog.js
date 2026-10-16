// Runtime verify catalog (FBS-218, issue 349, TAC-4150). A project may
// declare per-AC probes out of the AC records, in
// `rcf/verify-catalog.json { catalogVersion: 1, probes: { <acId>: Probe } }`.
// Deterministic verify resolves the catalog entry for an AC that carries
// no probe of its own; an AC-level probe always wins.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isRcfError, rcfError } from '#core/errors';
import { validateSubschema } from '#core/store/validator.js';

/** Tree-relative path of the catalog file. */
export const VERIFY_CATALOG_PATH = join('rcf', 'verify-catalog.json');

/**
 * Read the verify catalog under a project root. A missing file is an
 * empty catalog; a malformed one is a validation error as data.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ exists: boolean, catalogVersion: number|null, probes: Record<string, object> } | import('#core/errors').RcfError>}
 */
export async function readVerifyCatalog(projectRoot) {
  let raw;
  try {
    raw = await readFile(join(projectRoot, VERIFY_CATALOG_PATH), 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { exists: false, catalogVersion: null, probes: {} };
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
  return { exists: true, catalogVersion: doc.catalogVersion ?? null, probes: doc.probes };
}

/** The response assertions a probe may carry (TAC-4150). */
const PROBE_ASSERTION_FIELDS = ['expectStatus', 'expectHeader', 'expectBody', 'selector'];

/**
 * Shape check for one probe, AC-level or catalog: the probe must satisfy
 * the `acProbe` subschema of @stravica-ai/rcf-schemas (gate finding BH-2:
 * an empty or malformed assertion is no assertion) and carry at least one
 * response assertion (gate finding BH-1). Returns null for a valid probe,
 * else the failing field (taken from the validator's error path) and a
 * message. Verify records an invalid probe as "fail"; validate refuses it
 * in the catalog.
 *
 * @param {unknown} probe
 * @returns {{ field: string, message: string } | null}
 */
export function probeShapeError(probe) {
  const errors = validateSubschema({ value: probe, kind: 'userStory', def: 'acProbe' });
  if (errors) {
    const first = errors[0] ?? {};
    const field = first.instancePath?.split('/')[1]
      || first.params?.additionalProperty
      || first.params?.missingProperty
      || 'probe';
    const message = errors.map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`).join('; ');
    return { field, message };
  }
  if (!PROBE_ASSERTION_FIELDS.some((field) => probe[field] !== undefined)) {
    return { field: 'missing assertion', message: `carries no response assertion (${PROBE_ASSERTION_FIELDS.join(', ')})` };
  }
  return null;
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
 * tree, every entry must pass probeShapeError, and a present
 * catalog must declare `catalogVersion: 1`. A malformed catalog surfaces
 * as its read error. Absent file: none.
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
  const filePath = join(projectRoot, VERIFY_CATALOG_PATH);
  const errors = [];
  if (catalog.exists && catalog.catalogVersion !== 1) {
    errors.push(rcfError({
      kind: 'validation',
      message: `${VERIFY_CATALOG_PATH} must declare catalogVersion 1 (found ${JSON.stringify(catalog.catalogVersion)}).`,
      filePath,
      field: 'catalogVersion',
    }));
  }
  for (const [acId, probe] of Object.entries(catalog.probes)) {
    if (!acIds.has(acId)) {
      errors.push(rcfError({
        kind: 'validation',
        message: `${VERIFY_CATALOG_PATH} carries a probe for '${acId}' but no acceptance criterion with that id exists in the tree.`,
        filePath,
        field: `probes.${acId}`,
      }));
    }
    const shapeError = probeShapeError(probe);
    if (shapeError) {
      errors.push(rcfError({
        kind: 'validation',
        message: `${VERIFY_CATALOG_PATH} probe for '${acId}' is malformed at ${shapeError.field}: ${shapeError.message}.`,
        filePath,
        field: `probes.${acId}.${shapeError.field}`,
      }));
    }
  }
  return errors;
}
