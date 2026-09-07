// Probe: rate-limit manifest schema-validate.
//
// anchorAcId: AC-36106-1. accountBound: false.
//
// Reads the cf-edge fixture manifest directory, loads the shipped
// JSON Schema (contributions/schemas/rate-limit-rule.schema.json,
// draft-07) and validates every manifest file against it. A minimal
// dependency-free validator covers the shape the schema commits to:
// required-fields, type-per-field, integer-minimum, string-min-length,
// non-empty-array and additionalProperties: false.
//
// Under SIMULATE_SCHEMA_INVALID=true the probe writes a scratch
// manifest file that omits the threshold field so validation fails
// with the offending field named in the detail.

import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST_DIR, REQUIRED_FIELDS, ACTION_ENUM, loadSchema } from './probe-utils.mjs';

export const anchorAcId = 'AC-36106-1';
export const accountBound = false;

function validateDoc(doc, schema, filename) {
  const failures = [];
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    failures.push(`${filename}: root is not a JSON object`);
    return failures;
  }
  for (const required of schema.required) {
    if (!(required in doc)) failures.push(`${filename}: missing required field ${required}`);
  }
  const props = schema.properties || {};
  const allowed = new Set(Object.keys(props));
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(doc)) {
      if (!allowed.has(key)) failures.push(`${filename}: additional property not permitted: ${key}`);
    }
  }
  for (const [key, def] of Object.entries(props)) {
    if (!(key in doc)) continue;
    const v = doc[key];
    if (def.type === 'string') {
      if (typeof v !== 'string') { failures.push(`${filename}: ${key} is not a string`); continue; }
      if (typeof def.minLength === 'number' && v.length < def.minLength) failures.push(`${filename}: ${key} shorter than minLength ${def.minLength}`);
      if (Array.isArray(def.enum) && !def.enum.includes(v)) failures.push(`${filename}: ${key} value ${JSON.stringify(v)} not in enum ${JSON.stringify(def.enum)}`);
    } else if (def.type === 'integer') {
      if (!Number.isInteger(v)) { failures.push(`${filename}: ${key} is not an integer`); continue; }
      if (typeof def.minimum === 'number' && v < def.minimum) failures.push(`${filename}: ${key} value ${v} below minimum ${def.minimum}`);
    } else if (def.type === 'array') {
      if (!Array.isArray(v)) { failures.push(`${filename}: ${key} is not an array`); continue; }
      if (typeof def.minItems === 'number' && v.length < def.minItems) failures.push(`${filename}: ${key} array shorter than minItems ${def.minItems}`);
      if (def.items && def.items.type === 'string') {
        v.forEach((item, i) => {
          if (typeof item !== 'string') failures.push(`${filename}: ${key}[${i}] is not a string`);
          else if (typeof def.items.minLength === 'number' && item.length < def.items.minLength) failures.push(`${filename}: ${key}[${i}] shorter than minLength ${def.items.minLength}`);
        });
      }
    }
  }
  return failures;
}

export default async function runProbe() {
  const schema = await loadSchema();
  const simulateInvalid = process.env.SIMULATE_SCHEMA_INVALID === 'true';
  const results = [];
  const fileFindings = [];
  let scratchPath = null;
  try {
    if (simulateInvalid) {
      await mkdir(MANIFEST_DIR, { recursive: true });
      scratchPath = join(MANIFEST_DIR, '__simulate-schema-invalid.json');
      const invalidDoc = {
        id: 'simulate-schema-invalid',
        expression: '(http.request.uri.path matches "^/api/")',
        period: 60,
        characteristics: ['ip.src'],
        action: 'block',
        duration: 60,
      };
      await writeFile(scratchPath, JSON.stringify(invalidDoc, null, 2) + '\n', 'utf8');
    }
    const entries = (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith('.json')).sort();
    for (const name of entries) {
      const text = await readFile(join(MANIFEST_DIR, name), 'utf8');
      let doc;
      try {
        doc = JSON.parse(text);
      } catch (err) {
        results.push({
          anchorAcId: 'AC-36106-1',
          verdict: 'fail',
          detail: `manifest file ${name} does not parse: ${err.message}`,
        });
        fileFindings.push({ name, valid: false, errors: [err.message] });
        continue;
      }
      const failures = validateDoc(doc, schema, name);
      if (failures.length > 0) {
        results.push({
          anchorAcId: 'AC-36106-1',
          verdict: 'fail',
          detail: failures.join('; '),
        });
        fileFindings.push({ name, valid: false, errors: failures });
      } else {
        fileFindings.push({ name, valid: true });
      }
    }
  } finally {
    if (scratchPath) {
      try { await unlink(scratchPath); } catch {}
    }
  }
  if (results.length === 0) {
    results.push({
      anchorAcId: 'AC-36106-1',
      verdict: 'pass',
      detail: `every manifest file validates against the shipped draft-07 schema (${fileFindings.length} file(s) inspected; required fields ${REQUIRED_FIELDS.join(', ')}; action enum ${ACTION_ENUM.join('/')}).`,
    });
  }
  return {
    results,
    extra: {
      schemaId: schema.$id,
      manifestFileCount: fileFindings.length,
      manifestFiles: fileFindings,
    },
  };
}
