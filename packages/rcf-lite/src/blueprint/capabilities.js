// Capability-declaration mechanism (visual round T-5 spec section
// 5.5.1, 5.5.2). Consumer blueprints gate their surfaces on the union
// of currently-applied blueprints' `capabilities[]` declarations.
//
// Why source read-back. The applied-blueprint-record schema in
// @stravica-ai/rcf-schemas is closed under additionalProperties:false
// (0.6.0), so `appliedCapabilities[]` cannot land on the manifest
// record without a schema bump. Rather than block the round on that
// dependency, this file adopts the core-companions T-2 gate precedent:
// read the source blueprint.json via manifest.blueprints[].source and
// union its declared capabilities[]. Per-project answers (elicits) and
// a per-project applied-capability snapshot are written to a sidecar
// file at rcf/blueprints/${slug}.applied.json.
//
// This file is imported by apply.js at apply time and by the shipped
// probe pack (blueprints/application-admin-console/probe-packs/) at
// verify time.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';

import { rcfError } from '../core/errors/index.js';

/**
 * Read a single applied blueprint's declared capabilities via
 * source read-back. Silently ignores an applied blueprint whose
 * source path no longer exists (the record's ownership fact is the
 * slug on the manifest; the source file is provenance and can move).
 *
 * @param {{ slug: string, source: string }} appliedRecord
 * @param {string} projectRoot
 * @returns {Promise<string[]>}
 */
export async function readAppliedBlueprintCapabilities(appliedRecord, projectRoot) {
  if (!appliedRecord || typeof appliedRecord.source !== 'string') return [];
  const src = appliedRecord.source;
  // A qualified typed ref (`wsd:auth-oauth2`) never resolves as a file
  // path. Skip it; the library-resolved source blueprint is not on
  // this local tree.
  if (/^[a-z][a-z0-9-]*:[a-z]/i.test(src) && !src.startsWith('/') && !src.startsWith('.')) return [];
  const abs = isAbsolute(src) ? src : resolve(projectRoot, src);
  const metaPath = join(abs, 'blueprint.json');
  let raw;
  try {
    raw = await readFile(metaPath, 'utf8');
  } catch {
    return [];
  }
  try {
    const doc = JSON.parse(raw);
    if (!Array.isArray(doc.capabilities)) return [];
    return doc.capabilities.filter((s) => typeof s === 'string');
  } catch {
    return [];
  }
}

/**
 * Discover the union of applied capabilities across every applied
 * blueprint on the tree.
 *
 * @param {Array<{ slug: string, source: string }>} appliedRecords
 * @param {string} projectRoot
 * @returns {Promise<{ union: string[], perSlug: Record<string, string[]> }>}
 */
export async function discoverAppliedCapabilities(appliedRecords, projectRoot) {
  const perSlug = {};
  const union = new Set();
  for (const rec of appliedRecords ?? []) {
    const caps = await readAppliedBlueprintCapabilities(rec, projectRoot);
    perSlug[rec.slug] = caps;
    for (const c of caps) union.add(c);
  }
  return { union: [...union].sort(), perSlug };
}

/**
 * Build the refusal message for a requiresAppliedCapabilities gate.
 * refusalMessageId maps to a known template; a message the loader
 * accepts is used verbatim if the id is unknown (so a future
 * blueprint can ship a bespoke refusal without a core code change).
 *
 * @param {object} args
 * @param {string} args.slug        applying blueprint slug
 * @param {string} args.refusalMessageId
 * @param {string[]} args.requiredCapabilities
 * @param {Array<{ slug: string, version: string }>} args.appliedRecords
 * @param {string} args.allowSkipFlag  the CLI flag the operator can use to override
 * @returns {string}
 */
export function buildRefusalMessage({ slug, refusalMessageId, requiredCapabilities, appliedRecords, allowSkipFlag }) {
  // Applied blueprints list, one per line (indented 2 spaces per spec
  // 5.5.1 formatting).
  const appliedLines = (appliedRecords ?? [])
    .map((r) => `  ${r.slug} v${r.version}`)
    .join('\n');
  const appliedBlock = appliedLines.length > 0 ? appliedLines : '  (none)';
  if (refusalMessageId === 'application-admin-console-bare-spa') {
    return [
      `${slug} requires at least one applied security-auth-* blueprint,`,
      `or an operator override with --${allowSkipFlag}.`,
      '',
      'Applied blueprints on this project:',
      appliedBlock,
      '',
      'Suggested next steps:',
      '  1. Apply an auth blueprint first:',
      '       rcf define blueprint add security-auth-magic-link',
      '     (or security-auth-clerk, security-auth-oauth2, security-auth-keycloak)',
      `  2. Override for a scaffolding pass (surfaces will refuse at apply until an`,
      `     auth blueprint is applied):`,
      `       rcf define blueprint add ${slug} --${allowSkipFlag}`,
    ].join('\n');
  }
  // Generic fallback. Names the required capabilities and applied set;
  // the operator has enough to diagnose without a bespoke template.
  return [
    `${slug} requires an applied blueprint declaring at least one of:`,
    `  ${requiredCapabilities.join(', ')}`,
    `or an operator override with --${allowSkipFlag}.`,
    '',
    'Applied blueprints on this project:',
    appliedBlock,
  ].join('\n');
}

