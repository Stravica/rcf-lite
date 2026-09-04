// Schema validator. Registers the @stravica-ai/rcf-schemas bundle once at
// start-up and exposes a single `validateDocument` entry point. Returns
// `null` on success or a structured `validation` error on failure.
//
// Validation runs on load (FBS-001 / AC-701-3): the published bundle is the
// contract, no local overlays. The `testPointer` conditional-required rule
// (required for TCs with status `passing` or `failing`, optional for
// `pending` or `skipped`) landed in the shared schema at rcf-schemas 0.5.0
// (w-2026-08-27-dave-001), replacing the pre-0.12 local strictness overlay
// that required a pointer on every TC (w-2026-07-28-005). Referential
// -integrity checking lives in the walker (D8); this module is
// schema-shape-only.

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import commonSchema from '@stravica-ai/rcf-schemas/schemas/common.schema.json' with { type: 'json' };
import manifestSchema from '@stravica-ai/rcf-schemas/schemas/manifest.schema.json' with { type: 'json' };
import prdSchema from '@stravica-ai/rcf-schemas/schemas/prd.schema.json' with { type: 'json' };
import reqSchema from '@stravica-ai/rcf-schemas/schemas/req.schema.json' with { type: 'json' };
import userStorySchema from '@stravica-ai/rcf-schemas/schemas/user-story.schema.json' with { type: 'json' };
import tadSchema from '@stravica-ai/rcf-schemas/schemas/tad.schema.json' with { type: 'json' };
import tacSchema from '@stravica-ai/rcf-schemas/schemas/tac.schema.json' with { type: 'json' };
import adrSchema from '@stravica-ai/rcf-schemas/schemas/adr.schema.json' with { type: 'json' };
import buildSequenceSchema from '@stravica-ai/rcf-schemas/schemas/build-sequence.schema.json' with { type: 'json' };
import fbsSchema from '@stravica-ai/rcf-schemas/schemas/fbs.schema.json' with { type: 'json' };
import testSuiteSchema from '@stravica-ai/rcf-schemas/schemas/test-suite.schema.json' with { type: 'json' };
// Phase 10 (X2 CodeNode bridge): 11th document kind, delivered in
// @stravica-ai/rcf-schemas@0.3.0.
import cnSchema from '@stravica-ai/rcf-schemas/schemas/cn.schema.json' with { type: 'json' };
// rcf-schemas 0.6.0: the EVAL doc type. Optional peer of a Test Suite,
// used to grade nonDeterministic acceptance criteria.
import evalSchema from '@stravica-ai/rcf-schemas/schemas/eval.schema.json' with { type: 'json' };

import { rcfError } from '../errors/index.js';

// w-2026-07-28-005 strictness overlay retired at rcf-lite 0.12.0. The
// durable landing (`testPointer` required on Test Cases with status
// `passing` or `failing`, `minLength: 1` when present, and OPTIONAL for
// `pending` or `skipped`) shipped in @stravica-ai/rcf-schemas 0.5.0
// (w-2026-08-27-dave-001). rcf-lite now inherits the rule from the shared
// schema, unmodified.

/**
 * @typedef {('manifest'|'prd'|'req'|'userStory'|'tad'|'tac'|'adr'|'buildSequence'|'fbs'|'testSuite'|'codeNode'|'evalDoc')} DocKind
 */

const SCHEMAS = {
  manifest: manifestSchema,
  prd: prdSchema,
  req: reqSchema,
  userStory: userStorySchema,
  tad: tadSchema,
  tac: tacSchema,
  adr: adrSchema,
  buildSequence: buildSequenceSchema,
  fbs: fbsSchema,
  testSuite: testSuiteSchema,
  // Phase 10: Code Node.
  codeNode: cnSchema,
  // rcf-schemas 0.6.0: EVAL doc.
  evalDoc: evalSchema,
};

const ID_FIELD = {
  manifest: null,
  prd: 'prdId',
  req: 'reqId',
  userStory: 'usId',
  tad: 'tadId',
  tac: 'tacId',
  adr: 'adrId',
  buildSequence: 'bsId',
  fbs: 'fbsId',
  // Test Suite uses the plain `id` field (see @stravica-ai/rcf-schemas@0.2.0
  // test-suite.schema.json). No `tsId` field.
  testSuite: 'id',
  // Phase 10: Code Node.
  codeNode: 'cnId',
  // rcf-schemas 0.6.0: EVAL doc uses the plain `id` field (mirrors TS).
  evalDoc: 'id',
};

let cachedAjv = null;

function getAjv() {
  if (cachedAjv) return cachedAjv;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(commonSchema);
  for (const schema of Object.values(SCHEMAS)) {
    ajv.addSchema(schema);
  }
  cachedAjv = ajv;
  return ajv;
}

/**
 * Returns the set of document kinds the validator knows about.
 * @returns {DocKind[]}
 */
export function knownKinds() {
  return /** @type {DocKind[]} */ (Object.keys(SCHEMAS));
}

/**
 * Returns the property name carrying the document's id, or null for manifest.
 *
 * @param {DocKind} kind
 * @returns {string|null}
 */
export function idFieldFor(kind) {
  if (!(kind in ID_FIELD)) {
    throw new TypeError(`Unknown kind: ${kind}`);
  }
  return ID_FIELD[kind];
}

/**
 * Extract the document id, or null for manifest.
 *
 * @param {object} doc
 * @param {DocKind} kind
 * @returns {string|null}
 */
export function documentIdOf(doc, kind) {
  const field = idFieldFor(kind);
  if (!field) return null;
  const value = doc?.[field];
  return typeof value === 'string' ? value : null;
}

/**
 * Ajv's default `enum` message is "must be equal to one of the allowed
 * values" and never says which. The allowed set is in `params`, which
 * we were discarding - leaving the only way to find a valid status /
 * priority / testLevel / category / generationStrategy be reading the
 * schema source. Append it when Ajv provides it.
 *
 * @param {object} e - an Ajv error object
 * @returns {string} suffix to append to the error message ('' when none)
 */
function detailOf(e) {
  const allowed = e?.params?.allowedValues;
  if (!Array.isArray(allowed) || allowed.length === 0) return '';
  return ` (allowed: ${allowed.join(', ')})`;
}

/**
 * Validate a document against its schema.
 *
 * @param {object} args
 * @param {object} args.doc - parsed JSON document
 * @param {DocKind} args.kind
 * @param {string} [args.filePath] - optional, recorded on validation errors
 * @returns {import('../errors/index.js').RcfError | null}
 */
export function validateDocument({ doc, kind, filePath }) {
  const schema = SCHEMAS[kind];
  if (!schema) {
    return rcfError({
      kind: 'validation',
      message: `Unknown document kind: ${kind}`,
      filePath,
    });
  }
  const ajv = getAjv();
  const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
  if (validate(doc)) return null;
  const ajvErrors = validate.errors ?? [];
  const first = ajvErrors[0] ?? {};
  const field = first.instancePath?.replace(/^\//, '').replace(/\//g, '.') || undefined;
  const rule = first.keyword || undefined;
  const message = ajvErrors
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}${detailOf(e)}`)
    .join('; ');
  const documentId = documentIdOf(doc, kind) ?? undefined;
  return rcfError({
    kind: 'validation',
    message,
    documentId,
    filePath,
    field,
    rule,
  });
}
