// Schema validator. Registers the @stravica/rcf-schemas@0.1.0 bundle once
// at start-up and exposes a single `validateDocument` entry point. Returns
// `null` on success or a structured `validation` error on failure.
//
// Validation runs on load (FBS-001 / AC-701-3): the published bundle is the
// contract, not a local copy.

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import commonSchema from '@stravica/rcf-schemas/schemas/common.schema.json' with { type: 'json' };
import manifestSchema from '@stravica/rcf-schemas/schemas/manifest.schema.json' with { type: 'json' };
import prdSchema from '@stravica/rcf-schemas/schemas/prd.schema.json' with { type: 'json' };
import reqSchema from '@stravica/rcf-schemas/schemas/req.schema.json' with { type: 'json' };
import userStorySchema from '@stravica/rcf-schemas/schemas/user-story.schema.json' with { type: 'json' };
import tadSchema from '@stravica/rcf-schemas/schemas/tad.schema.json' with { type: 'json' };
import tacSchema from '@stravica/rcf-schemas/schemas/tac.schema.json' with { type: 'json' };
import adrSchema from '@stravica/rcf-schemas/schemas/adr.schema.json' with { type: 'json' };
import buildSequenceSchema from '@stravica/rcf-schemas/schemas/build-sequence.schema.json' with { type: 'json' };
import fbsSchema from '@stravica/rcf-schemas/schemas/fbs.schema.json' with { type: 'json' };
import testSuiteSchema from '@stravica/rcf-schemas/schemas/test-suite.schema.json' with { type: 'json' };

import { rcfError } from '../errors/index.js';

/**
 * @typedef {('manifest'|'prd'|'req'|'userStory'|'tad'|'tac'|'adr'|'buildSequence'|'fbs'|'testSuite')} DocKind
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
  testSuite: 'tsId',
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
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
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