/**
 * Run the elicitation phase. Reads a bag of operator-supplied answers
 * (`--answer <id>=<value>` merged with `--answers <file>` in the CLI),
 * evaluates each elicit's `when` predicate against the discovered
 * capability set, coerces the answer per kind, and returns a
 * `{id: value}` map. A missing required answer for an elicit whose
 * predicate fires refuses with a validation rcfError.
 *
 * @param {object} args
 * @param {Array<object>} args.elicits         from loader
 * @param {string[]} args.appliedCapabilities  discovered union
 * @param {Record<string, string|boolean>} args.answers  operator bag
 * @returns {{value: Record<string, string|boolean|null>} | import('../core/errors/index.js').RcfError}
 */
export function runElicitationPhase({ elicits, appliedCapabilities, answers }) {
  if (!Array.isArray(elicits) || elicits.length === 0) {
    return { value: {} };
  }
  const capSet = new Set(appliedCapabilities ?? []);
  const bag = answers ?? {};
  const out = {};
  for (const e of elicits) {
    const gated = e.when ? Array.isArray(e.when.requiresCapability) && !e.when.requiresCapability.some((c) => capSet.has(c)) : false;
    if (gated) continue;
    const raw = bag[e.id];
    let coerced;
    if (raw === undefined || raw === null || raw === '') {
      if (e.default === undefined) {
        return rcfError({
          kind: 'validation',
          message: `blueprint apply: elicit '${e.id}' is required (no default declared) and no answer was supplied. Pass --answer ${e.id}=<value> or --answers <file>.`,
        });
      }
      coerced = e.default;
    } else if (e.kind === 'boolean') {
      if (typeof raw === 'boolean') coerced = raw;
      else {
        const s = String(raw).trim().toLowerCase();
        if (s === 'y' || s === 'yes' || s === 'true' || s === '1') coerced = true;
        else if (s === 'n' || s === 'no' || s === 'false' || s === '0') coerced = false;
        else return rcfError({ kind: 'validation', message: `blueprint apply: elicit '${e.id}' expects a boolean; got '${raw}'.` });
      }
    } else if (e.kind === 'enum') {
      const s = String(raw).trim();
      if (!e.options.includes(s)) {
        return rcfError({ kind: 'validation', message: `blueprint apply: elicit '${e.id}' expects one of [${e.options.join(', ')}]; got '${raw}'.` });
      }
      coerced = s;
    } else {
      coerced = String(raw).trim();
    }
    out[e.id] = coerced;
  }
  return { value: out };
}

/**
 * Sidecar path for a blueprint's per-project apply-state (relative to
 * the project root). One file per applied blueprint slug.
 */
export function sidecarRelPath(slug) {
  return join('rcf', 'blueprints', `${slug}.applied.json`);
}

/**
 * Write the sidecar. Overwrites the file so re-apply on the same
 * version is idempotent.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.slug
 * @param {string} args.version
 * @param {string} args.appliedAt
 * @param {string[]} args.appliedCapabilities
 * @param {Record<string, string|boolean|null>} args.appliedElicitations
 * @param {boolean} [args.allowNoAuthYet]
 * @param {string} [args.notes]
 */
export async function writeSidecar({ projectRoot, slug, version, appliedAt, appliedCapabilities, appliedElicitations, allowNoAuthYet, notes }) {
  const rel = sidecarRelPath(slug);
  const abs = join(projectRoot, rel);
  await mkdir(dirname(abs), { recursive: true });
  const payload = { slug, version, appliedAt, appliedCapabilities: [...appliedCapabilities].sort(), appliedElicitations };
  if (allowNoAuthYet === true) payload.allowNoAuthYet = true;
  if (typeof notes === 'string' && notes.length > 0) payload.notes = notes;
  await writeFile(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return rel;
}

/**
 * Read the sidecar. Missing file returns null (never throws).
 */
export async function readSidecar(projectRoot, slug) {
  const abs = join(projectRoot, sidecarRelPath(slug));
  try {
    const raw = await readFile(abs, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Presence check for the sidecar file (does not parse).
 */
export async function sidecarExists(projectRoot, slug) {
  try {
    await stat(join(projectRoot, sidecarRelPath(slug)));
    return true;
  } catch {
    return false;
  }
}
