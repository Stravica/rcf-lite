import { test } from 'node:test';
import assert from 'node:assert/strict';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Smoke test for the @stravica-ai/rcf-schemas dependency: proves the published
// package's schemas are importable and that the ajv validation path works
// end to end. The exhaustive validation surface lives in rcf-schemas' own CI;
// this only confirms Build Lite can consume the contract.
import prdSchema from '@stravica-ai/rcf-schemas/schemas/prd.schema.json' with { type: 'json' };
import commonSchema from '@stravica-ai/rcf-schemas/schemas/common.schema.json' with { type: 'json' };

function buildValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  // common.schema.json carries shared $defs that prd.schema.json $refs by
  // absolute $id, so it must be registered alongside the doc-type schema.
  ajv.addSchema(commonSchema);
  return ajv.compile(prdSchema);
}

// A minimal PRD satisfying every required field in prd.schema.json@0.2.0.
// Post-3.7 the PRD no longer carries `requirementIds` -- REQ children hold
// the parent link via `prdId`.
const validPrd = {
  prdId: 'PRD-001',
  productName: 'Acme Notes',
  version: '0.1.0',
  status: 'draft',
  problemStatement: 'Notes are scattered across tools.',
  objectives: ['Single home for personal notes.'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

test('valid PRD passes validation', () => {
  const validate = buildValidator();
  const ok = validate(validPrd);
  assert.equal(ok, true, JSON.stringify(validate.errors));
});

test('invalid PRD fails validation with a prdId error', () => {
  const validate = buildValidator();
  // prdId violates the common.schema.json pattern (^PRD-\d{3,}$).
  const invalidPrd = { ...validPrd, prdId: 'BAD-1' };
  const ok = validate(invalidPrd);
  assert.equal(ok, false);
  assert.ok(
    validate.errors.some((e) => e.instancePath === '/prdId'),
    `expected an error on /prdId, got ${JSON.stringify(validate.errors)}`,
  );
});
